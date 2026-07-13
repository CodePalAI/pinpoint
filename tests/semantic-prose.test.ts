import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPixroom } from '../src/pixroom.js';
import { CCR_TOOL_NAME } from '../src/ccr/store.js';

interface FakeSidecar {
  url: string;
  seenRoles: string[];
  close: () => Promise<void>;
}

/**
 * A headroom `/v1/compress` stand-in that compresses ANY sent message content
 * (regardless of role) to a sentinel + prefix, so we can assert prose routing
 * without a real ML backend. Records the roles it was handed.
 */
async function startFakeSidecar(): Promise<FakeSidecar> {
  const seenRoles: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url.startsWith('/v1/retrieve/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ original_content: 'FULL ORIGINAL PROSE' }));
      return;
    }
    if (url === '/v1/compress' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
          messages: Array<{ role?: string; content: unknown }>;
        };
        const sent = parsed.messages;
        for (const m of sent) seenRoles.push(m.role ?? '?');
        const messages = sent.map((m, i) => ({
          role: m.role ?? 'user',
          content: `<<ccr:h${i}>> ${String(m.content).slice(0, 12)}`,
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
            transforms_applied: ['fake_kompress'],
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
    seenRoles,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** msg0: old user prose (eligible), msg1: assistant, msg2: recent user prose (protected). */
function conversation(oldProse: string, recentProse: string): Record<string, unknown> {
  return {
    model: 'claude-fable-5',
    system: 'You are helpful.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: oldProse }] },
      { role: 'assistant', content: [{ type: 'text', text: 'understood' }] },
      { role: 'user', content: [{ type: 'text', text: recentProse }] },
    ],
  };
}

describe('semantic prose region (includeUserProse)', () => {
  it('compresses non-recent user prose, protects the recent turn, and stays reversible', async () => {
    const fake = await startFakeSidecar();
    const px = createPixroom({
      optical: { enabled: false },
      semantic: {
        enabled: true,
        autoSpawn: false,
        sidecarUrl: fake.url,
        protectRecent: 2,
        minTokensToCompress: 10,
        includeUserProse: true,
        proseMinChars: 200,
      },
    });

    const oldProse = 'A'.repeat(1200);
    const recentProse = 'B'.repeat(1200);
    const routed = await px.route('anthropic', 'claude-fable-5', conversation(oldProse, recentProse));

    const semantic = routed.report.rows.find((r) => r.stage === 'semantic')!;
    expect(semantic.applied).toBe(true);
    expect(routed.report.tokensSavedTotal).toBeGreaterThan(0);

    const messages = routed.body.messages as Array<{ content: Array<{ text: string }> }>;
    // Old user prose compressed; recent user prose untouched (byte-exact).
    expect(messages[0]!.content[0]!.text).toContain('<<ccr:h0>>');
    expect(messages[2]!.content[0]!.text).toBe(recentProse);
    // The prose block was handed to headroom as a `user` message, not `tool`.
    expect(fake.seenRoles).toEqual(['user']);

    // Retrieve tool injected + original recoverable through the unified CCR store.
    const tools = routed.body.tools as Array<{ name?: string }>;
    expect(tools.some((t) => t.name === CCR_TOOL_NAME)).toBe(true);
    expect(routed.reversible.length).toBeGreaterThan(0);
    expect(await px.retrieve('h0')).toBe('FULL ORIGINAL PROSE');

    await px.shutdown();
    await fake.close();
  });

  it('leaves user prose byte-exact when includeUserProse is off (default)', async () => {
    const fake = await startFakeSidecar();
    const px = createPixroom({
      optical: { enabled: false },
      semantic: {
        enabled: true,
        autoSpawn: false,
        sidecarUrl: fake.url,
        protectRecent: 2,
        minTokensToCompress: 10,
        // includeUserProse omitted → default false
      },
    });

    const oldProse = 'A'.repeat(1200);
    const body = conversation(oldProse, 'B'.repeat(1200));
    const routed = await px.route('anthropic', 'claude-fable-5', body);

    const semantic = routed.report.rows.find((r) => r.stage === 'semantic')!;
    expect(semantic.applied).toBe(false);
    expect(semantic.reason).toBe('below_threshold');

    const messages = routed.body.messages as Array<{ content: Array<{ text: string }> }>;
    expect(messages[0]!.content[0]!.text).toBe(oldProse);
    // No prose was sent to the sidecar at all.
    expect(fake.seenRoles).toEqual([]);

    await px.shutdown();
    await fake.close();
  });

  it('compresses tool_result and user prose together in one round-trip', async () => {
    const fake = await startFakeSidecar();
    const px = createPixroom({
      optical: { enabled: false },
      semantic: {
        enabled: true,
        autoSpawn: false,
        sidecarUrl: fake.url,
        protectRecent: 0,
        minTokensToCompress: 10,
        includeUserProse: true,
        proseMinChars: 200,
      },
    });

    const body: Record<string, unknown> = {
      model: 'claude-fable-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'T'.repeat(800) },
            { type: 'text', text: 'P'.repeat(800) },
          ],
        },
      ],
    };
    const routed = await px.route('anthropic', 'claude-fable-5', body);

    const semantic = routed.report.rows.find((r) => r.stage === 'semantic')!;
    expect(semantic.applied).toBe(true);
    // tool_result rides as `tool`, prose as `user`, in that order.
    expect(fake.seenRoles).toEqual(['tool', 'user']);

    const content = (routed.body.messages as Array<{ content: Array<Record<string, string>> }>)[0]!
      .content;
    expect(content[0]!.content).toContain('<<ccr:h0>>');
    expect(content[1]!.text).toContain('<<ccr:h1>>');

    await px.shutdown();
    await fake.close();
  });
});
