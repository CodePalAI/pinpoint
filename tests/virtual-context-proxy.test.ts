import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(
    upstreams.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>));
    req.on('error', reject);
  });
}

describe('virtual-context proxy continuation', () => {
  it('executes pixroom_query locally and returns the final model response with aggregate usage', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const upstream = http.createServer((req, res) => {
      void readJson(req).then((body) => {
        forwarded.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        if (forwarded.length === 1) {
          const id = JSON.stringify(body).match(/vctx_[a-f0-9]{32}/)?.[0];
          res.end(
            JSON.stringify({
              id: 'msg_query',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_query',
                  name: 'pixroom_query',
                  input: {
                    id,
                    op: 'json_select',
                    where: { id: 73 },
                    fields: ['email'],
                  },
                },
              ],
              stop_reason: 'tool_use',
              usage: { input_tokens: 120, output_tokens: 8 },
            }),
          );
          return;
        }
        res.end(
          JSON.stringify({
            id: 'msg_final',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'user73@example.com' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 30, output_tokens: 4 },
          }),
        );
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: {
        enabled: true,
        queryFallback: true,
        minChars: 500,
        protectRecent: 1,
        maxQueryRounds: 2,
      },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 100 }, (_, id) => ({
      id,
      email: `user${id}@example.com`,
      active: id % 2 === 0,
    }));
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 32,
        stream: false,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_data', name: 'read_data', input: {} }],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_data', content: JSON.stringify(rows) },
            ],
          },
          { role: 'assistant', content: 'Data loaded.' },
          { role: 'user', content: 'Find one unusual account and return its email.' },
        ],
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(2);
    expect(JSON.stringify(forwarded[0])).toContain('<<pixroom_virtual');
    expect(JSON.stringify(forwarded[0])).toContain('"name":"pixroom_query"');
    expect(JSON.stringify(forwarded[0])).not.toContain('user73@example.com');
    const continuationMessages = forwarded[1].messages as Array<Record<string, unknown>>;
    const toolResultMessage = continuationMessages.at(-1)!;
    const toolResult = (toolResultMessage.content as Array<Record<string, unknown>>)[0]!;
    expect(JSON.parse(String(toolResult.content))).toMatchObject({
      matches: [{ email: 'user73@example.com' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'user73@example.com' }]);
    expect(result.usage).toMatchObject({ input_tokens: 150, output_tokens: 12 });
  });

  it('replays the original request instead of leaking a mixed internal tool call', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const upstream = http.createServer((req, res) => {
      void readJson(req).then((body) => {
        forwarded.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        if (forwarded.length === 1) {
          const id = JSON.stringify(body).match(/vctx_[a-f0-9]+/)?.[0];
          res.end(JSON.stringify({
            content: [
              { type: 'tool_use', id: 'q1', name: 'pixroom_query', input: { id, op: 'schema' } },
              { type: 'tool_use', id: 'c1', name: 'client_tool', input: {} },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 100, output_tokens: 5 },
          }));
          return;
        }
        res.end(JSON.stringify({
          content: [{ type: 'text', text: 'clean fallback' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 3 },
        }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: { enabled: true, queryFallback: true, minChars: 100, protectRecent: 0 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 40 }, (_, id) => ({ id, value: `value-${id}` }));
    const original = {
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      tools: [{ name: 'client_tool', description: 'Client-owned', input_schema: { type: 'object' } }],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'data', name: 'read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'data', content: JSON.stringify(rows) }] },
        { role: 'user', content: 'Analyze unusual values.' },
      ],
    };

    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });

    expect(await response.json()).toMatchObject({
      content: [{ text: 'clean fallback' }],
      usage: { input_tokens: 300, output_tokens: 8 },
    });
    expect(forwarded).toHaveLength(2);
    expect(JSON.stringify(forwarded[0])).toContain('<<pixroom_virtual');
    expect(forwarded[1]).toEqual(original);
  });

  it('replays the original request when the hidden query round cap is reached', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const upstream = http.createServer((req, res) => {
      void readJson(req).then((body) => {
        forwarded.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        if (JSON.stringify(body).includes('<<pixroom_virtual')) {
          const id = JSON.stringify(body).match(/vctx_[a-f0-9]+/)?.[0];
          res.end(JSON.stringify({
            content: [{
              type: 'tool_use',
              id: `query-${forwarded.length}`,
              name: 'pixroom_query',
              input: { id, op: 'schema' },
            }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 50, output_tokens: 4 },
          }));
          return;
        }
        res.end(JSON.stringify({
          content: [{ type: 'text', text: 'cap fallback' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 2 },
        }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: {
        enabled: true,
        queryFallback: true,
        minChars: 100,
        protectRecent: 0,
        maxQueryRounds: 1,
      },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 40 }, (_, id) => ({ id, value: `value-${id}` }));
    const original = {
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'data', name: 'read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'data', content: JSON.stringify(rows) }] },
        { role: 'user', content: 'Analyze unusual values.' },
      ],
    };

    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });

    expect(await response.json()).toMatchObject({
      content: [{ text: 'cap fallback' }],
      usage: { input_tokens: 300, output_tokens: 10 },
    });
    expect(forwarded).toHaveLength(3);
    expect(forwarded[2]).toEqual(original);
  });

  it('replays the original request after a continuation transport failure', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const upstream = http.createServer((req, res) => {
      void readJson(req).then((body) => {
        forwarded.push(body);
        if (forwarded.length === 2) {
          req.socket.destroy();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        if (forwarded.length === 1) {
          const id = JSON.stringify(body).match(/vctx_[a-f0-9]+/)?.[0];
          res.end(JSON.stringify({
            content: [{
              type: 'tool_use', id: 'query', name: 'pixroom_query',
              input: { id, op: 'schema' },
            }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 50, output_tokens: 4 },
          }));
          return;
        }
        res.end(JSON.stringify({
          content: [{ type: 'text', text: 'transport fallback' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 2 },
        }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: { enabled: true, queryFallback: true, minChars: 100, protectRecent: 0 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 40 }, (_, id) => ({ id, value: `value-${id}` }));
    const original = {
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'data', name: 'read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'data', content: JSON.stringify(rows) }] },
        { role: 'user', content: 'Analyze unusual values.' },
      ],
    };

    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });

    expect(await response.json()).toMatchObject({
      content: [{ text: 'transport fallback' }],
      usage: { input_tokens: 250, output_tokens: 6 },
    });
    expect(forwarded).toHaveLength(3);
    expect(forwarded[2]).toEqual(original);
  });

  it('preserves encoded provider responses when they cannot be inspected', async () => {
    const compressed = gzipSync(JSON.stringify({ id: 'encoded', content: [{ type: 'text', text: 'OK' }] }));
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
    const proxy = createProxyServer({
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: { enabled: true, minChars: 100, protectRecent: 0 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 30 }, (_, id) => ({ id, value: `value-${id}` }));

    const result = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>(
      (resolve, reject) => {
        const request = http.request(
          `http://127.0.0.1:${port}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'x-api-key': 'test-key',
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
          },
        );
        request.on('error', reject);
        request.end(
          JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 8,
            messages: [
              { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu', name: 'read', input: {} }] },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu', content: JSON.stringify(rows) }] },
              { role: 'user', content: 'What is value for id 3?' },
            ],
          }),
        );
      },
    );

    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.body).toEqual(compressed);
  });
});