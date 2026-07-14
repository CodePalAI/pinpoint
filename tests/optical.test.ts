import { describe, it, expect } from 'vitest';
import { createPinpoint } from '../src/pinpoint.js';
import { serializeBody } from '../src/anthropic.js';

/** A dense, static, prose-like system slab — the kind pxpipe images. */
function bigSystemText(): string {
  return 'You are a meticulous senior engineer. Follow the project conventions exactly. '.repeat(300);
}

describe('optical stage (real pxpipe, in-process)', () => {
  it('keeps GPT 5.6 outside the reviewed default model scope', async () => {
    const runtime = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await runtime.route('openai', 'gpt-5.6', {
      model: 'gpt-5.6',
      input: 'A short request.',
    });

    expect(routed.report.rows.find((row) => row.stage === 'optical')).toMatchObject({
      applied: false,
      reason: 'unsupported_model',
    });
    await runtime.shutdown();
  });

  it('isolates optical model scopes between runtime instances', async () => {
    const optedIn = createPinpoint({
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5.6'] },
    });
    const defaults = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });

    const [custom, standard] = await Promise.all([
      optedIn.route('openai', 'gpt-5.6', { model: 'gpt-5.6', input: 'A short request.' }),
      defaults.route('openai', 'gpt-5.6', { model: 'gpt-5.6', input: 'A short request.' }),
    ]);

    expect(custom.report.rows.find((row) => row.stage === 'optical')?.reason).not.toBe(
      'unsupported_model',
    );
    expect(standard.report.rows.find((row) => row.stage === 'optical')?.reason).toBe(
      'unsupported_model',
    );
    await Promise.all([optedIn.shutdown(), defaults.shutdown()]);
  });

  it('passes through unsupported models', async () => {
    const px = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await px.route('anthropic', 'gpt-4', {
      model: 'gpt-4',
      system: bigSystemText(),
      messages: [{ role: 'user', content: 'hi' }],
    });
    const optical = routed.report.rows.find((r) => r.stage === 'optical')!;
    expect(optical.applied).toBe(false);
    expect(optical.reason).toBe('unsupported_model');
    await px.shutdown();
  });

  it('images the static slab on a supported model (system folded into an image)', async () => {
    const px = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await px.route('anthropic', 'claude-fable-5', {
      model: 'claude-fable-5',
      system: bigSystemText(),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Please help.' }] }],
    });
    const optical = routed.report.rows.find((r) => r.stage === 'optical')!;
    expect(optical.applied).toBe(true);
    expect(optical.tokensSaved).toBeGreaterThan(0);
    // Proof the slab was actually imaged: the system field is gone and an image
    // block now rides on the first user message.
    expect(routed.body.system).toBeUndefined();
    const content = (routed.body.messages as Array<{ content: Array<{ type: string }> }>)[0]!.content;
    expect(content.some((b) => b.type === 'image')).toBe(true);
    await px.shutdown();
  });

  it('pins exactly one cache_control breakpoint on a Claude-Code-shaped request (§4.4)', async () => {
    const px = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await px.route('anthropic', 'claude-fable-5', {
      model: 'claude-fable-5',
      system: [{ type: 'text', text: bigSystemText(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Please help.' }] }],
    });
    // pxpipe (via pinpoint) owns the single Anthropic breakpoint — no breakpoint war.
    expect(routed.opticalOwnsCacheControl).toBe(true);
    const serialized = new TextDecoder().decode(serializeBody(routed.body));
    expect((serialized.match(/cache_control/g) ?? []).length).toBe(1);
    await px.shutdown();
  });

  it('skips lossy optical on subscription auth (stealth)', async () => {
    const px = createPinpoint({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await px.route(
      'anthropic',
      'claude-fable-5',
      {
        model: 'claude-fable-5',
        system: bigSystemText(),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      },
      'subscription',
    );
    const optical = routed.report.rows.find((r) => r.stage === 'optical')!;
    expect(optical.applied).toBe(false);
    expect(optical.reason).toBe('stealth');
    // The system prompt is NOT imaged — the request stays native for stealth.
    expect(routed.body.system).toBeDefined();
    await px.shutdown();
  });

  it('images on subscription when explicitly opted in', async () => {
    const px = createPinpoint({
      semantic: { enabled: false },
      optical: { enabled: true, allowOnSubscription: true },
    });
    const routed = await px.route(
      'anthropic',
      'claude-fable-5',
      {
        model: 'claude-fable-5',
        system: bigSystemText(),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      },
      'subscription',
    );
    const optical = routed.report.rows.find((r) => r.stage === 'optical')!;
    expect(optical.applied).toBe(true);
    await px.shutdown();
  });
});
