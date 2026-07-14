import { CCR_TOOL_NAME, type CcrStore } from '../ccr/store.js';
import {
  anthropicToolUseBlocks,
  virtualAnthropicToolResult,
  type AnthropicToolUseBlock,
} from '../virtual-context/anthropic.js';
import { VIRTUAL_QUERY_TOOL_NAME, type VirtualContextStore } from '../virtual-context/store.js';

export interface AnthropicContinuationOptions {
  readonly ccr: CcrStore;
  readonly virtualContext: VirtualContextStore;
  readonly allowedVirtualIds: ReadonlySet<string>;
  readonly allowedCcrIds: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function retrievalId(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const id = input.id ?? input.hash;
  return typeof id === 'string' && id.length > 0 && id.length <= 512 ? id : undefined;
}

export function hasInternalAnthropicToolUse(
  response: Readonly<Record<string, unknown>>,
): boolean {
  return anthropicToolUseBlocks(response).some(
    (call) => call.name === VIRTUAL_QUERY_TOOL_NAME || call.name === CCR_TOOL_NAME,
  );
}

async function ccrToolResult(
  call: AnthropicToolUseBlock,
  ccr: CcrStore,
  allowedIds: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const id = retrievalId(call.input);
  const allowed = id !== undefined && allowedIds.has(id);
  const content = allowed ? await ccr.retrieve(id) : null;
  return {
    type: 'tool_result',
    tool_use_id: call.id,
    content:
      content ??
      JSON.stringify({
        error: allowed
          ? 'CCR content not found or expired'
          : 'invalid or unavailable headroom_retrieve input',
      }),
    is_error: content == null,
  };
}

/** Continue only when every provider tool call is owned by Pixroom. */
export async function continueInternalAnthropicTurn(
  request: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
  options: AnthropicContinuationOptions,
): Promise<Record<string, unknown> | undefined> {
  const calls = anthropicToolUseBlocks(response);
  if (
    calls.length === 0 ||
    calls.some(
      (call) => call.name !== VIRTUAL_QUERY_TOOL_NAME && call.name !== CCR_TOOL_NAME,
    )
  ) {
    return undefined;
  }
  const messages = Array.isArray(request.messages) ? request.messages : undefined;
  const content = Array.isArray(response.content) ? response.content : undefined;
  if (!messages || !content) return undefined;

  const results: Record<string, unknown>[] = [];
  for (const call of calls) {
    results.push(
      call.name === VIRTUAL_QUERY_TOOL_NAME
        ? virtualAnthropicToolResult(
            call,
            options.virtualContext,
            options.allowedVirtualIds,
          )
        : await ccrToolResult(call, options.ccr, options.allowedCcrIds),
    );
  }

  return {
    ...structuredClone(request),
    stream: false,
    messages: [
      ...structuredClone(messages),
      { role: 'assistant', content: structuredClone(content) },
      { role: 'user', content: results },
    ],
  };
}