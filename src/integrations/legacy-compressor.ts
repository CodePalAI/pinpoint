import { cloneRequestContext } from '../kernel/transaction.js';
import type {
  CacheImpact,
  FidelityClass,
  ProcessorIntegration,
  RegionKind,
  TransformProposal,
} from '../kernel/types.js';
import {
  passthroughResult,
  type Compressor,
  type RequestContext,
  type StageResult,
} from '../types.js';

export const HEADROOM_SEMANTIC_INTEGRATION_ID = 'headroom-semantic';
export const PXPIPE_OPTICAL_INTEGRATION_ID = 'pxpipe-optical';

export interface LegacyCompressorOptions {
  readonly id: string;
  readonly version: string;
  readonly order: number;
  readonly regions: readonly RegionKind[];
  readonly fidelity: FidelityClass;
  readonly cacheImpact: CacheImpact;
}

/** Isolates a mutable legacy Compressor behind the proposal-only kernel contract. */
export class LegacyCompressorIntegration implements ProcessorIntegration {
  readonly id: string;
  readonly version: string;
  readonly order: number;
  readonly capabilities: {
    readonly regions: readonly RegionKind[];
    readonly fidelity: FidelityClass;
    readonly cacheImpact: CacheImpact;
  };

  constructor(
    private readonly compressor: Compressor,
    options: LegacyCompressorOptions,
  ) {
    this.id = options.id;
    this.version = options.version;
    this.order = options.order;
    this.capabilities = {
      regions: options.regions,
      fidelity: options.fidelity,
      cacheImpact: options.cacheImpact,
    };
  }

  async propose(ctx: Readonly<RequestContext>): Promise<TransformProposal> {
    const preflight = await this.compressor.preflight?.(ctx);
    if (preflight) {
      return {
        id: `${this.id}:${ctx.stages.length}`,
        integrationId: this.id,
        regions: [],
        fidelity: this.capabilities.fidelity,
        cacheImpact: 'preserve',
        estimate: {
          tokensBefore: preflight.counterfactual.tokensText,
          tokensAfter: preflight.counterfactual.tokensCompressed,
          basis: preflight.counterfactual.basis,
        },
        patch: {
          appendStages: [preflight],
          opticalOwnsCacheControl: ctx.opticalOwnsCacheControl,
        },
      };
    }

    const candidate = cloneRequestContext(ctx);
    const reversibleStart = candidate.reversible.length;
    let result: StageResult;

    try {
      result = (await this.compressor.run(candidate)).result;
    } catch (error) {
      result = passthroughResult(
        this.compressor.stage,
        'error',
        error instanceof Error ? error.message : String(error),
      );
    }

    const applied = result.applied && result.reason !== 'error';
    const newReversible = applied ? candidate.reversible.slice(reversibleStart) : [];
    return {
      id: `${this.id}:${candidate.stages.length}`,
      integrationId: this.id,
      regions: applied ? this.capabilities.regions : [],
      fidelity: this.capabilities.fidelity,
      cacheImpact: applied ? this.capabilities.cacheImpact : 'preserve',
      estimate: {
        tokensBefore: result.counterfactual.tokensText,
        tokensAfter: result.counterfactual.tokensCompressed,
        basis: result.counterfactual.basis,
      },
      patch: {
        replaceBody: applied ? candidate.body : undefined,
        appendReversible: newReversible,
        appendStages: [result],
        opticalOwnsCacheControl: applied
          ? candidate.opticalOwnsCacheControl
          : ctx.opticalOwnsCacheControl,
      },
    };
  }
}