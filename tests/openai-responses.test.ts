import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createPixroom } from '../src/pixroom.js';
import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';
import { closeTestServer } from './helpers/http.js';

const SYSTEM = (
  'You are a coding agent. Read files before editing, preserve exact identifiers, and verify changes. '
).repeat(400);

function body(): Record<string, unknown> {
  return {
    model: 'gpt-5',
    instructions: SYSTEM,
    input: 'Reply with exactly OK.',
    stream: false,
  };
}

function qcvBody(stream = false): Record<string, unknown> {
  const rows = Array.from({ length: 60 }, (_, id) => ({
    id,
    email: `user${id}@example.com`,
  }));
  return {
    model: 'gpt-5',
    stream,
    input: [
      { type: 'function_call', call_id: 'call_data', name: 'read_data', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_data', output: JSON.stringify(rows) },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'What is the email for id 47?' }],
      },
    ],
  };
}

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(upstreams.splice(0).map(closeTestServer));
});

describe('OpenAI Responses support', () => {
  it('virtualizes exact function_call_output data with native input_text prefetch', async () => {
    const runtime = createPixroom({
      virtualContext: { enabled: true, queryFallback: true, minChars: 100, protectRecent: 1 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });

    const routed = await runtime.route('openai', 'gpt-5', qcvBody(true), 'payg');
    const input = routed.body.input as Array<Record<string, unknown>>;

    expect(routed.virtualized).toBe(true);
    expect(routed.virtualQueryToolNeeded).toBe(false);
    expect(input[1]?.output).toContain('<<pixroom_virtual');
    expect(JSON.stringify(input[2]?.content)).toContain('user47@example.com');
    expect(JSON.stringify(input[2]?.content)).toContain('input_text');
    expect(JSON.stringify(routed.body)).not.toContain('pixroom_query');
    await runtime.shutdown();
  });

  it('transforms exact Responses QCV requests before proxy forwarding', async () => {
    let forwarded: Record<string, unknown> | undefined;
    const upstream = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        forwarded = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'resp_qcv', output_text: 'user47@example.com' }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      virtualContext: { enabled: true, minChars: 100, protectRecent: 1 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(qcvBody(false)),
    });

    expect(await response.json()).toMatchObject({ output_text: 'user47@example.com' });
    expect(JSON.stringify(forwarded)).toContain('<<pixroom_virtual');
    expect(JSON.stringify(forwarded)).toContain('user47@example.com');
  });

  it('optimizes a Responses body through the runtime integration pipeline', async () => {
    const runtime = createPixroom({
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    const routed = await runtime.route('openai', 'gpt-5', body(), 'payg');
    const row = routed.report.rows.find((item) => item.stage === 'optical');

    expect(row?.applied).toBe(true);
    expect(row?.tokensSaved).toBeGreaterThan(0);
    expect(routed.opticalOwnsCacheControl).toBe(false);
    expect(routed.body.instructions).not.toBe(SYSTEM);
    const input = routed.body.input as Array<{ content?: Array<{ type?: string }> }>;
    expect(input.some((item) => item.content?.some((part) => part.type === 'input_image'))).toBe(
      true,
    );
    expect(JSON.stringify(routed.body)).toContain('Reply with exactly OK.');
    await runtime.shutdown();
  });

  it('transforms POST /v1/responses before forwarding and passes the response through', async () => {
    let forwarded: Record<string, unknown> | undefined;
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        forwarded = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'resp_test', output_text: 'OK' }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });

    expect(await response.json()).toEqual({ id: 'resp_test', output_text: 'OK' });
    expect(forwarded).toBeDefined();
    expect(forwarded?.instructions).not.toBe(SYSTEM);
    expect(JSON.stringify(forwarded)).toContain('input_image');
  });

  it('keeps unsupported Responses bodies byte-equivalent', async () => {
    const runtime = createPixroom({
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    const original = { ...body(), model: 'unsupported-model' };
    const routed = await runtime.route(
      'openai',
      'unsupported-model',
      structuredClone(original),
      'payg',
    );

    expect(routed.body).toEqual(original);
    expect(routed.report.rows.find((item) => item.stage === 'optical')).toMatchObject({
      applied: false,
      reason: 'unsupported_model',
    });
    await runtime.shutdown();
  });

  it('forwards raw bytes without JSON churn when every optimizer is disabled', async () => {
    let forwarded = '';
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        forwarded = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const raw = '{\n  "model": "gpt-5",\n  "input": "hello",\n  "vendor": { "z": 1, "a": 2 }\n}\n';

    await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: raw,
    });

    expect(forwarded).toBe(raw);
  });
});