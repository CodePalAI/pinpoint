import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessorIntegration } from '../src/kernel/types.js';
import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';
import { closeTestServer } from './helpers/http.js';

const proxies: ProxyServer[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(servers.splice(0).map(closeTestServer));
});

function mutatingIntegration(): ProcessorIntegration {
  return {
    id: 'test.must-not-inspect',
    version: 'test',
    order: 1,
    capabilities: { regions: ['current-turn'], fidelity: 'lossless', cacheImpact: 'preserve' },
    async propose(ctx) {
      return {
        id: 'test.must-not-inspect:1',
        integrationId: this.id,
        regions: ['current-turn'],
        fidelity: 'lossless',
        cacheImpact: 'preserve',
        patch: { replaceBody: { ...ctx.body, inspected: true } },
      };
    },
  };
}

async function echoUpstream(): Promise<{
  readonly url: string;
  readonly bodies: Buffer[];
}> {
  const bodies: Buffer[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies };
}

async function proxyFor(upstream: string, maxInspectionBytes: number): Promise<number> {
  const proxy = createProxyServer(
    {
      port: 0,
      maxInspectionBytes,
      upstreams: { openai: upstream },
      semantic: { enabled: false },
      optical: { enabled: false },
      virtualContext: { enabled: false },
      logLevel: 'silent',
    },
    { runtime: { includeBuiltinIntegrations: false, integrations: [mutatingIntegration()] } },
  );
  proxies.push(proxy);
  return (await proxy.listen()).port;
}

describe('proxy resource limits and lifecycle', () => {
  it('streams a known oversized request unchanged without inspection', async () => {
    const upstream = await echoUpstream();
    const port = await proxyFor(upstream.url, 64);
    const original = Buffer.from(JSON.stringify({ model: 'gpt-test', input: 'x'.repeat(512) }));

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: original,
    });

    expect(response.status).toBe(200);
    expect(upstream.bodies).toEqual([original]);
    expect(upstream.bodies[0]?.toString()).not.toContain('inspected');
  });

  it('preserves the consumed prefix when a chunked request exceeds the cap', async () => {
    const upstream = await echoUpstream();
    const port = await proxyFor(upstream.url, 64);
    const original = Buffer.from(JSON.stringify({ model: 'gpt-test', input: 'y'.repeat(512) }));

    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        `http://127.0.0.1:${port}/v1/responses`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.on('error', reject);
      request.write(original.subarray(0, 40));
      request.write(original.subarray(40, 180));
      request.end(original.subarray(180));
    });

    expect(status).toBe(200);
    expect(upstream.bodies).toEqual([original]);
    expect(upstream.bodies[0]?.toString()).not.toContain('inspected');
  });

  it('rejects an occupied port and remains safe to close', async () => {
    const occupied = http.createServer();
    servers.push(occupied);
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as AddressInfo).port;
    const proxy = createProxyServer({
      host: '127.0.0.1',
      port,
      semantic: { enabled: false },
      optical: { enabled: false },
      virtualContext: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);

    await expect(proxy.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(proxy.close()).resolves.toBeUndefined();
  });
});