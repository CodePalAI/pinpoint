/**
 * Unified reversible store (CCR bridge).
 *
 * pinpoint keeps both engines reversible through one store and one retrieval tool
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

interface StoredHandle {
  readonly original?: string;
  readonly bytes: number;
  readonly expiresAt: number;
  readonly meta: HandleMeta;
}

export interface CcrStoreOptions {
  readonly maxEntries?: number;
  readonly maxStoredBytes?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

function positiveFinite(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export class CcrStore {
  /** id → bounded original/metadata entry. Map insertion order is the LRU order. */
  private readonly entries = new Map<string, StoredHandle>();
  private readonly maxEntries: number;
  private readonly maxStoredBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private storedBytes = 0;

  constructor(
    private readonly retriever?: CcrRetriever,
    private readonly recorder?: RetrievalRecorder,
    options: CcrStoreOptions = {},
  ) {
    this.maxEntries = positiveFinite(options.maxEntries, 1000);
    this.maxStoredBytes = positiveFinite(options.maxStoredBytes, 64 * 1024 * 1024);
    this.ttlMs = positiveFinite(options.ttlMs, 30 * 60 * 1000);
    this.now = options.now ?? Date.now;
  }

  /** Reject a request before commit when its own reversible batch cannot fit. */
  validateReversible(handles: readonly ReversibleHandle[]): void {
    const batch = this.batch(handles);
    const bytes = [...batch.values()].reduce((total, entry) => total + entry.bytes, 0);
    if (batch.size > this.maxEntries) {
      throw new RangeError(`CCR batch exceeds max entries (${batch.size} > ${this.maxEntries})`);
    }
    if (bytes > this.maxStoredBytes) {
      throw new RangeError(`CCR batch exceeds max bytes (${bytes} > ${this.maxStoredBytes})`);
    }
  }

  /** Register pxpipe imaged-block originals (optical stage, inline text). */
  registerReversible(handles: readonly ReversibleHandle[]): void {
    this.validateReversible(handles);
    this.sweepExpired();
    const batch = this.batch(handles);
    const protectedIds = new Set(batch.keys());
    for (const [id, entry] of batch) {
      const previous = this.entries.get(id);
      if (previous) this.storedBytes -= previous.bytes;
      this.entries.delete(id);
      this.entries.set(id, entry);
      this.storedBytes += entry.bytes;
      if (!previous) this.noteOffer(id, entry.meta);
    }
    this.evictToLimits(protectedIds);
  }

  /** Register headroom CCR hashes (semantic stage). */
  registerHashes(hashes: readonly string[]): void {
    this.registerReversible(
      hashes.filter(Boolean).map((id) => ({ id, origin: 'semantic' as const })),
    );
  }

  /** Record an offload once per id (dedup across retries) and notify the recorder. */
  private noteOffer(id: string, meta: HandleMeta): void {
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
    this.sweepExpired();
    return this.entries.size;
  }

  /** Number of inline original bytes retained. */
  get bytes(): number {
    this.sweepExpired();
    return this.storedBytes;
  }

  has(id: string): boolean {
    return this.entry(id, true) !== undefined;
  }

  /** True when anything has been offloaded (⇒ the retrieve tool is worth injecting). */
  hasOffloaded(): boolean {
    return this.size > 0;
  }

  /** Resolve an id to its original content. Inline (pxpipe) first, else sidecar (headroom). */
  async retrieve(id: string): Promise<string | null> {
    const entry = this.entry(id, true);
    if (entry?.original != null) {
      this.noteRetrieved(id);
      return entry.original;
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
    const meta = this.entry(id, true)?.meta;
    if (!meta || !this.recorder) return;
    this.recorder.recordRetrieval({
      id,
      engine: meta.engine,
      contentType: meta.contentType,
      ratio: meta.ratio,
      regionId: meta.regionId,
    });
  }

  /** Drop every retained original and attribution record. */
  clear(): void {
    this.entries.clear();
    this.storedBytes = 0;
  }

  private batch(handles: readonly ReversibleHandle[]): Map<string, StoredHandle> {
    const batch = new Map<string, StoredHandle>();
    const expiresAt = this.now() + this.ttlMs;
    for (const handle of handles) {
      if (!handle.id) continue;
      const original = handle.origin === 'optical' && typeof handle.original === 'string'
        ? handle.original
        : undefined;
      if (handle.origin !== 'semantic' && original === undefined) continue;
      batch.set(handle.id, {
        original,
        bytes: original === undefined ? 0 : Buffer.byteLength(original),
        expiresAt,
        meta: {
          engine: handle.origin,
          contentType: handle.contentType ?? 'unknown',
          ratio: handle.ratio,
          regionId: handle.regionId,
        },
      });
    }
    return batch;
  }

  private entry(id: string, touch: boolean): StoredHandle | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.remove(id, entry);
      return undefined;
    }
    if (touch) {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
    return entry;
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(id, entry);
    }
  }

  private evictToLimits(protectedIds: ReadonlySet<string>): void {
    while (this.entries.size > this.maxEntries || this.storedBytes > this.maxStoredBytes) {
      const candidate = [...this.entries.entries()].find(([id]) => !protectedIds.has(id));
      if (!candidate) throw new RangeError('CCR store cannot retain the current request batch');
      this.remove(candidate[0], candidate[1]);
    }
  }

  private remove(id: string, entry: StoredHandle): void {
    if (!this.entries.delete(id)) return;
    this.storedBytes -= entry.bytes;
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
