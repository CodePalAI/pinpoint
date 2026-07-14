/**
 * pixroom core types — the locked uniform compressor interface.
 *
 * Every compression stage (optical = pxpipe, semantic = headroom) implements the
 * same contract: it runs over a {@link RequestContext}, is a safe no-op rather than
 * a throw when it cannot help, and always reports an honest {@link Counterfactual}
 * plus any {@link ReversibleHandle}s it produced. This is what lets pixroom prove
 * end-to-end savings in one shape and keep offloaded regions reversible
 * through one store.
 *
 * See planning/end_product.md §3 (partition), §5 (subsystems), and
 * planning/pxpipe_integration.md §10.5 / planning/headroom_integration.md §10.4.
 */

/** Upstream providers pixroom can front. */
export type Provider = 'anthropic' | 'openai';

/** Which engine owns a region / produced a result. */
export type Stage = 'optical' | 'semantic' | 'virtual';

/**
 * Coarse content class of a compressed region, used for cross-modal
 * rate–distortion attribution: it lets the store answer "which engine distorts
 * which kind of content?" when the model retrieves an offloaded original. This is
 * a best-effort label (see src/policy/content-type.ts), never a correctness lever.
 */
export type ContentType = 'json' | 'code' | 'log' | 'prose' | 'mixed' | 'unknown';

/**
 * Client auth posture, classified from request headers (mirrors headroom's
 * auth_mode). PAYG (API key) allows aggressive/lossy transforms; OAuth and
 * Subscription are "stealth" — the request must stay native-looking, so the
 * lossy optical stage is off by default (planning: end_product §4.4 / headroom
 * proxy/auth_mode.py + transforms/compression_policy.py).
 */
export type AuthMode = 'payg' | 'oauth' | 'subscription';

/** How token counts in a {@link Counterfactual} were derived. */
export type TokenBasis =
  | 'anthropic-count_tokens'
  | 'gpt-tokenizer'
  | 'tiktoken'
  | 'estimate';

/**
 * Machine-readable outcome of a compression stage. `applied` maps to a real
 * transform; every other value is a safe pass-through with a documented reason.
 */
export type CompressionReason =
  | 'applied'
  | 'not_profitable'
  | 'unsupported_model'
  | 'below_threshold'
  | 'disabled'
  | 'degraded'
  | 'stealth'
  | 'error'
  | 'passthrough';

/**
 * A reversible handle to original content offloaded during compression. Both
 * engines' handles are registered into the single CCR store so `headroom_retrieve`
 * (or pixroom's local bridge) can return either engine's originals verbatim.
 */
export interface ReversibleHandle {
  /** CCR hash (headroom) or `rec_…` id (pxpipe emitRecoverable). */
  readonly id: string;
  /** Engine that produced the handle. */
  readonly origin: Stage;
  /** Original text, when the engine returns it inline (pxpipe). Absent for headroom
   *  CCR hashes, whose originals live in the sidecar store and are fetched on demand. */
  readonly original?: string;
  /** Best-effort content class of the region this handle came from (RD attribution). */
  readonly contentType?: ContentType;
  /** Compression ratio for the region (tokensCompressed / tokensText), when known. */
  readonly ratio?: number;
  /** Stable id for the region this handle came from (groups handles of one region). */
  readonly regionId?: string;
}

/**
 * One honest, cache-aware counterfactual for a stage: what the region would have
 * cost as text vs. what it costs after this stage. `tokensSaved` MAY be negative and
 * is reported as-is, never floored (planning/pxpipe_integration.md §7).
 */
export interface Counterfactual {
  /** Tokens the region would cost if sent as text (the "didn't compress" path). */
  readonly tokensText: number;
  /** Tokens the region costs after this stage. */
  readonly tokensCompressed: number;
  /** `tokensText - tokensCompressed`. May be negative. */
  readonly tokensSaved: number;
  /** How the counts were derived (labels estimates honestly). */
  readonly basis: TokenBasis;
}

/** Result of running one compressor stage over its region. */
export interface StageResult {
  readonly stage: Stage;
  readonly applied: boolean;
  readonly reason: CompressionReason;
  readonly detail?: string;
  readonly counterfactual: Counterfactual;
  readonly reversible: readonly ReversibleHandle[];
}

/**
 * The evolving request as it passes through the pipeline. Stages read and mutate
 * `body` (the parsed provider request), append `reversible` handles, and push a
 * `StageResult`. `body` is the parsed JSON of the provider request (Anthropic
 * Messages or OpenAI Chat Completions).
 */
export interface RequestContext {
  readonly provider: Provider;
  /** Client auth posture; PAYG allows lossy optical, OAuth/Subscription are stealth. */
  readonly authMode: AuthMode;
  /** Top-level request model, when present. Drives model-aware routing. */
  readonly model: string | null;
  /** Parsed provider request body — mutated in place across stages. */
  body: Record<string, unknown>;
  /** Reversible handles accumulated across all stages this request. */
  reversible: ReversibleHandle[];
  /** Per-stage results, in execution order, for the unified savings report. */
  stages: StageResult[];
  /** Whether pxpipe has claimed the single Anthropic `cache_control` breakpoint. */
  opticalOwnsCacheControl: boolean;
  /** Whether QCV needs its post-optical query tool for this request. */
  virtualQueryToolNeeded: boolean;
  /** Exact dataset capabilities exposed to QCV for this request only. */
  virtualContextIds: string[];
}

/** Outcome of a stage: the (possibly mutated) context + this stage's result. */
export interface StageOutcome {
  readonly context: RequestContext;
  readonly result: StageResult;
}

/**
 * The uniform compressor contract. Implementations MUST NOT throw for expected
 * conditions (unsupported model, sidecar down, unprofitable) — they return a
 * pass-through {@link StageResult} with the appropriate {@link CompressionReason}
 * so the pipeline never fails closed (planning/end_product.md §4.3).
 */
export interface Compressor {
  readonly stage: Stage;
  /** Return a definitive no-op before request cloning, or undefined to run normally. */
  preflight?(ctx: Readonly<RequestContext>): StageResult | Promise<StageResult | undefined> | undefined;
  /** Cheap gate: can this stage even run for this request (model scope, availability)? */
  applicable(ctx: RequestContext): boolean | Promise<boolean>;
  /** Run the stage. Always resolves; degrades to a documented no-op on any failure. */
  run(ctx: RequestContext): Promise<StageOutcome>;
}

/** A single line in the unified savings report — one per stage per request. */
export interface SavingsRow {
  readonly stage: Stage;
  readonly applied: boolean;
  readonly reason: CompressionReason;
  readonly tokensText: number;
  readonly tokensCompressed: number;
  readonly tokensSaved: number;
  readonly basis: TokenBasis;
}

/** The honest, combined savings view across all stages of one request. */
export interface SavingsReport {
  readonly provider: Provider;
  readonly model: string | null;
  readonly rows: readonly SavingsRow[];
  /** Σ tokensText across stages (the "all-text" baseline). */
  readonly tokensTextTotal: number;
  /** Σ tokensCompressed across stages (what pixroom actually sends). */
  readonly tokensCompressedTotal: number;
  /** tokensTextTotal - tokensCompressedTotal. May be negative — reported as-is. */
  readonly tokensSavedTotal: number;
  /** tokensSavedTotal / tokensTextTotal in [−∞, 1]; 0 when baseline is 0. */
  readonly savedFraction: number;
  /** Number of reversible handles registered (CCR + recoverable). */
  readonly reversibleCount: number;
}

/** Empty/neutral counterfactual (zero region, nothing to save). */
export function zeroCounterfactual(basis: TokenBasis = 'estimate'): Counterfactual {
  return { tokensText: 0, tokensCompressed: 0, tokensSaved: 0, basis };
}

/** Build a {@link StageResult} for a pass-through (no-op) stage. */
export function passthroughResult(
  stage: Stage,
  reason: CompressionReason,
  detail?: string,
): StageResult {
  return {
    stage,
    applied: false,
    reason,
    detail,
    counterfactual: zeroCounterfactual(),
    reversible: [],
  };
}
