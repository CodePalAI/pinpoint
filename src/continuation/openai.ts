import { CCR_TOOL_NAME, type CcrStore } from '../ccr/store.js';

interface OpenAiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly raw: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function retrievalId(argumentsText: string): string | undefined {
  const input = parseArguments(argumentsText);
  const id = input?.id ?? input?.hash;
  return typeof id === 'string' && id.length > 0 && id.length <= 512 ? id : undefined;
}

function responseCalls(response: Readonly<Record<string, unknown>>): OpenAiToolCall[] {
  const output = Array.isArray(response.output) ? response.output : [];
  return output.flatMap((item) => {
    if (!isRecord(item) || item.type !== 'function_call' || typeof item.name !== 'string') return [];
    const id = item.call_id ?? item.id;
    if (typeof id !== 'string') return [];
    return [{
      id,
      name: item.name,
      arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
      raw: item,
    }];
  });
}

function chatCalls(response: Readonly<Record<string, unknown>>): OpenAiToolCall[] {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const choice = choices.find(isRecord);
  const message = isRecord(choice?.message) ? choice.message : undefined;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return calls.flatMap((call) => {
    if (!isRecord(call) || typeof call.id !== 'string') return [];
    const fn = isRecord(call.function) ? call.function : undefined;
    if (typeof fn?.name !== 'string') return [];
    return [{
      id: call.id,
      name: fn.name,
      arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
      raw: call,
    }];
  });
}

export function openAiToolCalls(
  response: Readonly<Record<string, unknown>>,
): OpenAiToolCall[] {
  const responses = responseCalls(response);
  return responses.length > 0 ? responses : chatCalls(response);
}

export function hasInternalOpenAiToolUse(
  response: Readonly<Record<string, unknown>>,
): boolean {
  return openAiToolCalls(response).some((call) => call.name === CCR_TOOL_NAME);
}

async function retrieve(call: OpenAiToolCall, ccr: CcrStore): Promise<{
  readonly content: string;
  readonly error: boolean;
}> {
  const id = retrievalId(call.arguments);
  const content = id ? await ccr.retrieve(id) : null;
  return {
    content:
      content ??
      JSON.stringify({
        error: id ? 'CCR content not found or expired' : 'invalid headroom_retrieve input',
      }),
    error: content == null,
  };
}

export async function continueInternalOpenAiTurn(
  request: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
  ccr: CcrStore,
  allowedCcrIds: ReadonlySet<string>,
): Promise<Record<string, unknown> | undefined> {
  const calls = openAiToolCalls(response);
  if (calls.length === 0 || calls.some((call) => call.name !== CCR_TOOL_NAME)) return undefined;

  const results = await Promise.all(
    calls.map(async (call) => {
      const id = retrievalId(call.arguments);
      const result = id && allowedCcrIds.has(id)
        ? await retrieve(call, ccr)
        : { content: JSON.stringify({ error: 'invalid or unavailable headroom_retrieve input' }), error: true };
      return { call, result };
    }),
  );
  if (Object.hasOwn(request, 'input')) {
    const originalInput = Array.isArray(request.input)
      ? structuredClone(request.input)
      : [{ role: 'user', content: [{ type: 'input_text', text: String(request.input ?? '') }] }];
    const output = Array.isArray(response.output) ? structuredClone(response.output) : [];
    return {
      ...structuredClone(request),
      stream: false,
      input: [
        ...originalInput,
        ...output,
        ...results.map(({ call, result }) => ({
          type: 'function_call_output',
          call_id: call.id,
          output: result.content,
        })),
      ],
    };
  }

  const messages = Array.isArray(request.messages) ? structuredClone(request.messages) : undefined;
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const choice = choices.find(isRecord);
  const assistant = isRecord(choice?.message) ? structuredClone(choice.message) : undefined;
  if (!messages || !assistant) return undefined;
  return {
    ...structuredClone(request),
    stream: false,
    messages: [
      ...messages,
      assistant,
      ...results.map(({ call, result }) => ({
        role: 'tool',
        tool_call_id: call.id,
        content: result.content,
      })),
    ],
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Sum canonical usage over hidden OpenAI continuation rounds. */
export function aggregateOpenAiUsage(
  responses: readonly Readonly<Record<string, unknown>>[],
): Record<string, unknown> {
  const final = structuredClone(responses.at(-1) ?? {}) as Record<string, unknown>;
  const usesResponsesShape = responses.some(
    (response) => isRecord(response.usage) && response.usage.input_tokens !== undefined,
  );
  if (usesResponsesShape) {
    const usage = isRecord(final.usage) ? { ...final.usage } : {};
    usage.input_tokens = responses.reduce(
      (total, response) => total + finiteNumber(isRecord(response.usage) ? response.usage.input_tokens : undefined),
      0,
    );
    usage.output_tokens = responses.reduce(
      (total, response) => total + finiteNumber(isRecord(response.usage) ? response.usage.output_tokens : undefined),
      0,
    );
    usage.total_tokens = finiteNumber(usage.input_tokens) + finiteNumber(usage.output_tokens);
    final.usage = usage;
    return final;
  }

  const usage = isRecord(final.usage) ? { ...final.usage } : {};
  usage.prompt_tokens = responses.reduce(
    (total, response) => total + finiteNumber(isRecord(response.usage) ? response.usage.prompt_tokens : undefined),
    0,
  );
  usage.completion_tokens = responses.reduce(
    (total, response) => total + finiteNumber(isRecord(response.usage) ? response.usage.completion_tokens : undefined),
    0,
  );
  usage.total_tokens = finiteNumber(usage.prompt_tokens) + finiteNumber(usage.completion_tokens);
  final.usage = usage;
  return final;
}