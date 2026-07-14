import { describe, expect, it } from 'vitest';

import { createRuntime } from '../src/pixroom.js';
import type { ProcessorIntegration } from '../src/kernel/types.js';

describe('createRuntime', () => {
  it('limits QCV-only request inspection to Anthropic tool results', async () => {
    const runtime = createRuntime({
      config: {
        virtualContext: { enabled: true },
        semantic: { enabled: false },
        optical: { enabled: false },
        logLevel: 'silent',
      },
    });

    expect(runtime.requestInspection('openai')).toBe('none');
    expect(runtime.requestInspection('anthropic')).toBe('tool-results');
    await runtime.shutdown();
  });

  it('runs a third-party integration without built-in compressors or router edits', async () => {
    const integration: ProcessorIntegration = {
      id: 'example.lossless-prefix',
      version: '1.0.0',
      order: 10,
      capabilities: {
        regions: ['current-turn'],
        fidelity: 'lossless',
        cacheImpact: 'preserve',
      },
      async propose(ctx) {
        return {
          id: 'example.lossless-prefix:1',
          integrationId: this.id,
          regions: ['current-turn'],
          fidelity: 'lossless',
          cacheImpact: 'preserve',
          patch: {
            replaceBody: { ...ctx.body, marker: 'third-party-integration-ran' },
          },
        };
      },
    };
    const runtime = createRuntime({
      includeBuiltinIntegrations: false,
      integrations: [integration],
      config: { semantic: { enabled: false }, optical: { enabled: false }, logLevel: 'silent' },
    });

    const routed = await runtime.route(
      'openai',
      'gpt-test',
      { model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] },
      'payg',
    );

    expect(routed.body.marker).toBe('third-party-integration-ran');
    expect(runtime.integrations.list().map((item) => item.id)).toEqual([
      'example.lossless-prefix',
    ]);
    await runtime.shutdown();
  });

  it('rejects an external integration that shadows a built-in id', () => {
    const duplicate: ProcessorIntegration = {
      id: 'headroom-semantic',
      version: 'fake',
      order: 1,
      capabilities: { regions: [], fidelity: 'lossless', cacheImpact: 'preserve' },
      async propose() {
        throw new Error('not reached');
      },
    };

    expect(() =>
      createRuntime({
        integrations: [duplicate],
        config: { semantic: { enabled: false }, optical: { enabled: false } },
      }),
    ).toThrow('duplicate integration id: headroom-semantic');
  });

  it('exposes shadow proposals while forwarding the original body', async () => {
    const integration: ProcessorIntegration = {
      id: 'example.shadow',
      version: '1',
      order: 1,
      capabilities: { regions: ['current-turn'], fidelity: 'lossless', cacheImpact: 'preserve' },
      async propose() {
        return {
          id: 'example.shadow:1',
          integrationId: this.id,
          regions: ['current-turn'],
          fidelity: 'lossless',
          cacheImpact: 'preserve',
          patch: { replaceBody: { changed: true } },
        };
      },
    };
    const runtime = createRuntime({
      includeBuiltinIntegrations: false,
      integrations: [integration],
      config: {
        mode: 'shadow',
        semantic: { enabled: false },
        optical: { enabled: false },
        logLevel: 'silent',
      },
    });
    const original = { model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] };
    const routed = await runtime.route('openai', 'gpt-test', structuredClone(original));

    expect(routed.body).toEqual(original);
    expect(routed.pipeline.mode).toBe('shadow');
    expect(routed.pipeline.decisions[0]).toMatchObject({ status: 'selected' });
    await runtime.shutdown();
  });
});