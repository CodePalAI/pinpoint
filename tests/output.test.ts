import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { CcrStore } from '../src/ccr/store.js';
import { InMemoryRecorder } from '../src/policy/retrieval-recorder.js';
import { CcrRetrievalOutputIntegration } from '../src/output/ccr.js';
import { OutputIntegrationRegistry } from '../src/output/registry.js';
import type { OutputEventContext, ResponseEvent } from '../src/output/types.js';
import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';
import { closeTestServer } from './helpers/http.js';

const context: OutputEventContext = {
  exchangeId: 'exchange-1',
  provider: 'openai',
  protocolId: 'openai.responses',
  pathname: '/v1/responses',
};

describe('output integrations', () => {
  it('deduplicates CCR retrievals within an exchange and resets at response end', () => {
    const recorder = new InMemoryRecorder();
    const ccr = new CcrStore(undefined, recorder);
    ccr.registerReversible([
      { id: 'rec_1', origin: 'optical', original: 'full', contentType: 'prose' },
    ]);
    const integration = new CcrRetrievalOutputIntegration(ccr);
    const toolCall: ResponseEvent = {
      type: 'tool-call',
      name: 'headroom_retrieve',
      arguments: '{"id":"rec_1"}',
    };

    integration.onEvent(toolCall, context);
    integration.onEvent(toolCall, context);
    expect(recorder.retrievals).toHaveLength(1);
    integration.onEvent({ type: 'response-end' }, context);
    integration.onEvent(toolCall, { ...context, exchangeId: 'exchange-2' });
    expect(recorder.retrievals).toHaveLength(2);
  });

  it('isolates subscriber failures and continues dispatching', async () => {
    const failures: string[] = [];
    const received: ResponseEvent[] = [];
    const registry = new OutputIntegrationRegistry((id, error) =>
      failures.push(`${id}:${error}`),
    )
      .register({ id: 'broken', onEvent: () => { throw new Error('boom'); } })
      .register({ id: 'healthy', onEvent: (event) => { received.push(event); } });

    registry.dispatch({ type: 'text-delta', text: 'ok' }, context);
    await Promise.resolve();
    expect(received).toEqual([{ type: 'text-delta', text: 'ok' }]);
    expect(failures).toEqual(['broken:boom']);
  });
});

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(upstreams.splice(0).map(closeTestServer));
});

describe('proxy output integration surface', () => {
  it('streams the response unchanged while emitting normalized events', async () => {
    const upstreamBody = {
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    };
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(upstreamBody));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const events: ResponseEvent[] = [];
    const proxy = createProxyServer(
      {
        port: 0,
        upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
        semantic: { enabled: false },
        optical: { enabled: false },
        logLevel: 'silent',
      },
      {
        outputIntegrations: [{ id: 'test.capture', onEvent: (event) => events.push(event) }],
      },
    );
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(await response.json()).toEqual(upstreamBody);
    expect(events).toContainEqual({ type: 'text-delta', text: 'hello' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'response-end' });
  });

  it('preserves compressed response bytes and skips parsing encoded content', async () => {
    const compressed = gzipSync(JSON.stringify({ choices: [{ message: { content: 'compressed' } }] }));
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': String(compressed.byteLength),
        });
        res.end(compressed);
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const events: ResponseEvent[] = [];
    const proxy = createProxyServer(
      {
        port: 0,
        upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
        semantic: { enabled: false },
        optical: { enabled: false },
        logLevel: 'silent',
      },
      { outputIntegrations: [{ id: 'test.capture', onEvent: (event) => events.push(event) }] },
    );
    proxies.push(proxy);
    const { port } = await proxy.listen();

    const result = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const request = http.request(
          `http://127.0.0.1:${port}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
          },
        );
        request.on('error', reject);
        request.end(JSON.stringify({ model: 'gpt-test', messages: [] }));
      },
    );

    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.body).toEqual(compressed);
    expect(events).toEqual([]);
  });
});