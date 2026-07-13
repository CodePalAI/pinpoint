/**
 * Anthropic Messages request helpers.
 *
 * pixroom's router hands each region to exactly one engine. This module isolates
 * the *semantic* region of an Anthropic request — the `tool_result` text blocks in
 * non-recent turns, and (opt-in) large plain-text prose in non-recent user turns —
 * so the headroom stage can compress them while pxpipe images the static
 * system+tools slab and recent turns stay byte-exact
 * (planning/end_product.md §3). It never touches `system`, `tools`, images, model
 * output, or the last `protectRecent` turns.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function parseBody(bytes: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(decoder.decode(bytes));
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Anthropic request body is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function serializeBody(body: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify(body));
}

export function readModel(body: Record<string, unknown>): string | null {
  const m = body.model;
  return typeof m === 'string' && m.length > 0 ? m : null;
}

/** A `tool_result` text block eligible for semantic compression. */
export interface ToolResultTarget {
  readonly messageIndex: number;
  readonly blockIndex: number;
  /** Flattened text content of the tool_result. */
  readonly text: string;
  readonly toolUseId?: string;
}

interface Block {
  type?: unknown;
  content?: unknown;
  text?: unknown;
  tool_use_id?: unknown;
  [k: string]: unknown;
}

/**
 * Flatten a `tool_result.content` to a single string IFF it is losslessly
 * representable as text — i.e. a string, or an array of `{type:'text'}` blocks.
 * Returns `null` when the content contains images or other non-text blocks, so the
 * caller keeps it sharp (never risk clobbering non-text fidelity).
 */
function flattenTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block == null || typeof block !== 'object') return null;
    const b = block as Block;
    if (b.type !== 'text' || typeof b.text !== 'string') return null;
    parts.push(b.text);
  }
  return parts.join('');
}

function getMessages(body: Record<string, unknown>): unknown[] {
  const m = body.messages;
  return Array.isArray(m) ? m : [];
}

/**
 * Collect the semantic region: `tool_result` text blocks in all but the last
 * `protectRecent` messages, whose flattened text meets `minChars`. Ordered by
 * (messageIndex, blockIndex) so results map back 1:1 after compression.
 */
export function collectToolResultTargets(
  body: Record<string, unknown>,
  opts: { protectRecent: number; minChars: number },
): ToolResultTarget[] {
  const messages = getMessages(body);
  const cutoff = Math.max(0, messages.length - Math.max(0, opts.protectRecent));
  const targets: ToolResultTarget[] = [];

  for (let mi = 0; mi < cutoff; mi++) {
    const msg = messages[mi];
    if (msg == null || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (let bi = 0; bi < content.length; bi++) {
      const block = content[bi];
      if (block == null || typeof block !== 'object') continue;
      const b = block as Block;
      if (b.type !== 'tool_result') continue;
      const text = flattenTextContent(b.content);
      if (text == null || text.length < opts.minChars) continue;
      targets.push({
        messageIndex: mi,
        blockIndex: bi,
        text,
        toolUseId: typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined,
      });
    }
  }
  return targets;
}

/**
 * Reinject compressed text into the collected targets, in order. `compressed[i]`
 * replaces `targets[i]`'s content. Mutates `body` in place. Caller must guarantee
 * `compressed.length === targets.length` (length mismatch ⇒ don't call this; degrade).
 */
export function applyCompressedToolResults(
  body: Record<string, unknown>,
  targets: readonly ToolResultTarget[],
  compressed: readonly string[],
): void {
  if (compressed.length !== targets.length) {
    throw new Error(
      `refusing to reinject: ${compressed.length} compressed vs ${targets.length} targets`,
    );
  }
  const messages = getMessages(body);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const msg = messages[t.messageIndex];
    if (msg == null || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    const block = content[t.blockIndex];
    if (block == null || typeof block !== 'object') continue;
    (block as Block).content = compressed[i]!;
  }
}

/** Total chars across a set of targets (denominator for gate/estimate). */
export function totalChars(targets: readonly { readonly text: string }[]): number {
  let n = 0;
  for (const t of targets) n += t.text.length;
  return n;
}

/**
 * A plain-text prose region eligible for semantic compression. `blockIndex === -1`
 * marks a message whose `content` is a raw string (rewritten wholesale on reinject).
 */
export interface ProseTarget {
  readonly messageIndex: number;
  readonly blockIndex: number;
  readonly text: string;
}

/**
 * Collect large plain-`text` prose in non-recent USER messages — the region both
 * pxpipe (static slab) and the tool_result stage skip, so it otherwise passes
 * through raw. Assistant turns, `tool_result` blocks, images/non-text blocks,
 * `system`, and the last `protectRecent` turns are never touched: this only adds
 * headroom coverage, never risks fidelity of model output or recent context.
 */
export function collectProseTargets(
  body: Record<string, unknown>,
  opts: { protectRecent: number; minChars: number },
): ProseTarget[] {
  const messages = getMessages(body);
  const cutoff = Math.max(0, messages.length - Math.max(0, opts.protectRecent));
  const targets: ProseTarget[] = [];

  for (let mi = 0; mi < cutoff; mi++) {
    const msg = messages[mi];
    if (msg == null || typeof msg !== 'object') continue;
    if ((msg as { role?: unknown }).role !== 'user') continue;
    const content = (msg as { content?: unknown }).content;
    if (typeof content === 'string') {
      if (content.length >= opts.minChars) {
        targets.push({ messageIndex: mi, blockIndex: -1, text: content });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (let bi = 0; bi < content.length; bi++) {
      const block = content[bi];
      if (block == null || typeof block !== 'object') continue;
      const b = block as Block;
      if (b.type !== 'text' || typeof b.text !== 'string') continue;
      if (b.text.length < opts.minChars) continue;
      targets.push({ messageIndex: mi, blockIndex: bi, text: b.text });
    }
  }
  return targets;
}

/**
 * Reinject compressed prose into the collected targets, in order (mirror of
 * {@link applyCompressedToolResults}). Mutates `body` in place; caller guarantees
 * `compressed.length === targets.length`.
 */
export function applyCompressedProse(
  body: Record<string, unknown>,
  targets: readonly ProseTarget[],
  compressed: readonly string[],
): void {
  if (compressed.length !== targets.length) {
    throw new Error(
      `refusing to reinject prose: ${compressed.length} compressed vs ${targets.length} targets`,
    );
  }
  const messages = getMessages(body);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const msg = messages[t.messageIndex];
    if (msg == null || typeof msg !== 'object') continue;
    if (t.blockIndex === -1) {
      (msg as { content?: unknown }).content = compressed[i]!;
      continue;
    }
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    const block = content[t.blockIndex];
    if (block == null || typeof block !== 'object') continue;
    (block as Block).text = compressed[i]!;
  }
}
