import { describe, it, expect } from 'vitest';
import { CcrStore, CCR_TOOL_NAME } from '../src/ccr/store.js';
import type { ReversibleHandle } from '../src/types.js';
import { continueInternalAnthropicTurn } from '../src/continuation/anthropic.js';
import { VirtualContextStore } from '../src/virtual-context/store.js';
import type { ProcessorIntegration } from '../src/kernel/types.js';
import { createRuntime } from '../src/pinpoint.js';

describe('CcrStore', () => {
  it('registers inline pxpipe originals and retrieves them locally', async () => {
    const store = new CcrStore();
    const handles: ReversibleHandle[] = [
      { id: 'rec_abc', origin: 'optical', original: 'ORIGINAL SLAB TEXT' },
    ];
    store.registerReversible(handles);
    expect(store.size).toBe(1);
    expect(store.hasOffloaded()).toBe(true);
    expect(await store.retrieve('rec_abc')).toBe('ORIGINAL SLAB TEXT');
  });

  it('delegates unknown/headroom hashes to the sidecar retriever', async () => {
    const store = new CcrStore({
      retrieveHash: async (h) => (h === 'h1' ? 'FETCHED FROM SIDECAR' : null),
    });
    store.registerHashes(['h1']);
    expect(store.size).toBe(1);
    expect(await store.retrieve('h1')).toBe('FETCHED FROM SIDECAR');
    expect(await store.retrieve('missing')).toBeNull();
  });

  it('evicts least-recently-used handles and expires retained originals', async () => {
    let now = 0;
    const store = new CcrStore(undefined, undefined, {
      maxEntries: 2,
      maxStoredBytes: 10,
      ttlMs: 100,
      now: () => now,
    });
    store.registerReversible([
      { id: 'a', origin: 'optical', original: 'aa' },
      { id: 'b', origin: 'optical', original: 'bb' },
    ]);
    expect(await store.retrieve('a')).toBe('aa');
    store.registerReversible([{ id: 'c', origin: 'optical', original: 'cc' }]);

    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
    expect(store.has('c')).toBe(true);
    expect(store.bytes).toBe(4);
    now = 101;
    expect(store.size).toBe(0);
    expect(store.bytes).toBe(0);
  });

  it('rejects a transformed request when its reversible batch cannot fit', async () => {
    const integration: ProcessorIntegration = {
      id: 'test.oversized-reversible',
      version: 'test',
      order: 1,
      capabilities: { regions: ['history'], fidelity: 'reversible', cacheImpact: 'preserve' },
      async propose() {
        return {
          id: 'test.oversized-reversible:1',
          integrationId: this.id,
          regions: ['history'],
          fidelity: 'reversible',
          cacheImpact: 'preserve',
          patch: {
            replaceBody: { changed: true },
            appendReversible: [{ id: 'too-large', origin: 'optical', original: '12345' }],
          },
        };
      },
    };
    const runtime = createRuntime({
      includeBuiltinIntegrations: false,
      integrations: [integration],
      config: {
        ccr: { maxStoredBytes: 4 },
        semantic: { enabled: false },
        optical: { enabled: false },
        virtualContext: { enabled: false },
        logLevel: 'silent',
      },
    });

    const original = { model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] };
    const routed = await runtime.route('openai', 'gpt-test', structuredClone(original));

    expect(routed.body).toEqual(original);
    expect(routed.pipeline.errors).toContainEqual({
      integrationId: 'test.oversized-reversible',
      error: 'validation_failed',
    });
    expect(runtime.ccr.size).toBe(0);
    await runtime.shutdown();
  });

  it('shapes the retrieve tool per provider', () => {
    const store = new CcrStore();
    const anthropic = store.toolSchema('anthropic') as { name: string; input_schema: unknown };
    expect(anthropic.name).toBe(CCR_TOOL_NAME);
    expect(anthropic.input_schema).toBeDefined();

    const openai = store.toolSchema('openai') as {
      type: string;
      function: { name: string; parameters: unknown };
    };
    expect(openai.type).toBe('function');
    expect(openai.function.name).toBe(CCR_TOOL_NAME);
    expect(openai.function.parameters).toBeDefined();
  });

  it('rejects a CCR handle that is not scoped to the current request', async () => {
    const store = new CcrStore();
    store.registerReversible([
      { id: 'rec_foreign', origin: 'optical', original: 'FOREIGN SECRET' },
    ]);
    const continuation = await continueInternalAnthropicTurn(
      { messages: [{ role: 'user', content: 'hello' }] },
      {
        content: [{
          type: 'tool_use',
          id: 'toolu_retrieve',
          name: 'headroom_retrieve',
          input: { id: 'rec_foreign' },
        }],
      },
      {
        ccr: store,
        virtualContext: new VirtualContextStore(),
        allowedVirtualIds: new Set(),
        allowedCcrIds: new Set(),
      },
    );

    expect(JSON.stringify(continuation)).toContain('invalid or unavailable');
    expect(JSON.stringify(continuation)).not.toContain('FOREIGN SECRET');
  });
});
