/**
 * Optical compressor — the pxpipe stage (planning/pxpipe_integration.md §10.5).
 *
 * Wraps pxpipe's stable `transformAnthropicMessages` with the slab-only partition
 * lever `keepSharp: () => true`: pxpipe images the static system+tools slab (its
 * strongest, safest win — precisely the region headroom's I2 forbids mutating) while
 * keeping `reminder`/`tool_result` blocks as text for the semantic stage. pxpipe pins
 * the single Anthropic `ttl:'1h'` `cache_control` breakpoint; pinpoint records that it
 * owns it so nothing stacks a second injector (planning/end_product.md §4.4).
 *
 * OpenAI Chat Completions and Responses use pxpipe's public GPT transformer. They
 * carry no Anthropic cache-control marker; model scope and stealth gates still apply.
 */

import {
  countCacheControlMarkers,
  transformOpenAIChatCompletions,
  transformOpenAIResponses,
  transformRequest,
} from 'pxpipe-proxy';

import type { OpticalConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { parseBody, serializeBody } from '../anthropic.js';
import { classifyContent } from '../policy/content-type.js';
import { counterfactual, tokensFromChars } from '../measurement/savings.js';
import {
  passthroughResult,
  type CompressionReason,
  type Compressor,
  type ReversibleHandle,
  type RequestContext,
  type StageOutcome,
  type StageResult,
} from '../types.js';

/** Dense static-slab text basis (~2 chars/token), matching pxpipe's SLAB_CHARS_PER_TOKEN. */
const SLAB_CHARS_PER_TOKEN = 2;
/** Anthropic bills ≈ ceil(W*H/750) tokens per image. */
const PX_PER_TOKEN = 750;
/** Max page geometry pxpipe clamps to (1568×728) — conservative fallback per page. */
const MAX_PAGE_PIXELS = 1568 * 728;
const DEFAULT_ALLOWED_MODEL_BASES = ['claude-fable-5'] as const;

function mapTransformReason(reason: string | undefined): CompressionReason {
  if (reason == null) return 'passthrough';
  if (reason.startsWith('below_min_')) return 'below_threshold';
  if (reason.startsWith('not_profitable')) return 'not_profitable';
  if (reason.startsWith('compress=false')) return 'disabled';
  if (reason.startsWith('parse_error')) return 'error';
  return 'passthrough';
}

function mapOpenAIReason(reason: string | undefined): CompressionReason {
  if (reason == null) return 'passthrough';
  if (reason.startsWith('below_min_')) return 'below_threshold';
  if (reason.startsWith('not_profitable')) return 'not_profitable';
  if (reason.startsWith('parse_error')) return 'error';
  if (reason === 'compress=false') return 'disabled';
  return 'passthrough';
}

function baseModelId(model: string): string {
  return model.replace(/\[[^\]]*\]/g, '');
}

function supportsModel(model: string | null, allowedModelBases: readonly string[]): boolean {
  if (model == null) return false;
  const base = baseModelId(model);
  return allowedModelBases.some((allowed) => base === allowed || base.startsWith(`${allowed}-`));
}

export class OpticalCompressor implements Compressor {
  readonly stage = 'optical' as const;
  private readonly allowedModelBases: readonly string[];

  constructor(
    private readonly cfg: OpticalConfig,
    private readonly log: Logger,
  ) {
    this.allowedModelBases = cfg.allowedModelBases ?? DEFAULT_ALLOWED_MODEL_BASES;
  }

  preflight(ctx: Readonly<RequestContext>): StageResult | undefined {
    if (!this.cfg.enabled) return passthroughResult('optical', 'disabled');
    if (ctx.authMode !== 'payg' && !this.cfg.allowOnSubscription) {
      return passthroughResult(
        'optical',
        'stealth',
        `lossy optical disabled on ${ctx.authMode} auth (set PINPOINT_OPTICAL_ON_SUBSCRIPTION=1 to override)`,
      );
    }
    return supportsModel(ctx.model, this.allowedModelBases)
      ? undefined
      : passthroughResult('optical', 'unsupported_model', ctx.model ?? undefined);
  }

  applicable(ctx: RequestContext): boolean {
    if (!this.cfg.enabled) return false;
    return supportsModel(ctx.model, this.allowedModelBases);
  }

  async run(ctx: RequestContext): Promise<StageOutcome> {
    const preflight = this.preflight(ctx);
    if (preflight) {
      const result = preflight;
      ctx.stages.push(result);
      return { context: ctx, result };
    }

    try {
      if (ctx.provider === 'openai') return this.runOpenAI(ctx);

      const inputBody = serializeBody(ctx.body);
      const out = await transformRequest(inputBody, {
        compress: true,
        // Slab-only: keep reminders/tool_results as text (semantic stage owns them).
        keepSharp: () => true,
        emitRecoverable: this.cfg.emitRecoverable,
      });

      if (!out.info.compressed) {
        const result = passthroughResult(
          'optical',
          mapTransformReason(out.info.reason),
          out.info.reason,
        );
        ctx.stages.push(result);
        return { context: ctx, result };
      }

      // Adopt pxpipe's transformed body as the new working body.
      ctx.body = parseBody(out.body);
      ctx.opticalOwnsCacheControl = countCacheControlMarkers(out.body) > 0;

      const staticChars = out.info.staticChars || out.info.origChars;
      const pixels = out.info.imagePixels ?? out.info.imageCount * MAX_PAGE_PIXELS;
      const tokensText = tokensFromChars(staticChars, SLAB_CHARS_PER_TOKEN);
      const tokensImage = Math.ceil(pixels / PX_PER_TOKEN);
      const ratio = tokensText > 0 ? tokensImage / tokensText : undefined;

      const reversible = this.collectRecoverable(out.info.recoverable, ratio);
      for (const h of reversible) ctx.reversible.push(h);

      const result: StageResult = {
        stage: 'optical',
        applied: true,
        reason: 'applied',
        detail: `images=${out.info.imageCount} staticChars=${staticChars} ownsCacheControl=${ctx.opticalOwnsCacheControl}`,
        counterfactual: counterfactual(tokensText, tokensImage, 'estimate'),
        reversible,
      };
      ctx.stages.push(result);
      return { context: ctx, result };
    } catch (err) {
      const result = passthroughResult(
        'optical',
        'error',
        err instanceof Error ? err.message : String(err),
      );
      ctx.stages.push(result);
      this.log.warn(`optical stage error (degrading): ${result.detail}`);
      return { context: ctx, result };
    }
  }

  private async runOpenAI(ctx: RequestContext): Promise<StageOutcome> {
    const inputBody = serializeBody(ctx.body);
    const out = Object.hasOwn(ctx.body, 'input')
      ? await transformOpenAIResponses(inputBody, { compress: true })
      : await transformOpenAIChatCompletions(inputBody, { compress: true });

    if (!out.info.compressed) {
      const result = passthroughResult(
        'optical',
        mapOpenAIReason(out.info.reason),
        out.info.reason,
      );
      ctx.stages.push(result);
      return { context: ctx, result };
    }

    ctx.body = parseBody(out.body);
    const tokensText =
      out.info.baselineImagedTokens ??
      tokensFromChars(out.info.staticChars || out.info.origChars, SLAB_CHARS_PER_TOKEN);
    const pixels = out.info.imagePixels ?? out.info.imageCount * MAX_PAGE_PIXELS;
    const tokensImage = out.info.imageTokens ?? Math.ceil(pixels / PX_PER_TOKEN);
    const result: StageResult = {
      stage: 'optical',
      applied: true,
      reason: 'applied',
      detail: `openai images=${out.info.imageCount} staticChars=${out.info.staticChars}`,
      counterfactual: counterfactual(tokensText, tokensImage, 'gpt-tokenizer'),
      reversible: [],
    };
    ctx.stages.push(result);
    return { context: ctx, result };
  }

  private collectRecoverable(
    recoverable: ReadonlyArray<{ id: string; text: string }> | undefined,
    ratio?: number,
  ): ReversibleHandle[] {
    if (!recoverable) return [];
    return recoverable.map((r) => ({
      id: r.id,
      origin: 'optical' as const,
      original: r.text,
      contentType: classifyContent(r.text),
      ratio,
      regionId: 'slab',
    }));
  }
}
