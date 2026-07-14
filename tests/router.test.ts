import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPixroom } from '../src/pixroom.js';
import { CCR_TOOL_NAME } from '../src/ccr/store.js';

interface FakeSidecar {
  url: string;
  close: () => Promise<void>;
}

/** A minimal stand-in for the headroom `/v1/compress` + `/v1/retrieve` seam. */
async function startFakeSidecar(): Promise<FakeSidecar> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url.startsWith('/v1/retrieve/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ original_content: 'FULL ORIGINAL CONTENT' }));
      return;
    }
    if (url === '/v1/compress' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
          messages: Array<{ content: unknown }>;
        };
        const sent = parsed.messages;
        const messages = sent.map((m, i) => ({
          role: 'tool',
          content: `<<ccr:h${i}>> ${String(m.content).slice(0, 16)}`,
        }));
        const before = sent.reduce((a, m) => a + Math.ceil(String(m.content).length / 4), 0);
        const after = messages.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            messages,
            tokens_before: before,
            tokens_after: after,
            tokens_saved: before - after,
            compression_ratio: before === 0 ? 1 : after / before,
            transforms_applied: ['fake_smart_crusher'],
            ccr_hashes: messages.map((_, i) => `h${i}`),
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function bodyWithToolResult(content: string): Record<string, unknown> {
  return {
    model: 'claude-fable-5',
    system: 'You are helpful.',
    messages: [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content }] },
    ],
  };
}

describe('ContentRouter end-to-end', () => {
  it('compresses the semantic region, injects the retrieve tool, and stays reversible', async () => {
    const fake = await startFakeSidecar();
    const px = createPixroom({
      optical: { enabled: false },
      semantic: {
        enabled: true,
        autoSpawn: false,
        sidecarUrl: fake.url,
        protectRecent: 0,
        minTokensToCompress: 10,
      },
    });

    const big = JSON.stringify(
      Array.from({ length: 60 }, (_, i) => ({ id: i, name: `row_${i}`, value: i * 7 })),
    );
    const routed = await px.route('anthropic', 'claude-fable-5', bodyWithToolResult(big));

    const semantic = routed.report.rows.find((r) => r.stage === 'semantic')!;
    expect(semantic.applied).toBe(true);
    expect(routed.report.tokensSavedTotal).toBeGreaterThan(0);

    const messages = routed.body.messages as Array<{ content: Array<{ content: string }> }>;
    expect(messages[0]!.content[0]!.content).toContain('<<ccr:h0>>');

    const tools = routed.body.tools as Array<{ name?: string }>;
    expect(tools.some((t) => t.name === CCR_TOOL_NAME)).toBe(true);

    expect(routed.reversible.length).toBeGreaterThan(0);
    expect(await px.retrieve('h0')).toBe('FULL ORIGINAL CONTENT');

    const unrelated = await px.route(
      'anthropic',
      'claude-fable-5',
      { model: 'claude-fable-5', messages: [{ role: 'user', content: 'hello' }] },
    );
    expect(unrelated.body.tools).toBeUndefined();
    expect(unrelated.ccrToolNeeded).toBe(false);

    await px.shutdown();
    await fake.close();
  });

  it('degrades to a safe pass-through when the sidecar is unreachable', async () => {
    const original = 'x'.repeat(3000);
    const px = createPixroom({
      optical: { enabled: false },
      semantic: {
        enabled: true,
        autoSpawn: false,
        sidecarUrl: 'http://127.0.0.1:1',
        healthTimeoutMs: 300,
        minTokensToCompress: 10,
        protectRecent: 0,
      },
    });

    const routed = await px.route('anthropic', 'claude-fable-5', bodyWithToolResult(original));
    const semantic = routed.report.rows.find((r) => r.stage === 'semantic')!;
    expect(semantic.applied).toBe(false);
    expect(semantic.reason).toBe('degraded');

    // Body untouched; no retrieve tool injected.
    const messages = routed.body.messages as Array<{ content: Array<{ content: string }> }>;
    expect(messages[0]!.content[0]!.content).toBe(original);
    expect(routed.body.tools).toBeUndefined();

    await px.shutdown();
  });
});
