import type { RequestContext } from '../types.js';
import { DeterministicPlanner } from './planner.js';
import type { IntegrationRegistry } from './registry.js';
import { transactProposal } from './transaction.js';
import type {
  PlanDecision,
  ProcessorIntegration,
  ProposalValidation,
  RuntimeMode,
  TransactionResult,
} from './types.js';

export interface PipelineHooks {
  readonly mode?: RuntimeMode;
  readonly validate?: ProposalValidation;
  readonly beforeIntegration?: (
    integration: ProcessorIntegration,
    ctx: Readonly<RequestContext>,
  ) => boolean | Promise<boolean>;
}

export interface PipelineResult {
  readonly mode: RuntimeMode;
  readonly decisions: readonly PlanDecision[];
  readonly transactions: readonly TransactionResult[];
  readonly errors: readonly { integrationId: string; error: string }[];
}

/** Ordered analyze → plan → transactional-commit pipeline. */
export class IntegrationPipeline {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly validate?: ProposalValidation,
  ) {}

  async run(ctx: RequestContext, hooks: PipelineHooks = {}): Promise<PipelineResult> {
    const mode = hooks.mode ?? 'optimize';
    const planner = new DeterministicPlanner();
    const decisions: PlanDecision[] = [];
    const transactions: TransactionResult[] = [];
    const errors: Array<{ integrationId: string; error: string }> = [];

    for (const integration of this.registry.ordered()) {
      if ((await hooks.beforeIntegration?.(integration, ctx)) === false) continue;
      if (mode === 'audit') continue;

      try {
        const proposal = await integration.propose(ctx);
        const decision = planner.consider(proposal);
        decisions.push(decision);
        if (decision.status === 'rejected') continue;
        if (mode === 'shadow') {
          planner.commit(proposal);
          continue;
        }

        const transaction = await transactProposal(
          ctx,
          proposal,
          hooks.validate ?? this.validate,
          integration.commit
            ? (candidate, committedProposal, original) =>
                integration.commit!(candidate, committedProposal, original)
            : undefined,
        );
        transactions.push(transaction);
        if (transaction.status === 'committed') {
          planner.commit(proposal);
        } else {
          errors.push({ integrationId: integration.id, error: transaction.error ?? 'rollback' });
        }
      } catch (error) {
        errors.push({
          integrationId: integration.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { mode, decisions, transactions, errors };
  }
}