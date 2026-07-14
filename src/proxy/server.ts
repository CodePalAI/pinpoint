/**
 * pixroom proxy — the Node front door (planning/end_product.md §4.2–§4.3).
 *
 * Owns upstream transport, streaming, and (via the optical stage) the single
 * Anthropic `cache_control` breakpoint. For transformable POSTs it parses the body,
 * runs the ContentRouter (semantic → optical), and forwards the transformed body;
 * everything else is proxied through untouched. Responses stream straight back —
 * neither engine rewrites model output. On any transform error it forwards the
 * ORIGINAL body, so the proxy never fails closed.
 *
 * API keys are forwarded from the client to the upstream; pixroom holds none, and
 * the headroom sidecar (loopback `/v1/compress`) never sees keys or the response.
 */

import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

import type { PixroomConfigOverrides } from '../config.js';
import { createRuntime, type Pixroom, type RuntimeOptions } from '../pixroom.js';
import { readModel } from '../anthropic.js';
import { CcrRetrievalOutputIntegration } from '../output/ccr.js';
import { OutputIntegrationRegistry } from '../output/registry.js';
import type { OutputIntegration } from '../output/types.js';
import { createBuiltinProtocolRegistry } from '../protocols/json.js';
import type { ProtocolRegistry } from '../protocols/registry.js';
import { createResponseEventDecoder } from '../protocols/response-events.js';
import { classifyAuthMode } from './auth-mode.js';
import type { Provider } from '../types.js';
import {
  aggregateAnthropicUsage,
  continueVirtualAnthropicTurn,
  hasVirtualAnthropicToolUse,
} from '../virtual-context/anthropic.js';

/** Request headers we must not forward verbatim (hop-by-hop + recomputed).
 *  Note: `accept-encoding` is deliberately preserved so the forwarded request
 *  stays native-looking for stealth (oauth/subscription) traffic. */
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Response hop-by-hop headers; body encoding/length stay raw with native forwarding. */
const STRIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

const VIRTUAL_RESPONSE_LIMIT_BYTES = 4_000_000;

function detectProvider(pathname: string, headers: http.IncomingHttpHeaders): Provider {
  if (headers['x-api-key'] != null || headers['anthropic-version'] != null) return 'anthropic';
  if (pathname.includes('/chat/completions') || pathname.includes('/responses')) return 'openai';
  if (pathname.includes('/messages')) return 'anthropic';
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return 'openai';
  return 'anthropic';
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function requestHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null || STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function responseHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

export interface ProxyServer {
  readonly pixroom: Pixroom;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export interface ProxyServerOptions {
  readonly runtime?: Omit<RuntimeOptions, 'config'>;
  readonly protocols?: ProtocolRegistry;
  readonly outputIntegrations?: readonly OutputIntegration[];
}

export function createProxyServer(
  overrides: PixroomConfigOverrides = {},
  options: ProxyServerOptions = {},
): ProxyServer {
  const pixroom = createRuntime({ config: overrides, ...options.runtime });
  const { config, log } = pixroom;
  const protocols = options.protocols ?? createBuiltinProtocolRegistry();
  const outputs = new OutputIntegrationRegistry((id, error) =>
    log.warn(`output integration ${id} degraded: ${error}`),
  ).register(new CcrRetrievalOutputIntegration(pixroom.ccr));
  for (const integration of options.outputIntegrations ?? []) outputs.register(integration);
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log.error(`unhandled proxy error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'pixroom_error', message: 'internal error' } }));
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') return sendHealth(res);
    if (req.method === 'GET' && (pathname === '/stats' || pathname === '/')) return sendStats(res);

    const protocol = protocols.match({ method: req.method, pathname });
    const provider = protocol?.provider ?? detectProvider(pathname, req.headers);
    const inspection = protocol ? pixroom.requestInspection(provider) : 'none';
    let outBytes: Uint8Array | undefined;
    let originalBodyBytes: Uint8Array | undefined;
    let virtualized = false;
    let virtualContextIds: readonly string[] = [];

    if (protocol && inspection !== 'none') {
      const bodyBytes = await readBody(req);
      originalBodyBytes = bodyBytes;
      outBytes = bodyBytes;
      if (bodyBytes.byteLength > 0) {
        try {
          if (
            inspection === 'tool-results' &&
            !Buffer.from(bodyBytes.buffer, bodyBytes.byteOffset, bodyBytes.byteLength).includes('tool_result')
          ) {
            await forward(
              req,
              res,
              provider,
              pathname + url.search,
              outBytes,
              protocol.id,
              randomUUID(),
            );
            return;
          }
          const parsed = protocol.decodeRequest(bodyBytes);
          protocol.validateRequest(parsed);
          const model = readModel(parsed);
          const authMode = classifyAuthMode(req.headers);
          const routed = await pixroom.route(
            provider,
            model,
            parsed,
            authMode,
            (candidate) => {
              protocol.validateRequest(candidate.body);
              protocol.encodeRequest(candidate.body);
            },
          );
          protocol.validateRequest(routed.body);
          outBytes = JSON.stringify(routed.body) === JSON.stringify(parsed)
            ? bodyBytes
            : protocol.encodeRequest(routed.body);
          virtualized = routed.virtualized && routed.virtualQueryToolNeeded;
          virtualContextIds = routed.virtualContextIds;
        } catch (err) {
          // Never fail closed — forward the original request.
          log.warn(`transform failed, forwarding original: ${err instanceof Error ? err.message : String(err)}`);
          outBytes = bodyBytes;
        }
      }
    }

    if (virtualized && provider === 'anthropic' && outBytes !== undefined) {
      await forwardVirtualAnthropic(
        req,
        res,
        pathname + url.search,
        outBytes,
        originalBodyBytes ?? outBytes,
        protocol?.id,
        randomUUID(),
        new Set(virtualContextIds),
      );
      return;
    }

    await forward(
      req,
      res,
      provider,
      pathname + url.search,
      outBytes,
      protocol?.id,
      randomUUID(),
    );
  }

  interface BufferedUpstreamResponse {
    readonly statusCode: number;
    readonly headers: http.IncomingHttpHeaders;
    readonly body: Buffer;
  }

  async function requestBuffered(
    target: URL,
    method: string,
    headers: Record<string, string>,
    body: Uint8Array,
  ): Promise<BufferedUpstreamResponse> {
    const transport = target.protocol === 'https:' ? https : http;
    const agent = target.protocol === 'https:' ? httpsAgent : httpAgent;
    const outgoing = { ...headers, 'content-length': String(body.byteLength), 'accept-encoding': 'identity' };
    return new Promise((resolve, reject) => {
      const request = transport.request(target, { method, headers: outgoing, agent }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes <= VIRTUAL_RESPONSE_LIMIT_BYTES) chunks.push(chunk);
          else request.destroy(new Error('virtual response exceeds buffer limit'));
        });
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 502,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      });
      request.once('error', reject);
      request.end(body);
    });
  }

  async function forwardVirtualAnthropic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathAndQuery: string,
    bodyBytes: Uint8Array,
    originalBodyBytes: Uint8Array,
    protocolId: string | undefined,
    exchangeId: string,
    allowedIds: ReadonlySet<string>,
  ): Promise<void> {
    const target = new URL(`${config.upstreams.anthropic.replace(/\/+$/, '')}${pathAndQuery}`);
    const headers = requestHeaders(req.headers);
    const responses: Record<string, unknown>[] = [];
    let requestBody = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
    let upstream: BufferedUpstreamResponse | undefined;
    let replayOriginal = false;
    let replayReason = '';
    let finalInspectable = false;
    let aggregateUsage = false;

    const sendUpstreamError = (error: unknown): void => {
      if (req.aborted) return;
      log.error(`upstream request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'upstream_error', message: 'failed to reach upstream' } }));
      }
    };

    const maxQueryRounds = Math.max(0, config.virtualContext.maxQueryRounds);
    for (let round = 0; round <= maxQueryRounds; round++) {
      if (req.aborted) throw new Error('client aborted');
      try {
        upstream = await requestBuffered(
          target,
          req.method ?? 'POST',
          headers,
          new TextEncoder().encode(JSON.stringify(requestBody)),
        );
      } catch (error) {
        if (responses.length === 0) {
          sendUpstreamError(error);
          return;
        }
        replayOriginal = true;
        replayReason = 'continuation transport failed';
        break;
      }
      const encoding = upstream.headers['content-encoding'];
      const contentType = upstream.headers['content-type'];
      const isJson = (Array.isArray(contentType) ? contentType[0] : contentType)?.includes('application/json');
      if (
        upstream.statusCode < 200 ||
        upstream.statusCode >= 300 ||
        encoding != null ||
        !isJson
      ) {
        if (responses.length > 0) {
          replayOriginal = true;
          replayReason = 'continuation returned an uninspectable response';
        }
        break;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(upstream.body.toString()) as Record<string, unknown>;
      } catch {
        if (responses.length > 0) {
          replayOriginal = true;
          replayReason = 'continuation returned invalid JSON';
        }
        break;
      }
      responses.push(parsed);
      finalInspectable = true;
      const hasVirtualCall = hasVirtualAnthropicToolUse(parsed);
      const continuation = continueVirtualAnthropicTurn(
        requestBody,
        parsed,
        pixroom.virtualContext,
        allowedIds,
      );
      if (!continuation) {
        if (hasVirtualCall) {
          replayOriginal = true;
          replayReason = 'response mixed internal and client-owned tools';
        } else {
          aggregateUsage = responses.length > 1;
        }
        break;
      }
      if (round === maxQueryRounds) {
        replayOriginal = true;
        replayReason = 'query round limit reached';
        break;
      }
      requestBody = continuation;
    }

    if (replayOriginal) {
      log.warn(`virtual continuation degraded (${replayReason}); replaying original request`);
      try {
        upstream = await requestBuffered(
          target,
          req.method ?? 'POST',
          headers,
          originalBodyBytes,
        );
      } catch (error) {
        sendUpstreamError(error);
        return;
      }
      finalInspectable = false;
      const replayEncoding = upstream.headers['content-encoding'];
      const replayContentType = upstream.headers['content-type'];
      const replayIsJson = (Array.isArray(replayContentType) ? replayContentType[0] : replayContentType)
        ?.includes('application/json');
      if (
        upstream.statusCode >= 200 &&
        upstream.statusCode < 300 &&
        replayEncoding == null &&
        replayIsJson
      ) {
        try {
          const parsedReplay = JSON.parse(upstream.body.toString()) as Record<string, unknown>;
          responses.push(parsedReplay);
          finalInspectable = true;
          aggregateUsage = responses.length > 1;
        } catch {
          log.warn('virtual replay usage could not be aggregated: invalid JSON response');
        }
      } else if (responses.length > 0) {
        log.warn('virtual replay usage could not be aggregated: uninspectable response');
      }
    }
    if (!upstream) throw new Error('virtual upstream returned no response');
    let finalBody = upstream.body;
    if (aggregateUsage) {
      finalBody = Buffer.from(JSON.stringify(aggregateAnthropicUsage(responses)));
    }
    const outgoingHeaders = responseHeaders(upstream.headers);
    if (aggregateUsage) delete outgoingHeaders['content-encoding'];
    outgoingHeaders['content-length'] = String(finalBody.byteLength);

    if (finalInspectable) {
      const eventContext = { exchangeId, provider: 'anthropic' as const, protocolId, pathname: pathAndQuery };
      const decoder = createResponseEventDecoder({
        provider: 'anthropic',
        contentType: 'application/json',
        onEvent: (event) => outputs.dispatch(event, eventContext),
      });
      decoder.push(finalBody);
      decoder.end();
    }

    res.writeHead(upstream.statusCode, outgoingHeaders);
    res.end(finalBody);
  }

  async function forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    provider: Provider,
    pathAndQuery: string,
    bodyBytes: Uint8Array | undefined,
    protocolId: string | undefined,
    exchangeId: string,
  ): Promise<void> {
    const base = config.upstreams[provider].replace(/\/+$/, '');
    const target = `${base}${pathAndQuery}`;
    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const targetUrl = new URL(target);
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const agent = targetUrl.protocol === 'https:' ? httpsAgent : httpAgent;
    const headers = requestHeaders(req.headers);
    if (bodyBytes !== undefined) headers['content-length'] = String(bodyBytes.byteLength);

    await new Promise<void>((resolve) => {
      const upstreamRequest = transport.request(
        targetUrl,
        { method, headers, agent },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, responseHeaders(upstream.headers));
          const encoding = upstream.headers['content-encoding'];
          const observe =
            encoding == null &&
            (pixroom.ccr.hasOffloaded() || (options.outputIntegrations?.length ?? 0) > 0);
          if (observe) {
            const eventContext = { exchangeId, provider, protocolId, pathname: pathAndQuery };
            const contentType = upstream.headers['content-type'];
            const decoder = createResponseEventDecoder({
              provider,
              contentType: Array.isArray(contentType) ? contentType[0] : contentType,
              onEvent: (event) => outputs.dispatch(event, eventContext),
            });
            upstream.on('data', (chunk: Buffer) => decoder.push(chunk));
            upstream.on('end', () => decoder.end());
            upstream.on('error', () => decoder.end());
          }
          upstream.pipe(res);
          resolve();
        },
      );

      const onAborted = () => upstreamRequest.destroy(new Error('client aborted'));
      req.once('aborted', onAborted);
      upstreamRequest.once('close', () => req.off('aborted', onAborted));
      upstreamRequest.once('error', (error) => {
        req.off('aborted', onAborted);
        if (!req.aborted) {
          log.error(`upstream request failed: ${error.message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ error: { type: 'upstream_error', message: 'failed to reach upstream' } }),
            );
          } else {
            res.destroy(error);
          }
        }
        resolve();
      });

      if (!hasBody) {
        upstreamRequest.end();
      } else if (bodyBytes !== undefined) {
        upstreamRequest.end(bodyBytes);
      } else {
        req.pipe(upstreamRequest);
      }
    });
  }

  function sendHealth(res: http.ServerResponse): void {
    const body = {
      status: 'ok',
      mode: config.mode,
      optical: { enabled: config.optical.enabled },
      semantic: { enabled: config.semantic.enabled, sidecar: pixroom.sidecar.status, url: pixroom.sidecar.url },
      virtualContext: {
        enabled: config.virtualContext.enabled,
        queryFallback: config.virtualContext.queryFallback,
        datasets: pixroom.virtualContext.size,
        bytes: pixroom.virtualContext.bytes,
      },
      integrations: pixroom.integrations.list().map((integration) => ({
        id: integration.id,
        version: integration.version,
        regions: integration.capabilities.regions,
        fidelity: integration.capabilities.fidelity,
      })),
      protocols: protocols.list().map((protocol) => protocol.id),
      upstreams: config.upstreams,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function sendStats(res: http.ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(pixroom.stats(), null, 2));
  }

  return {
    pixroom,
    async listen() {
      await pixroom.warmup();
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
      const address = server.address();
      const port = typeof address === 'object' && address != null ? address.port : config.port;
      log.info(`pixroom proxy listening on http://${config.host}:${port}`);
      log.info(`  mode: ${config.mode}`);
      log.info(`  anthropic → ${config.upstreams.anthropic}`);
      log.info(`  openai    → ${config.upstreams.openai}`);
      log.info(`  semantic sidecar: ${pixroom.sidecar.status} (${pixroom.sidecar.url})`);
      return { host: config.host, port };
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      httpAgent.destroy();
      httpsAgent.destroy();
      await pixroom.shutdown();
    },
  };
}
