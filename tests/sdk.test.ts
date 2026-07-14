import http from 'node:http';

import { describe, expect, it } from 'vitest';

import { withPixroom as withPixroomAnthropic } from '../src/sdk/anthropic.js';
import { withPixroom as withPixroomOpenAI } from '../src/sdk/openai.js';
import type { ProcessorIntegration } from '../src/kernel/types.js';
import { closeTestServer } from './helpers/http.js';

interface ReceivedRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

class TestProviderClient {
  constructor(public baseURL: string) {}

  post(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

function markerIntegration(): ProcessorIntegration {
  return {
    id: 'test.sdk-marker',
    version: '1',
    order: 1,
    capabilities: {
      regions: ['current-turn'],
      fidelity: 'lossless',
      cacheImpact: 'preserve',
    },
    async propose(ctx) {
      return {
        id: 'test.sdk-marker:1',
        integrationId: this.id,
        regions: ['current-turn'],
        fidelity: 'lossless',
        cacheImpact: 'preserve',
        patch: { replaceBody: { ...ctx.body, pixroom_marker: true } },
      };
    },
  };
}

async function listen(
  respond: (request: ReceivedRequest, response: http.ServerResponse) => void,
): Promise<{ baseURL: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      respond({ path: request.url ?? '/', body }, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('missing test server address');
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => closeTestServer(server),
  };
}

const wrapperOptions = {
  config: {
    semantic: { enabled: false },
    optical: { enabled: false },
    virtualContext: { enabled: false },
    logLevel: 'silent' as const,
  },
  runtime: {
    includeBuiltinIntegrations: false,
    integrations: [markerIntegration()],
  },
};

describe('provider SDK wrappers', () => {
  it('wraps Anthropic calls, preserves the upstream base path, and restores the client', async () => {
    let received: ReceivedRequest | undefined;
    const upstream = await listen((request, response) => {
      received = request;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ok' }] }));
    });
    const originalBaseURL = `${upstream.baseURL}/gateway/anthropic`;
    const client = new TestProviderClient(originalBaseURL);
    const wrapped = await withPixroomAnthropic(client, wrapperOptions);

    try {
      const response = await wrapped.post('/v1/messages', {
        model: 'claude-test',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(response.status).toBe(200);
      expect(received?.path).toBe('/gateway/anthropic/v1/messages');
      expect(received?.body.pixroom_marker).toBe(true);
      expect(wrapped.pixroom.stats().requests).toBe(1);
      expect(wrapped.baseURL).toBe(wrapped.pixroom.baseURL);
    } finally {
      await wrapped.pixroom.close();
      await upstream.close();
    }

    expect(client.baseURL).toBe(originalBaseURL);
    expect(Reflect.has(client, 'pixroom')).toBe(false);
  });

  it('wraps OpenAI Responses calls without changing native SSE bytes', async () => {
    let received: ReceivedRequest | undefined;
    const stream = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';
    const upstream = await listen((request, response) => {
      received = request;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(stream);
    });
    const client = new TestProviderClient(`${upstream.baseURL}/v1`);
    const wrapped = await withPixroomOpenAI(client, wrapperOptions);

    try {
      const response = await wrapped.post('/responses', {
        model: 'gpt-test',
        input: 'hello',
        stream: true,
      });

      expect(received?.path).toBe('/v1/responses');
      expect(received?.body.pixroom_marker).toBe(true);
      expect(await response.text()).toBe(stream);
    } finally {
      await wrapped.pixroom.close();
      await upstream.close();
    }
  });
});