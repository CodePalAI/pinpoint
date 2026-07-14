import { describe, expect, it } from 'vitest';

import { LegacyCompressorIntegration } from '../src/integrations/legacy-compressor.js';
import { IntegrationPipeline } from '../src/kernel/pipeline.js';
import { IntegrationRegistry } from '../src/kernel/registry.js';
import type { ProcessorIntegration, TransformProposal } from '../src/kernel/types.js';
import {
  passthroughResult,
  type Compressor,
  type RequestContext,
  type StageOutcome,
} from '../src/types.js';

function context(): RequestContext {
  return {
    provider: 'anthropic',
    authMode: 'payg',
    model: 'test',
    body: { value: 'original' },
    reversible: [],
    stages: [],
    opticalOwnsCacheControl: false,
    virtualQueryToolNeeded: false,
    virtualContextIds: [],
  };
}

function integration(
  id: string,
  order: number,
  region: 'system' | 'tool-result',
  value: string,
): ProcessorIntegration {
  return {
    id,
    order,
    version: 'test',
    capabilities: { regions: [region], fidelity: 'lossless', cacheImpact: 'preserve' },
    async propose(): Promise<TransformProposal> {
      return {
        id: `${id}:proposal`,
        integrationId: id,
        regions: [region],
        fidelity: 'lossless',
        cacheImpact: 'preserve',
        patch: { replaceBody: { value } },
      };
    },
  };
}

describe('IntegrationRegistry and IntegrationPipeline', () => {
  it('runs integrations in stable order', async () => {
    const registry = new IntegrationRegistry()
      .register(integration('second', 20, 'tool-result', 'second'))
      .register(integration('first', 10, 'system', 'first'));
    const ctx = context();
    const result = await new IntegrationPipeline(registry).run(ctx);

    expect(registry.ordered().map((item) => item.id)).toEqual(['first', 'second']);
    expect(result.transactions.map((item) => item.proposal.integrationId)).toEqual([
      'first',
      'second',
    ]);
    expect(ctx.body).toEqual({ value: 'second' });
  });

  it('rejects a second integration that claims an owned region', async () => {
    const registry = new IntegrationRegistry()
      .register(integration('owner', 10, 'system', 'owner'))
      .register(integration('contender', 20, 'system', 'contender'));
    const ctx = context();
    const result = await new IntegrationPipeline(registry).run(ctx);

    expect(result.decisions[1]).toMatchObject({ status: 'rejected', reason: 'region_owned' });
    expect(ctx.body).toEqual({ value: 'owner' });
  });

  it('selects proposals in shadow mode without committing mutations', async () => {
    const registry = new IntegrationRegistry().register(
      integration('shadowed', 10, 'system', 'must-not-commit'),
    );
    const ctx = context();
    const result = await new IntegrationPipeline(registry).run(ctx, { mode: 'shadow' });

    expect(result.mode).toBe('shadow');
    expect(result.decisions).toHaveLength(1);
    expect(result.transactions).toEqual([]);
    expect(ctx.body).toEqual({ value: 'original' });
  });

  it('does not execute integration analysis in audit mode', async () => {
    let proposed = false;
    const candidate = integration('audited', 10, 'system', 'nope');
    const registry = new IntegrationRegistry().register({
      ...candidate,
      async propose(ctx) {
        proposed = true;
        return candidate.propose(ctx);
      },
    });
    const ctx = context();
    const result = await new IntegrationPipeline(registry).run(ctx, { mode: 'audit' });

    expect(proposed).toBe(false);
    expect(result.decisions).toEqual([]);
    expect(ctx.body).toEqual({ value: 'original' });
  });

  it('rejects duplicate integration ids', () => {
    const registry = new IntegrationRegistry().register(integration('same', 10, 'system', 'a'));
    expect(() => registry.register(integration('same', 20, 'tool-result', 'b'))).toThrow(
      'duplicate integration id: same',
    );
  });
});

describe('LegacyCompressorIntegration isolation', () => {
  it('rolls back a legacy compressor that mutates before returning error', async () => {
    const compressor: Compressor = {
      stage: 'semantic',
      applicable: () => true,
      async run(ctx): Promise<StageOutcome> {
        ctx.body = { value: 'partial mutation' };
        ctx.reversible.push({ id: 'bad', origin: 'semantic' });
        const result = passthroughResult('semantic', 'error', 'simulated failure');
        ctx.stages.push(result);
        return { context: ctx, result };
      },
    };
    const legacy = new LegacyCompressorIntegration(compressor, {
      id: 'legacy-failure',
      version: 'test',
      order: 10,
      regions: ['tool-result'],
      fidelity: 'reversible',
      cacheImpact: 'preserve',
    });
    const ctx = context();
    await new IntegrationPipeline(new IntegrationRegistry().register(legacy)).run(ctx);

    expect(ctx.body).toEqual({ value: 'original' });
    expect(ctx.reversible).toEqual([]);
    expect(ctx.stages).toHaveLength(1);
    expect(ctx.stages[0]).toMatchObject({ applied: false, reason: 'error' });
  });
});