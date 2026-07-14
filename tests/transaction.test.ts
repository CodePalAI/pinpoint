import { describe, expect, it } from 'vitest';

import { transactProposal } from '../src/kernel/transaction.js';
import type { TransformProposal } from '../src/kernel/types.js';
import type { RequestContext } from '../src/types.js';

function context(): RequestContext {
  return {
    provider: 'anthropic',
    authMode: 'payg',
    model: 'claude-test',
    body: { messages: [{ role: 'user', content: 'original' }] },
    reversible: [],
    stages: [],
    opticalOwnsCacheControl: false,
    virtualQueryToolNeeded: false,
    virtualContextIds: [],
  };
}

function proposal(): TransformProposal {
  return {
    id: 'test:replace',
    integrationId: 'test.integration',
    regions: ['current-turn'],
    fidelity: 'lossless',
    cacheImpact: 'preserve',
    patch: {
      replaceBody: { messages: [{ role: 'user', content: 'changed' }] },
      appendReversible: [{ id: 'r1', origin: 'semantic', original: 'original' }],
      appendStages: [
        {
          stage: 'semantic',
          applied: true,
          reason: 'applied',
          counterfactual: {
            tokensText: 10,
            tokensCompressed: 4,
            tokensSaved: 6,
            basis: 'estimate',
          },
          reversible: [],
        },
      ],
    },
  };
}

describe('transactProposal', () => {
  it('commits a validated patch atomically', async () => {
    const ctx = context();
    const result = await transactProposal(ctx, proposal(), (candidate) => {
      expect(candidate.body).toEqual({ messages: [{ role: 'user', content: 'changed' }] });
    });

    expect(result.status).toBe('committed');
    expect(ctx.body).toEqual({ messages: [{ role: 'user', content: 'changed' }] });
    expect(ctx.reversible.map((handle) => handle.id)).toEqual(['r1']);
    expect(ctx.stages).toHaveLength(1);
  });

  it('leaves the original context untouched when validation fails', async () => {
    const ctx = context();
    const original = structuredClone(ctx);
    const result = await transactProposal(ctx, proposal(), () => {
      throw new Error('invalid provider shape');
    });

    expect(result).toMatchObject({ status: 'rolled-back', error: 'invalid provider shape' });
    expect(ctx).toEqual(original);
  });

  it('does not share nested body references with the proposal', async () => {
    const ctx = context();
    const proposed = proposal();
    await transactProposal(ctx, proposed);

    const replacement = proposed.patch.replaceBody as {
      messages: Array<{ content: string }>;
    };
    replacement.messages[0]!.content = 'mutated later';
    expect(ctx.body).toEqual({ messages: [{ role: 'user', content: 'changed' }] });
  });

  it('rolls back the candidate when an integration commit hook fails', async () => {
    const ctx = context();
    const original = structuredClone(ctx);
    const result = await transactProposal(ctx, proposal(), undefined, () => {
      throw new Error('external commit failed');
    });

    expect(result).toMatchObject({ status: 'rolled-back', error: 'external commit failed' });
    expect(ctx).toEqual(original);
  });
});