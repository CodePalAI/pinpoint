import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessorIntegration } from '../src/kernel/types.js';
import { counterfactual } from '../src/measurement/savings.js';
import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';
import { closeTestServer } from './helpers/http.js';

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(upstreams.splice(0).map(closeTestServer));
});

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>));
    request.on('error', reject);
  });
}

function offloadIntegration(original: string): ProcessorIntegration {
  return {
    id: 'test.inline-offload',
    version: '1',
    order: 1,
    capabilities: {
      regions: ['history'],
      fidelity: 'reversible',
      cacheImpact: 'preserve',
    },
    async propose() {
      return {
        id: 'test.inline-offload:1',
        integrationId: this.id,
        regions: ['history'],
        fidelity: 'reversible',
        cacheImpact: 'preserve',
        patch: {
          appendReversible: [
            {
              id: 'rec_ccr_test',
              origin: 'optical',
              original,
              contentType: 'prose',
            },
          ],
          appendStages: [
            {
              stage: 'optical',
              applied: true,
              reason: 'applied',
              counterfactual: counterfactual(100, 10, 'estimate'),
              reversible: [],
            },
          ],
        },
      };
    },
  };
}

async function startProxy(stream: boolean): Promise<{
  port: number;
  forwarded: Record<string, unknown>[];
}> {
  const forwarded: Record<string, unknown>[] = [];
  const upstream = http.createServer((request, response) => {
    void readJson(request).then((body) => {
      forwarded.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      if (forwarded.length === 1) {
        expect(body.stream).toBe(false);
        response.end(
          JSON.stringify({
            id: 'msg_retrieve',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_retrieve',
                name: 'headroom_retrieve',
                input: { id: 'rec_ccr_test' },
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 100, output_tokens: 5 },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          id: 'msg_final',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'retrieved answer' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 25, output_tokens: 3 },
        }),
      );
    });
  });
  upstreams.push(upstream);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = createProxyServer(
    {
      port: 0,
      upstreams: { anthropic: `http://127.0.0.1:${upstreamPort}` },
      ccr: { continueToolCalls: true, maxContinuationRounds: 2 },
      logLevel: 'silent',
    },
    {
      runtime: {
        includeBuiltinIntegrations: false,
        integrations: [offloadIntegration('FULL ORIGINAL FROM CCR')],
      },
    },
  );
  proxies.push(proxy);
  const address = await proxy.listen();
  return { port: address.port, forwarded };
}

describe('server-side CCR continuation', () => {
  it('executes headroom_retrieve locally and aggregates hidden usage', async () => {
    const { port, forwarded } = await startProxy(false);
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': 'test',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-test',
        stream: false,
        messages: [{ role: 'user', content: 'Use the compressed context.' }],
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    expect(forwarded).toHaveLength(2);
    expect(JSON.stringify(forwarded[0])).toContain('headroom_retrieve');
    expect(JSON.stringify(forwarded[1])).toContain('FULL ORIGINAL FROM CCR');
    expect(JSON.stringify(result)).not.toContain('headroom_retrieve');
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'retrieved answer' }],
      usage: { input_tokens: 125, output_tokens: 8 },
    });
  });

  it('buffers internal rounds and returns Anthropic SSE to streaming clients', async () => {
    const { port, forwarded } = await startProxy(true);
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': 'test',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-test',
        stream: true,
        messages: [{ role: 'user', content: 'Use the compressed context.' }],
      }),
    });
    const text = await response.text();

    expect(forwarded).toHaveLength(2);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: content_block_delta');
    expect(text).toContain('retrieved answer');
    expect(text).not.toContain('headroom_retrieve');
    expect(text).toContain('"input_tokens":125');
    expect(text).toContain('"output_tokens":8');
  });
});