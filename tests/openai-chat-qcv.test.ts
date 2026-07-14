import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';
import { closeTestServer } from './helpers/http.js';

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(upstreams.splice(0).map(closeTestServer));
});

describe('OpenAI Chat exact QCV', () => {
  it('virtualizes pretty-printed tool messages and appends native text prefetch', async () => {
    let forwarded: Record<string, unknown> | undefined;
    const upstream = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        forwarded = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'chat_qcv',
          choices: [{ message: { role: 'assistant', content: 'user31@example.com' }, finish_reason: 'stop' }],
        }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: { enabled: true, queryFallback: true, minChars: 100, protectRecent: 1 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const rows = Array.from({ length: 50 }, (_, id) => ({ id, email: `user${id}@example.com` }));
    const raw = JSON.stringify(
      {
        model: 'gpt-test',
        messages: [
          { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_data', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify(rows) },
          { role: 'user', content: 'What is email for id 31?' },
        ],
      },
      null,
      2,
    );

    await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: raw,
    });

    expect(JSON.stringify(forwarded)).toContain('<<pixroom_virtual');
    expect(JSON.stringify(forwarded)).toContain('user31@example.com');
    expect(JSON.stringify(forwarded)).not.toContain('pixroom_query');
  });
});