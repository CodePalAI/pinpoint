/**
 * Unified reversible store (CCR bridge).
 *
 * pixroom keeps both engines reversible through one store and one retrieval tool
 * (planning/end_product.md §5.2):
 *   - pxpipe imaged blocks arrive as inline `recoverable` originals (text in hand).
 *   - headroom offloads arrive as CCR hashes whose originals live in the sidecar.
 * A single `retrieve(id)` resolves either: inline first, else fetch the hash from
 * the sidecar. One `headroom_retrieve` tool is injected so the model can pull back
 * verbatim content on demand.
 */

import type { ContentType, Provider, ReversibleHandle, Stage } from '../types.js';
import type { RetrievalRecorder } from '../policy/retrieval-recorder.js';

export const CCR_TOOL_NAME = 'headroom_retrieve';

/** Fetches originals for headroom CCR hashes from the sidecar. */
export interface CcrRetriever {
  retrieveHash(hash: string): Promise<string | null>;
}

/** Per-handle attribution metadata for cross-modal retrieval-regret. */
interface HandleMeta {
  readonly engine: Stage;
  readonly contentType: ContentType;
  readonly ratio?: number;
  readonly regionId?: string;
}

export class CcrStore {
  /** pxpipe `rec_…` id → original text (held in-process). */
  private readonly inline = new Map<string, string>();
  /** headroom CCR hashes seen this session (originals live in the sidecar). */
  private readonly hashes = new Set<string>();
  /** id → attribution metadata (engine, content type, ratio) for the recorder. */
  private readonly meta = new Map<string, HandleMeta>();

  constructor(
    private readonly retriever?: CcrRetriever,
    private readonly recorder?: RetrievalRecorder,
  ) {}

  /** Register pxpipe imaged-block originals (optical stage, inline text). */
  registerReversible(handles: readonly ReversibleHandle[]): void {
    for (const h of handles) {
      if (h.origin === 'optical' && typeof h.original === 'string') {
        this.inline.set(h.id, h.original);
      } else if (h.origin === 'semantic') {
        this.hashes.add(h.id);
      }
      this.noteOffer(h.id, {
        engine: h.origin,
        contentType: h.contentType ?? 'unknown',
        ratio: h.ratio,
        regionId: h.regionId,
      });
    }
  }

  /** Register headroom CCR hashes (semantic stage). */
  registerHashes(hashes: readonly string[]): void {
    for (const h of hashes) {
      if (!h) continue;
      this.hashes.add(h);
      this.noteOffer(h, { engine: 'semantic', contentType: 'unknown' });
    }
  }

  /** Record an offload once per id (dedup across retries) and notify the recorder. */
  private noteOffer(id: string, meta: HandleMeta): void {
    if (this.meta.has(id)) return;
    this.meta.set(id, meta);
    this.recorder?.recordOffer({
      id,
      engine: meta.engine,
      contentType: meta.contentType,
      ratio: meta.ratio,
      regionId: meta.regionId,
    });
  }

  /** Number of distinct offloaded originals tracked. */
  get size(): number {
    return this.inline.size + this.hashes.size;
  }

  has(id: string): boolean {
    return this.inline.has(id) || this.hashes.has(id);
  }

  /** True when anything has been offloaded (⇒ the retrieve tool is worth injecting). */
  hasOffloaded(): boolean {
    return this.size > 0;
  }

  /** Resolve an id to its original content. Inline (pxpipe) first, else sidecar (headroom). */
  async retrieve(id: string): Promise<string | null> {
    const local = this.inline.get(id);
    if (local != null) {
      this.noteRetrieved(id);
      return local;
    }
    // Known hash, or unknown id (a hash may have been created out of band): try the sidecar.
    const content = this.retriever ? await this.retriever.retrieveHash(id) : null;
    if (content != null) this.noteRetrieved(id);
    return content;
  }

  /**
   * Record that the model retrieved an offloaded original, WITHOUT fetching it.
   * The proxy response observer uses this (it only needs the regret signal, not the
   * bytes); `retrieve()` also calls it on a successful resolve. Safe to call for
   * unknown ids (no-op).
   */
  noteRetrieved(id: string): void {
    const meta = this.meta.get(id);
    if (!meta || !this.recorder) return;
    this.recorder.recordRetrieval({
      id,
      engine: meta.engine,
      contentType: meta.contentType,
      ratio: meta.ratio,
      regionId: meta.regionId,
    });
  }

  /**
   * Tool definition for the model to retrieve offloaded originals, shaped per provider.
   * Anthropic: top-level tool with `input_schema`; OpenAI: `{type:'function', function}`.
   */
  toolSchema(provider: Provider): Record<string, unknown> {
    const description =
      'Retrieve the full, original content that was compressed or imaged out of this ' +
      'context. Call with the reference id shown in a <<ccr:…>> sentinel (or a rec_ id) ' +
      'to get the verbatim bytes back.';
    if (provider === 'openai') {
      return {
        type: 'function',
        function: {
          name: CCR_TOOL_NAME,
          description,
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The CCR hash or rec_ id to retrieve.' },
            },
            required: ['id'],
          },
        },
      };
    }
    return {
      name: CCR_TOOL_NAME,
      description,
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The CCR hash or rec_ id to retrieve.' },
        },
        required: ['id'],
      },
    };
  }
}
