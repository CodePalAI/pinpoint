/**
 * Semantic compressor — the headroom stage (planning/headroom_integration.md §10.4).
 *
 * Talks to the headroom sidecar's stateless, loopback-only `/v1/compress` seam. It
 * never touches transport-level `cache_control` (pxpipe owns the breakpoint) and
 * never calls the LLM. It compresses only the semantic region:
 *   - Anthropic: the `tool_result` text blocks in non-recent turns, plus (opt-in via
 *     `includeUserProse`) large plain-text prose in non-recent user turns — both
 *     mapped 1:1 back and routed to headroom's content-aware compressors (Kompress
 *     for prose, SmartCrusher for structured data).
 *   - OpenAI: the message array wholesale.
 * headroom's CCR hashes become reversible handles; this class also serves as the
 * {@link CcrRetriever} for `GET /v1/retrieve/{hash}`.
 *
 * Any failure (sidecar down, length mismatch, bad JSON) degrades to a safe
 * pass-through — the pipeline never fails closed.
 */

import type { SemanticConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { CcrRetriever } from '../ccr/store.js';
import {
  applyCompressedProse,
  applyCompressedToolResults,
  collectProseTargets,
  collectToolResultTargets,
  totalChars,
  type ToolResultTarget,
} from '../anthropic.js';
import { counterfactual, tokensFromChars } from '../measurement/savings.js';
import type { HeadroomSidecar } from '../sidecar/headroom-sidecar.js';
import {
  passthroughResult,
  type Compressor,
  type ReversibleHandle,
  type RequestContext,
  type StageOutcome,
  type StageResult,
} from '../types.js';

/** Per-block floor (chars) below which a tool_result isn't worth a round-trip. */
const SEMANTIC_MIN_BLOCK_CHARS = 200;

interface CompressResponse {
  messages: unknown[];
  tokens_before: number;
  tokens_after: number;
  tokens_saved: number;
  compression_ratio: number;
  transforms_applied: string[];
  ccr_hashes: string[];
}

/** Flatten OpenAI-style message content to text, or `null` if not pure text. */
function flattenContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (part == null || typeof part !== 'object') return null;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type !== 'text' || typeof p.text !== 'string') return null;
    parts.push(p.text);
  }
  return parts.join('');
}

export class SemanticCompressor implements Compressor, CcrRetriever {
  readonly stage = 'semantic' as const;

  constructor(
    private readonly cfg: SemanticConfig,
    private readonly sidecar: HeadroomSidecar,
    private readonly log: Logger,
  ) {}

  async applicable(_ctx: RequestContext): Promise<boolean> {
    if (!this.cfg.enabled) return false;
    return this.sidecar.ensureHealthy();
  }

  async run(ctx: RequestContext): Promise<StageOutcome> {
    const finish = (result: StageResult): StageOutcome => {
      ctx.stages.push(result);
      return { context: ctx, result };
    };

    if (!this.cfg.enabled) {
      return finish(passthroughResult('semantic', 'disabled'));
    }
    if (!(await this.sidecar.ensureHealthy())) {
      return finish(passthroughResult('semantic', 'degraded', 'headroom sidecar unavailable'));
    }

    try {
      const result =
        ctx.provider === 'anthropic'
          ? await this.runAnthropic(ctx)
          : await this.runOpenAI(ctx);
      return finish(result);
    } catch (err) {
      this.log.warn(`semantic stage error (degrading): ${err instanceof Error ? err.message : String(err)}`);
      return finish(
        passthroughResult('semantic', 'error', err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private async runAnthropic(ctx: RequestContext): Promise<StageResult> {
    const toolTargets = collectToolResultTargets(ctx.body, {
      protectRecent: this.cfg.protectRecent,
      minChars: SEMANTIC_MIN_BLOCK_CHARS,
    });
    const proseTargets = this.cfg.includeUserProse
      ? collectProseTargets(ctx.body, {
          protectRecent: this.cfg.protectRecent,
          minChars: this.cfg.proseMinChars,
        })
      : [];

    if (toolTargets.length + proseTargets.length === 0) {
      return passthroughResult('semantic', 'below_threshold', 'no eligible content blocks');
    }
    const regionChars = totalChars(toolTargets) + totalChars(proseTargets);
    if (tokensFromChars(regionChars) < this.cfg.minTokensToCompress) {
      return passthroughResult('semantic', 'below_threshold', `region ${regionChars} chars`);
    }

    // Order is [tool_result…, prose…] so the response splits back to the right
    // reinjector. tool_results ride as `tool` messages, user prose as `user`.
    const messages = [
      ...toolTargets.map((t: ToolResultTarget, i: number) => ({
        role: 'tool',
        tool_call_id: t.toolUseId ?? `pxr_${i}`,
        content: t.text,
      })),
      ...proseTargets.map((t) => ({ role: 'user', content: t.text })),
    ];

    // headroom skips user messages by default (prefix-cache safety); opt in
    // explicitly when we send prose so the prose path works regardless of the
    // sidecar's savings profile. We pre-select non-recent turns ourselves, so
    // `protect_recent: 0` compresses exactly the blocks we chose.
    const config: Record<string, unknown> = { protect_recent: 0 };
    if (proseTargets.length > 0) config.compress_user_messages = true;

    const resp = await this.postCompress(messages, ctx.model ?? 'claude-sonnet-4-5', config);

    // 1:1 mapping is required to reinject safely; degrade on any mismatch.
    if (resp.messages.length !== messages.length) {
      return passthroughResult(
        'semantic',
        'degraded',
        `compress returned ${resp.messages.length} vs ${messages.length} sent`,
      );
    }
    const compressed: string[] = [];
    for (const m of resp.messages) {
      const text = flattenContent((m as { content?: unknown }).content);
      if (text == null) {
        return passthroughResult('semantic', 'degraded', 'non-text content in compress response');
      }
      compressed.push(text);
    }

    // Only rewrite the body when headroom actually helped; a no-op stays byte-exact.
    const applied = resp.tokens_saved > 0 || resp.ccr_hashes.length > 0;
    if (applied) {
      const nTool = toolTargets.length;
      if (nTool > 0) {
        applyCompressedToolResults(ctx.body, toolTargets, compressed.slice(0, nTool));
      }
      if (proseTargets.length > 0) {
        applyCompressedProse(ctx.body, proseTargets, compressed.slice(nTool));
      }
      this.registerHashes(ctx, resp.ccr_hashes);
    }

    return {
      stage: 'semantic',
      applied,
      reason: applied ? 'applied' : 'not_profitable',
      detail: resp.transforms_applied.join(',') || undefined,
      counterfactual: counterfactual(resp.tokens_before, resp.tokens_after, 'tiktoken'),
      reversible: applied ? this.hashHandles(resp.ccr_hashes) : [],
    };
  }

  private async runOpenAI(ctx: RequestContext): Promise<StageResult> {
    const messages = ctx.body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return passthroughResult('semantic', 'below_threshold', 'no messages');
    }

    const resp = await this.postCompress(messages, ctx.model ?? 'gpt-4o', {});
    if (!Array.isArray(resp.messages) || resp.messages.length === 0) {
      return passthroughResult('semantic', 'degraded', 'empty compress response');
    }

    const applied = resp.tokens_saved > 0 || resp.ccr_hashes.length > 0;
    if (applied) {
      ctx.body.messages = resp.messages;
      this.registerHashes(ctx, resp.ccr_hashes);
    }

    return {
      stage: 'semantic',
      applied,
      reason: applied ? 'applied' : 'not_profitable',
      detail: resp.transforms_applied.join(',') || undefined,
      counterfactual: counterfactual(resp.tokens_before, resp.tokens_after, 'tiktoken'),
      reversible: applied ? this.hashHandles(resp.ccr_hashes) : [],
    };
  }

  private hashHandles(hashes: readonly string[]): ReversibleHandle[] {
    return hashes.filter(Boolean).map((id) => ({ id, origin: 'semantic' as const }));
  }

  private registerHashes(ctx: RequestContext, hashes: readonly string[]): void {
    for (const h of this.hashHandles(hashes)) ctx.reversible.push(h);
  }

  private async postCompress(
    messages: unknown[],
    model: string,
    config: Record<string, unknown>,
  ): Promise<CompressResponse> {
    const res = await fetch(`${this.sidecar.url}/v1/compress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, model, config }),
    });
    if (!res.ok) {
      throw new Error(`/v1/compress ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as Partial<CompressResponse>;
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      tokens_before: data.tokens_before ?? 0,
      tokens_after: data.tokens_after ?? 0,
      tokens_saved: data.tokens_saved ?? 0,
      compression_ratio: data.compression_ratio ?? 1,
      transforms_applied: Array.isArray(data.transforms_applied) ? data.transforms_applied : [],
      ccr_hashes: Array.isArray(data.ccr_hashes) ? data.ccr_hashes : [],
    };
  }

  /** {@link CcrRetriever} — fetch a CCR original from the sidecar by hash. */
  async retrieveHash(hash: string): Promise<string | null> {
    if (!this.sidecar.available) return null;
    try {
      const res = await fetch(`${this.sidecar.url}/v1/retrieve/${encodeURIComponent(hash)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { original_content?: unknown };
      return typeof data.original_content === 'string' ? data.original_content : null;
    } catch {
      return null;
    }
  }
}
