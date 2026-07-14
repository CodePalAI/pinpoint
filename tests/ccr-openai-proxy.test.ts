import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessorIntegration } from '../src/kernel/types.js';
import { counterfactual } from '../src/measurement/savings.js';
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

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>));
    request.on('error', reject);
  });
}

function offloader(): ProcessorIntegration {
  return {
    id: 'test.openai-offload',
    version: '1',
    order: 1,
    capabilities: { regions: ['history'], fidelity: 'reversible', cacheImpact: 'preserve' },
    async propose() {
      return {
        id: 'test.openai-offload:1',
        integrationId: this.id,
        regions: ['history'],
        fidelity: 'reversible',
        cacheImpact: 'preserve',
        patch: {
          appendReversible: [
            {
              id: 'rec_openai_test',
              origin: 'optical',
              original: 'OPENAI FULL ORIGINAL',
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

async function proxyFor(upstream: http.Server): Promise<number> {
  upstreams.push(upstream);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = createProxyServer(
    {
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      ccr: { continueToolCalls: true, maxContinuationRounds: 2 },
      logLevel: 'silent',
    },
    {
      runtime: { includeBuiltinIntegrations: false, integrations: [offloader()] },
    },
  );
  proxies.push(proxy);
  return (await proxy.listen()).port;
}

describe('OpenAI server-side CCR continuation', () => {
  it('continues Responses function calls and aggregates usage', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const port = await proxyFor(
      http.createServer((request, response) => {
        void readJson(request).then((body) => {
          forwarded.push(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          if (forwarded.length === 1) {
            response.end(JSON.stringify({
              id: 'resp_retrieve',
              object: 'response',
              status: 'completed',
              output: [{
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'headroom_retrieve',
                arguments: '{"id":"rec_openai_test"}',
              }],
              usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
            }));
            return;
          }
          response.end(JSON.stringify({
            id: 'resp_final',
            object: 'response',
            status: 'completed',
            output: [{
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'responses retrieved' }],
            }],
            usage: { input_tokens: 25, output_tokens: 3, total_tokens: 28 },
          }));
        });
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5', stream: false, input: 'Use compressed context.' }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    expect(forwarded).toHaveLength(2);
    expect(JSON.stringify(forwarded[1])).toContain('OPENAI FULL ORIGINAL');
    expect(JSON.stringify(result)).not.toContain('headroom_retrieve');
    expect(result.usage).toEqual({ input_tokens: 125, output_tokens: 8, total_tokens: 133 });
  });

  it('returns Responses SSE after hidden retrieval rounds', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const port = await proxyFor(
      http.createServer((request, response) => {
        void readJson(request).then((body) => {
          forwarded.push(body);
          expect(body.stream).toBe(false);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(
            forwarded.length === 1
              ? {
                  id: 'resp_retrieve',
                  object: 'response',
                  output: [{
                    type: 'function_call',
                    id: 'fc_1',
                    call_id: 'call_1',
                    name: 'headroom_retrieve',
                    arguments: '{"id":"rec_openai_test"}',
                  }],
                  usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
                }
              : {
                  id: 'resp_final',
                  object: 'response',
                  status: 'completed',
                  output: [{
                    type: 'message',
                    id: 'msg_1',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'stream retrieved' }],
                  }],
                  usage: { input_tokens: 25, output_tokens: 3, total_tokens: 28 },
                },
          ));
        });
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5', stream: true, input: 'Use compressed context.' }),
    });
    const text = await response.text();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: response.created');
    expect(text).toContain('event: response.output_text.delta');
    expect(text).toContain('stream retrieved');
    expect(text).toContain('event: response.completed');
    expect(text).not.toContain('headroom_retrieve');
  });

  it('continues Chat Completions tool calls with tool-role results', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const port = await proxyFor(
      http.createServer((request, response) => {
        void readJson(request).then((body) => {
          forwarded.push(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(
            forwarded.length === 1
              ? {
                  id: 'chat_retrieve',
                  choices: [{
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [{
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'headroom_retrieve',
                          arguments: '{"id":"rec_openai_test"}',
                        },
                      }],
                    },
                    finish_reason: 'tool_calls',
                  }],
                  usage: { prompt_tokens: 80, completion_tokens: 5, total_tokens: 85 },
                }
              : {
                  id: 'chat_final',
                  choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'chat retrieved' },
                    finish_reason: 'stop',
                  }],
                  usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
                },
          ));
        });
      }),
    );

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-test',
        stream: false,
        messages: [{ role: 'user', content: 'Use compressed context.' }],
      }),
    });
    const result = (await response.json()) as Record<string, unknown>;

    expect(JSON.stringify(forwarded[1])).toContain('OPENAI FULL ORIGINAL');
    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 });
    expect(JSON.stringify(result)).toContain('chat retrieved');
  });

  it('replays the original Responses request when internal and client tools are mixed', async () => {
    const forwarded: Record<string, unknown>[] = [];
    const port = await proxyFor(
      http.createServer((request, response) => {
        void readJson(request).then((body) => {
          forwarded.push(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(
            forwarded.length === 1
              ? {
                  id: 'resp_mixed',
                  object: 'response',
                  output: [
                    {
                      type: 'function_call',
                      id: 'fc_internal',
                      call_id: 'call_internal',
                      name: 'headroom_retrieve',
                      arguments: '{"id":"rec_openai_test"}',
                    },
                    {
                      type: 'function_call',
                      id: 'fc_client',
                      call_id: 'call_client',
                      name: 'client_tool',
                      arguments: '{}',
                    },
                  ],
                  usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
                }
              : {
                  id: 'resp_replay',
                  object: 'response',
                  status: 'completed',
                  output: [{
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'clean replay' }],
                  }],
                  usage: { input_tokens: 30, output_tokens: 2, total_tokens: 32 },
                },
          ));
        });
      }),
    );
    const original = {
      model: 'gpt-5',
      stream: false,
      input: 'Use compressed context.',
      tools: [{ type: 'function', name: 'client_tool', parameters: { type: 'object' } }],
    };

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });
    const result = (await response.json()) as Record<string, unknown>;

    expect(forwarded).toHaveLength(2);
    expect(forwarded[1]).toEqual(original);
    expect(JSON.stringify(result)).toContain('clean replay');
    expect(JSON.stringify(result)).not.toContain('headroom_retrieve');
    expect(result.usage).toEqual({ input_tokens: 130, output_tokens: 7, total_tokens: 137 });
  });
});