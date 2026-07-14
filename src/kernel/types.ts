import type {
  RequestContext,
  ReversibleHandle,
  StageResult,
  TokenBasis,
} from '../types.js';

/** Stable identifier owned by an integration package, not the runtime core. */
export type IntegrationId = string;
export type RuntimeMode = 'audit' | 'shadow' | 'optimize' | 'enforce';

/** Coarse regions an integration may inspect or propose changing. */
export type RegionKind =
  | 'virtual-context'
  | 'system'
  | 'tools'
  | 'history'
  | 'current-turn'
  | 'tool-result'
  | 'attachment'
  | 'response';

export type FidelityClass = 'lossless' | 'reversible' | 'lossy';
export type CacheImpact = 'preserve' | 'move-breakpoint' | 'invalidate' | 'unknown';

/** Machine-readable estimate used by planners and shadow-mode reports. */
export interface ProposalEstimate {
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly basis?: TokenBasis;
  readonly overheadMs?: number;
}

/**
 * A typed mutation description. Integrations return patches; only the host applies
 * them, so validation and rollback remain integration-independent.
 */
export interface ContextPatch {
  readonly replaceBody?: Record<string, unknown>;
  readonly appendReversible?: readonly ReversibleHandle[];
  readonly appendStages?: readonly StageResult[];
  readonly opticalOwnsCacheControl?: boolean;
  readonly virtualQueryToolNeeded?: boolean;
  readonly virtualContextIds?: readonly string[];
}

export interface TransformProposal {
  readonly id: string;
  readonly integrationId: IntegrationId;
  readonly regions: readonly RegionKind[];
  readonly fidelity: FidelityClass;
  readonly cacheImpact: CacheImpact;
  readonly estimate?: ProposalEstimate;
  readonly conflictsWith?: readonly IntegrationId[];
  readonly dependsOn?: readonly IntegrationId[];
  readonly patch: ContextPatch;
}

export interface IntegrationCapabilities {
  readonly regions: readonly RegionKind[];
  readonly fidelity: FidelityClass;
  readonly cacheImpact: CacheImpact;
}

/** Request-side optimizer contract. Implementations propose; the host mutates. */
export interface ProcessorIntegration {
  readonly id: IntegrationId;
  readonly version: string;
  readonly order: number;
  readonly capabilities: IntegrationCapabilities;
  propose(ctx: Readonly<RequestContext>): Promise<TransformProposal>;
  commit?(
    candidate: Readonly<RequestContext>,
    proposal: Readonly<TransformProposal>,
    original: Readonly<RequestContext>,
  ): void | Promise<void>;
}

export interface PlanDecision {
  readonly status: 'selected' | 'rejected';
  readonly proposal: TransformProposal;
  readonly reason?: 'conflict' | 'missing_dependency' | 'region_owned';
}

export type ProposalValidation = (
  candidate: Readonly<RequestContext>,
  proposal: Readonly<TransformProposal>,
) => void | Promise<void>;

export type ProposalCommit = (
  candidate: Readonly<RequestContext>,
  proposal: Readonly<TransformProposal>,
  original: Readonly<RequestContext>,
) => void | Promise<void>;

export interface TransactionResult {
  readonly status: 'committed' | 'rolled-back';
  readonly proposal: TransformProposal;
  readonly error?: string;
}