import {
  VIRTUAL_QUERY_TOOL_NAME,
  type VirtualContextQuery,
  type VirtualContextStore,
} from './store.js';

export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

const QUERY_OPS = new Set(['schema', 'json_select', 'count', 'grep', 'slice']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function anthropicToolUseBlocks(
  response: Readonly<Record<string, unknown>>,
): AnthropicToolUseBlock[] {
  const content = Array.isArray(response.content) ? response.content : [];
  return content.filter((value): value is AnthropicToolUseBlock => {
    if (!isRecord(value)) return false;
    return (
      value.type === 'tool_use' &&
      typeof value.id === 'string' &&
      typeof value.name === 'string'
    );
  });
}

export function parseVirtualContextQuery(value: unknown): VirtualContextQuery | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.op !== 'string') {
    return undefined;
  }
  if (!QUERY_OPS.has(value.op)) return undefined;
  if (value.where !== undefined) {
    if (!isRecord(value.where)) return undefined;
    if (
      Object.entries(value.where).some(
        ([field, expected]) =>
          field.length === 0 ||
          field.length > 256 ||
          (expected !== null && !['string', 'number', 'boolean'].includes(typeof expected)),
      )
    ) {
      return undefined;
    }
  }
  if (
    value.fields !== undefined &&
    (!Array.isArray(value.fields) ||
      value.fields.length > 64 ||
      value.fields.some((field) => typeof field !== 'string' || field.length === 0 || field.length > 256))
  ) {
    return undefined;
  }
  if (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 1_024)) {
    return undefined;
  }
  for (const field of ['offset', 'limit'] as const) {
    const number = value[field];
    if (number !== undefined && (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)) {
      return undefined;
    }
  }
  if (typeof value.limit === 'number' && (value.limit < 1 || value.limit > 100)) return undefined;
  return value as unknown as VirtualContextQuery;
}

export function hasVirtualAnthropicToolUse(
  response: Readonly<Record<string, unknown>>,
): boolean {
  return anthropicToolUseBlocks(response).some((call) => call.name === VIRTUAL_QUERY_TOOL_NAME);
}

export function virtualAnthropicToolResult(
  call: AnthropicToolUseBlock,
  store: VirtualContextStore,
  allowedIds: ReadonlySet<string>,
): Record<string, unknown> {
  const query = parseVirtualContextQuery(call.input);
  const allowed = query !== undefined && allowedIds.has(query.id);
  return {
    type: 'tool_result',
    tool_use_id: call.id,
    content: allowed
      ? store.query(query)
      : JSON.stringify({ error: 'invalid or unavailable pixroom_query input' }),
    is_error: !allowed,
  };
}

/** Build a provider continuation when every tool call belongs to the virtual store. */
export function continueVirtualAnthropicTurn(
  request: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
  store: VirtualContextStore,
  allowedIds: ReadonlySet<string> = new Set(),
): Record<string, unknown> | undefined {
  const calls = anthropicToolUseBlocks(response);
  if (calls.length === 0 || calls.some((call) => call.name !== VIRTUAL_QUERY_TOOL_NAME)) {
    return undefined;
  }
  const messages = Array.isArray(request.messages) ? request.messages : undefined;
  const content = Array.isArray(response.content) ? response.content : undefined;
  if (!messages || !content) return undefined;

  const results = calls.map((call) => virtualAnthropicToolResult(call, store, allowedIds));

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

const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;

/** Sum canonical Anthropic usage over hidden query rounds into the final response. */
export function aggregateAnthropicUsage(
  responses: readonly Readonly<Record<string, unknown>>[],
): Record<string, unknown> {
  const final = structuredClone(responses.at(-1) ?? {}) as Record<string, unknown>;
  const finalUsage = isRecord(final.usage) ? final.usage : {};
  const usage: Record<string, unknown> = { ...finalUsage };
  for (const field of USAGE_FIELDS) {
    usage[field] = responses.reduce((total, response) => {
      const raw = isRecord(response.usage) ? response.usage[field] : undefined;
      return total + (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0);
    }, 0);
  }
  final.usage = usage;
  return final;
}