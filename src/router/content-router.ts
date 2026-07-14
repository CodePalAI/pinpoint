/**
 * pixroom ContentRouter (planning/end_product.md §5.1).
 *
 * A thin orchestration layer over registered optimizers that enforces region ownership —
 * exactly one engine per region — and unifies reversibility through one CCR store:
 *
 *   1. semantic stage (headroom): compress tool_result/content regions
 *   2. optical stage (pxpipe): image the static system+tools slab; own cache_control
 *   3. register both engines' reversible handles into the single CCR store
 *   4. inject `headroom_retrieve` last (after optical) so its description stays sharp
 *
 * Ordering matches the §4.3 data flow. Every stage self-gates and degrades to a safe
 * pass-through, so `route()` never fails closed.
 */

import type { Logger } from '../logger.js';
import { CCR_TOOL_NAME, type CcrStore } from '../ccr/store.js';
import { PXPIPE_OPTICAL_INTEGRATION_ID } from '../integrations/legacy-compressor.js';
import type { IntegrationPipeline } from '../kernel/pipeline.js';
import type { PipelineResult } from '../kernel/pipeline.js';
import type { RuntimeMode } from '../kernel/types.js';
import type { ProposalValidation } from '../kernel/types.js';
import { buildReport, summarizeReport } from '../measurement/savings.js';
import { classifyContent } from '../policy/content-type.js';
import { readSystemText } from '../anthropic.js';
import type { CrossModalController, EngineDecision } from '../policy/controller.js';
import {
  VIRTUAL_QUERY_TOOL_NAME,
  virtualQueryToolSchema,
} from '../virtual-context/store.js';
import {
  passthroughResult,
  type AuthMode,
  type ContentType,
  type Provider,
  type RequestContext,
  type ReversibleHandle,
  type SavingsReport,
} from '../types.js';

export interface RouteResult {
  /** The transformed request body ready to forward upstream. */
  readonly body: Record<string, unknown>;
  readonly report: SavingsReport;
  readonly reversible: readonly ReversibleHandle[];
  /** True when pxpipe pinned the single Anthropic `cache_control` breakpoint. */
  readonly opticalOwnsCacheControl: boolean;
  /** True when QCV committed at least one exact dataset manifest. */
  readonly virtualized: boolean;
  /** True when the experimental model-driven query fallback is active. */
  readonly virtualQueryToolNeeded: boolean;
  /** Exact dataset capabilities available to this routed request. */
  readonly virtualContextIds: readonly string[];
  /** Proposal/transaction trace for audit, shadow, and explain surfaces. */
  readonly pipeline: PipelineResult;
  /** Cross-modal controller decision for the slab region, when the adaptive path is on. */
  readonly adaptive?: {
    readonly slabContentType: ContentType;
    readonly decision: EngineDecision;
  };
}

function toolName(tool: unknown): string | undefined {
  if (tool == null || typeof tool !== 'object') return undefined;
  const t = tool as { name?: unknown; function?: { name?: unknown } };
  if (typeof t.name === 'string') return t.name;
  if (t.function && typeof t.function.name === 'string') return t.function.name;
  return undefined;
}

export class ContentRouter {
  constructor(
    private readonly pipeline: IntegrationPipeline,
    private readonly ccr: CcrStore,
    private readonly log: Logger,
    private readonly mode: RuntimeMode = 'optimize',
    /** Optional adaptive controller; when present, may defer optical for a slab type. */
    private readonly controller?: CrossModalController,
  ) {}

  async route(
    provider: Provider,
    model: string | null,
    body: Record<string, unknown>,
    authMode: AuthMode = 'payg',
    validate?: ProposalValidation,
  ): Promise<RouteResult> {
    const ctx: RequestContext = {
      provider,
      authMode,
      model,
      body,
      reversible: [],
      stages: [],
      opticalOwnsCacheControl: false,
      virtualQueryToolNeeded: false,
      virtualContextIds: [],
    };

    let adaptive: RouteResult['adaptive'];
    const pipelineResult = await this.pipeline.run(ctx, {
      mode: this.mode,
      validate,
      beforeIntegration: (integration) => {
        if (integration.id !== PXPIPE_OPTICAL_INTEGRATION_ID || !this.controller) return true;

        const slabContentType = classifyContent(readSystemText(ctx.body));
        const decision = this.controller.chooseEngine({
          contentType: slabContentType,
          eligible: ['optical', 'semantic'],
          defaultEngine: 'optical',
          fallbackSaved: { optical: 0.7, semantic: 0.4 },
        });
        adaptive = { slabContentType, decision };
        if (decision.engine === 'optical') return true;

        ctx.stages.push(
          passthroughResult('optical', 'not_profitable', `adaptive: deferred slab (${slabContentType})`),
        );
        this.log.debug(`adaptive: optical deferred for slab content=${slabContentType}`);
        return false;
      },
    });
    for (const failure of pipelineResult.errors) {
      this.log.warn(`integration ${failure.integrationId} degraded: ${failure.error}`);
    }

    // Unify reversibility: both engines' handles live in one store (§5.2).
    this.ccr.registerReversible(ctx.reversible);

    // Inject the retrieve tool last so its description isn't imaged by pxpipe.
    if (this.ccr.hasOffloaded()) {
      this.injectCcrTool(ctx);
    }
    if (ctx.virtualQueryToolNeeded) {
      this.injectVirtualQueryTool(ctx);
    }

    const report = buildReport(ctx);
    this.log.info(summarizeReport(report));

    return {
      body: ctx.body,
      report,
      reversible: ctx.reversible,
      opticalOwnsCacheControl: ctx.opticalOwnsCacheControl,
      virtualized: report.rows.some((row) => row.stage === 'virtual' && row.applied),
      virtualQueryToolNeeded: ctx.virtualQueryToolNeeded,
      virtualContextIds: ctx.virtualContextIds,
      pipeline: pipelineResult,
      adaptive,
    };
  }

  private injectCcrTool(ctx: RequestContext): void {
    const existing = Array.isArray(ctx.body.tools) ? ctx.body.tools : [];
    if (existing.some((t) => toolName(t) === CCR_TOOL_NAME)) return;
    ctx.body.tools = [...existing, this.ccr.toolSchema(ctx.provider)];
    this.log.debug(`injected ${CCR_TOOL_NAME} tool (${this.ccr.size} offloaded originals)`);
  }

  private injectVirtualQueryTool(ctx: RequestContext): void {
    const existing = Array.isArray(ctx.body.tools) ? ctx.body.tools : [];
    if (existing.some((tool) => toolName(tool) === VIRTUAL_QUERY_TOOL_NAME)) return;
    ctx.body.tools = [...existing, virtualQueryToolSchema()];
    this.log.debug(`injected ${VIRTUAL_QUERY_TOOL_NAME} tool`);
  }
}
