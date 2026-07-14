import type { RequestContext } from '../types.js';
import type {
  ContextPatch,
  ProposalCommit,
  ProposalValidation,
  TransactionResult,
  TransformProposal,
} from './types.js';

/** Clone the mutable request state while preserving immutable request metadata. */
export function cloneRequestContext(ctx: Readonly<RequestContext>): RequestContext {
  return {
    provider: ctx.provider,
    authMode: ctx.authMode,
    model: ctx.model,
    body: structuredClone(ctx.body),
    reversible: structuredClone(ctx.reversible),
    stages: structuredClone(ctx.stages),
    opticalOwnsCacheControl: ctx.opticalOwnsCacheControl,
    virtualQueryToolNeeded: ctx.virtualQueryToolNeeded,
    virtualContextIds: structuredClone(ctx.virtualContextIds),
  };
}

function applyPatch(candidate: RequestContext, patch: Readonly<ContextPatch>): void {
  if (patch.replaceBody !== undefined) {
    candidate.body = structuredClone(patch.replaceBody);
  }
  if (patch.appendReversible !== undefined) {
    candidate.reversible.push(...structuredClone(patch.appendReversible));
  }
  if (patch.appendStages !== undefined) {
    candidate.stages.push(...structuredClone(patch.appendStages));
  }
  if (patch.opticalOwnsCacheControl !== undefined) {
    candidate.opticalOwnsCacheControl = patch.opticalOwnsCacheControl;
  }
  if (patch.virtualQueryToolNeeded !== undefined) {
    candidate.virtualQueryToolNeeded = patch.virtualQueryToolNeeded;
  }
  if (patch.virtualContextIds !== undefined) {
    candidate.virtualContextIds = [...new Set([...candidate.virtualContextIds, ...patch.virtualContextIds])];
  }
}

/**
 * Apply and validate a proposal on an isolated candidate, then commit all mutable
 * fields together. The original context is untouched when patching or validation
 * fails.
 */
export async function transactProposal(
  ctx: RequestContext,
  proposal: TransformProposal,
  validate?: ProposalValidation,
  commit?: ProposalCommit,
): Promise<TransactionResult> {
  try {
    const candidate = cloneRequestContext(ctx);
    applyPatch(candidate, proposal.patch);
    await validate?.(candidate, proposal);
    await commit?.(candidate, proposal, ctx);

    ctx.body = candidate.body;
    ctx.reversible = candidate.reversible;
    ctx.stages = candidate.stages;
    ctx.opticalOwnsCacheControl = candidate.opticalOwnsCacheControl;
    ctx.virtualQueryToolNeeded = candidate.virtualQueryToolNeeded;
    ctx.virtualContextIds = candidate.virtualContextIds;
    return { status: 'committed', proposal };
  } catch (error) {
    return {
      status: 'rolled-back',
      proposal,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}