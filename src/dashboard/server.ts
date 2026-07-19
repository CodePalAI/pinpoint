import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDashboardSnapshot,
  DashboardGroupReader,
  DEFAULT_DASHBOARD_ROOT,
  listDashboardHistory,
  readDashboardGroup,
} from './journal.js';
import type { DashboardSnapshot } from './types.js';

export const DEFAULT_DASHBOARD_PORT = 8790;
const DASHBOARD_HOST = '127.0.0.1';
const MAX_RECENT_EVENTS = 500;
const MAX_SSE_CLIENTS = 8;
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store, max-age=0',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface DashboardServerOptions {
  readonly rootDir?: string;
  readonly groupId: string;
  readonly port?: number;
  readonly strictPort?: boolean;
  readonly assetsDir?: string;
  readonly token?: string;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
}

export interface DashboardServerAddress {
  readonly host: typeof DASHBOARD_HOST;
  readonly port: number;
  readonly url: string;
  readonly launchUrl: string;
}

export interface DashboardServer {
  readonly token: string;
  listen(): Promise<DashboardServerAddress>;
  close(): Promise<void>;
  address(): DashboardServerAddress | null;
}

function defaultAssetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'ui');
}

function applyHeaders(response: http.ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  applyHeaders(response);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

function bearerToken(request: http.IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
}

function tokenMatches(actual: string | null, expected: string): boolean {
  if (actual == null) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function eventLimit(url: URL): number {
  const raw = Number(url.searchParams.get('limit') ?? 100);
  return Number.isInteger(raw) ? Math.max(0, Math.min(MAX_RECENT_EVENTS, raw)) : 100;
}

function safeAssetPath(assetsDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = resolve(assetsDir, relativePath);
  const withinRoot = relative(assetsDir, candidate);
  if (!withinRoot || withinRoot.startsWith('..') || withinRoot.includes('..')) return null;
  return candidate;
}

export function createDashboardServer(options: DashboardServerOptions): DashboardServer {
  const rootDir = options.rootDir ?? DEFAULT_DASHBOARD_ROOT;
  const assetsDir = resolve(options.assetsDir ?? defaultAssetsDir());
  const token = options.token ?? randomBytes(32).toString('base64url');
  const preferredPort = options.port ?? DEFAULT_DASHBOARD_PORT;
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 750);
  const now = options.now ?? (() => new Date());
  let bound: DashboardServerAddress | null = null;
  let listenPromise: Promise<DashboardServerAddress> | null = null;
  let closePromise: Promise<void> | null = null;
  let polling: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let lastSignature = '';
  const clients = new Set<http.ServerResponse>();
  const groupReader = new DashboardGroupReader(rootDir, options.groupId);

  const snapshot = (limit = 100): DashboardSnapshot =>
    buildDashboardSnapshot(groupReader.read(), now(), limit);

  const writeSse = (response: http.ServerResponse, event: string, value: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  };

  const snapshotSignature = (current: DashboardSnapshot): string => JSON.stringify({
    state: current.state,
    requests: current.requests,
    eventCount: current.eventCount,
    negativeSavingsRoutes: current.negativeSavingsRoutes,
    reversibleCount: current.reversibleCount,
    corruptRecords: current.corruptRecords,
    tokenLanes: current.tokenLanes,
    byteLanes: current.byteLanes,
    mcp: current.mcp,
    headroom: current.headroom,
    sources: current.sources,
    latest: current.recentEvents.at(-1)?.occurredAt ?? null,
  });

  const broadcastIfChanged = (): void => {
    if (clients.size === 0) return;
    const current = snapshot();
    const signature = snapshotSignature(current);
    if (signature === lastSignature) return;
    lastSignature = signature;
    for (const client of clients) writeSse(client, 'snapshot', current);
  };

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      else response.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (!bound) return sendJson(response, 503, { error: 'dashboard_starting' });
    const expectedHost = `${bound.host}:${bound.port}`;
    if (request.headers.host !== expectedHost) return sendJson(response, 421, { error: 'invalid_host' });
    const expectedOrigin = `http://${expectedHost}`;
    const origin = request.headers.origin;
    if (origin != null && origin !== expectedOrigin) return sendJson(response, 403, { error: 'invalid_origin' });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }
    const url = new URL(request.url ?? '/', expectedOrigin);
    if (url.pathname === '/favicon.ico') {
      applyHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!tokenMatches(bearerToken(request), token)) {
        return sendJson(response, 401, { error: 'unauthorized' });
      }
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
      if (url.pathname === '/api/v1/health') {
        return sendJson(response, 200, { status: 'ok', schemaVersion: 1, groupId: options.groupId });
      }
      if (url.pathname === '/api/v1/snapshot') return sendJson(response, 200, snapshot());
      if (url.pathname === '/api/v1/events') {
        return sendJson(response, 200, { events: snapshot(eventLimit(url)).recentEvents });
      }
      if (url.pathname === '/api/v1/history') {
        const groupId = url.searchParams.get('group');
        if (groupId != null) {
          try {
            const group = readDashboardGroup(rootDir, groupId);
            if (group.producers.length === 0 && group.events.length === 0) {
              return sendJson(response, 404, { error: 'session_not_found' });
            }
            return sendJson(response, 200, { session: buildDashboardSnapshot(group, now(), MAX_RECENT_EVENTS) });
          } catch {
            return sendJson(response, 400, { error: 'invalid_session' });
          }
        }
        return sendJson(response, 200, { sessions: listDashboardHistory(rootDir) });
      }
      if (url.pathname === '/api/v1/stream') {
        if (clients.size >= MAX_SSE_CLIENTS) return sendJson(response, 429, { error: 'too_many_streams' });
        applyHeaders(response);
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        clients.add(response);
        const initial = snapshot();
        lastSignature = snapshotSignature(initial);
        writeSse(response, 'snapshot', initial);
        const removeClient = (): void => { clients.delete(response); };
        request.once('close', removeClient);
        response.once('close', removeClient);
        response.once('error', removeClient);
        return;
      }
      return sendJson(response, 404, { error: 'not_found' });
    }

    const assetPath = safeAssetPath(assetsDir, url.pathname);
    if (assetPath == null || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    applyHeaders(response);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(assetPath)] ?? 'application/octet-stream',
      'content-length': statSync(assetPath).size,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(assetPath).pipe(response);
  }

  const listenOn = (port: number): Promise<void> => new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, DASHBOARD_HOST);
  });

  return {
    token,
    listen() {
      listenPromise ??= (async () => {
        try {
          await listenOn(preferredPort);
        } catch (error) {
          const code = error != null && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
          if (options.strictPort || preferredPort === 0 || code !== 'EADDRINUSE') throw error;
          await listenOn(0);
        }
        const address = server.address();
        if (address == null || typeof address === 'string') throw new Error('dashboard address unavailable');
        const url = `http://${DASHBOARD_HOST}:${address.port}/`;
        bound = {
          host: DASHBOARD_HOST,
          port: address.port,
          url,
          launchUrl: `${url}#access_token=${encodeURIComponent(token)}`,
        };
        polling = setInterval(broadcastIfChanged, pollIntervalMs);
        polling.unref();
        heartbeat = setInterval(() => {
          for (const client of clients) client.write(': keep-alive\n\n');
        }, 15_000);
        heartbeat.unref();
        return bound;
      })();
      return listenPromise;
    },
    close() {
      closePromise ??= (async () => {
        if (polling) clearInterval(polling);
        if (heartbeat) clearInterval(heartbeat);
        polling = null;
        heartbeat = null;
        for (const client of clients) client.end();
        clients.clear();
        if (!server.listening) return;
        await new Promise<void>((resolveClose, rejectClose) =>
          server.close((error) => error ? rejectClose(error) : resolveClose()),
        );
      })();
      return closePromise;
    },
    address: () => bound,
  };
}