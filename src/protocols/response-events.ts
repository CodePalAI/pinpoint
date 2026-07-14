import type { Provider } from '../types.js';
import type { ResponseEvent } from '../output/types.js';

interface PendingToolCall {
  name: string;
  arguments: string;
  callId?: string;
}

export interface ResponseEventDecoder {
  push(chunk: Uint8Array): void;
  end(): void;
}

export interface ResponseEventDecoderOptions {
  readonly provider: Provider;
  readonly contentType?: string | null;
  readonly onEvent: (event: ResponseEvent) => void;
  readonly maxBufferedJsonBytes?: number;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function usageEvent(raw: unknown): ResponseEvent | undefined {
  const usage = object(raw);
  if (!usage) return undefined;
  const inputDetails = object(usage.input_tokens_details) ?? object(usage.prompt_tokens_details);
  const inputTokens = number(usage.input_tokens) ?? number(usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens) ?? number(usage.completion_tokens);
  const cacheReadTokens =
    number(usage.cache_read_input_tokens) ?? number(inputDetails?.cached_tokens);
  const cacheWriteTokens = number(usage.cache_creation_input_tokens);
  const event: Extract<ResponseEvent, { type: 'usage' }> = { type: 'usage' };
  if (inputTokens !== undefined) Object.assign(event, { inputTokens });
  if (outputTokens !== undefined) Object.assign(event, { outputTokens });
  if (cacheReadTokens !== undefined) Object.assign(event, { cacheReadTokens });
  if (cacheWriteTokens !== undefined) Object.assign(event, { cacheWriteTokens });
  return event;
}

/** Incremental SSE decoder; whole JSON responses are buffered up to a bounded cap. */
export function createResponseEventDecoder(
  options: ResponseEventDecoderOptions,
): ResponseEventDecoder {
  const decoder = new TextDecoder();
  const isSse = options.contentType?.toLowerCase().includes('text/event-stream') ?? false;
  const maxJson = options.maxBufferedJsonBytes ?? 4_000_000;
  const anthropicTools = new Map<number, PendingToolCall>();
  const openAiTools = new Map<string, PendingToolCall>();
  let buffer = '';
  let capped = false;
  let ended = false;

  const emit = options.onEvent;

  function emitTool(call: PendingToolCall): void {
    if (!call.name) return;
    emit({
      type: 'tool-call',
      name: call.name,
      arguments: call.arguments || '{}',
      callId: call.callId,
    });
  }

  function flushOpenAiTools(): void {
    for (const call of openAiTools.values()) emitTool(call);
    openAiTools.clear();
  }

  function handlePayload(payload: Record<string, unknown>, eventName = ''): void {
    const type = typeof payload.type === 'string' ? payload.type : eventName;

    if (type === 'message_start') {
      const event = usageEvent(object(payload.message)?.usage);
      if (event) emit(event);
    } else if (type === 'content_block_start') {
      const index = Number(payload.index ?? 0);
      const block = object(payload.content_block);
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        const initialInput = object(block.input);
        anthropicTools.set(index, {
          name: block.name,
          arguments:
            initialInput && Object.keys(initialInput).length > 0
              ? JSON.stringify(initialInput)
              : '',
          callId: typeof block.id === 'string' ? block.id : undefined,
        });
      }
    } else if (type === 'content_block_delta') {
      const delta = object(payload.delta);
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        emit({ type: 'text-delta', text: delta.text });
      } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        emit({ type: 'thinking-delta', text: delta.thinking });
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const call = anthropicTools.get(Number(payload.index ?? 0));
        if (call) call.arguments += delta.partial_json;
      }
    } else if (type === 'content_block_stop') {
      const index = Number(payload.index ?? 0);
      const call = anthropicTools.get(index);
      if (call) emitTool(call);
      anthropicTools.delete(index);
    } else if (type === 'message_delta') {
      const event = usageEvent(payload.usage);
      if (event) emit(event);
      const reason = object(payload.delta)?.stop_reason;
      if (typeof reason === 'string') emit({ type: 'stop', reason });
    } else if (type === 'error') {
      const error = object(payload.error);
      emit({ type: 'error', message: String(error?.message ?? payload.message ?? 'provider error') });
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const rawChoice of choices) {
      const choice = object(rawChoice);
      const message = object(choice?.delta) ?? object(choice?.message);
      if (typeof message?.content === 'string') emit({ type: 'text-delta', text: message.content });
      const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      for (const rawCall of calls) {
        const call = object(rawCall);
        const index = String(call?.index ?? call?.id ?? 0);
        const fn = object(call?.function);
        const pending = openAiTools.get(index) ?? { name: '', arguments: '' };
        if (typeof fn?.name === 'string') pending.name = fn.name;
        if (typeof fn?.arguments === 'string') pending.arguments += fn.arguments;
        if (typeof call?.id === 'string') pending.callId = call.id;
        openAiTools.set(index, pending);
      }
      if (typeof choice?.finish_reason === 'string') {
        flushOpenAiTools();
        emit({ type: 'stop', reason: choice.finish_reason });
      }
    }
    if (
      type !== 'message_start' &&
      type !== 'message_delta' &&
      type !== 'response.completed' &&
      type !== 'response.incomplete'
    ) {
      const topUsage = usageEvent(payload.usage);
      if (topUsage) emit(topUsage);
    }

    if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      emit({ type: 'text-delta', text: payload.delta });
    } else if (type === 'response.output_item.added') {
      const item = object(payload.item);
      if (item?.type === 'function_call' && typeof item.name === 'string') {
        const key = String(item.id ?? item.call_id ?? payload.output_index ?? 0);
        openAiTools.set(key, {
          name: item.name,
          arguments: typeof item.arguments === 'string' ? item.arguments : '',
          callId: typeof item.call_id === 'string' ? item.call_id : undefined,
        });
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const key = String(payload.item_id ?? payload.output_index ?? 0);
      const call = openAiTools.get(key);
      if (call && typeof payload.delta === 'string') call.arguments += payload.delta;
    } else if (type === 'response.function_call_arguments.done') {
      const key = String(payload.item_id ?? payload.output_index ?? 0);
      const call = openAiTools.get(key);
      if (call && typeof payload.arguments === 'string') call.arguments = payload.arguments;
      if (call) emitTool(call);
      openAiTools.delete(key);
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      flushOpenAiTools();
      const response = object(payload.response);
      const event = usageEvent(response?.usage);
      if (event) emit(event);
      emit({ type: 'stop', reason: type === 'response.completed' ? 'stop' : 'incomplete' });
    } else if (type === 'response.failed') {
      const response = object(payload.response);
      emit({ type: 'error', message: String(object(response?.error)?.message ?? 'response failed') });
    }
  }

  function handleSseBlock(block: string): void {
    let eventName = '';
    let data = '';
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trimStart();
    }
    if (!data || data === '[DONE]') return;
    try {
      const payload = object(JSON.parse(data));
      if (payload) handlePayload(payload, eventName);
    } catch {
      // Malformed provider events are ignored; raw response bytes still pass through.
    }
  }

  function drainSse(): void {
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index == null) return;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      handleSseBlock(block);
    }
  }

  function handleWholeJson(): void {
    try {
      const payload = object(JSON.parse(buffer));
      if (!payload) return;
      handlePayload(payload);

      const content = Array.isArray(payload.content) ? payload.content : [];
      for (const rawBlock of content) {
        const block = object(rawBlock);
        if (block?.type === 'text' && typeof block.text === 'string') {
          emit({ type: 'text-delta', text: block.text });
        } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
          emit({
            type: 'tool-call',
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
            callId: typeof block.id === 'string' ? block.id : undefined,
          });
        }
      }

      const output = Array.isArray(payload.output) ? payload.output : [];
      for (const rawItem of output) {
        const item = object(rawItem);
        if (item?.type === 'message') {
          const itemContent = Array.isArray(item.content) ? item.content : [];
          for (const rawPart of itemContent) {
            const part = object(rawPart);
            if (part?.type === 'output_text' && typeof part.text === 'string') {
              emit({ type: 'text-delta', text: part.text });
            }
          }
        } else if (item?.type === 'function_call' && typeof item.name === 'string') {
          emit({
            type: 'tool-call',
            name: item.name,
            arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
            callId: typeof item.call_id === 'string' ? item.call_id : undefined,
          });
        }
      }
      if (typeof payload.stop_reason === 'string') emit({ type: 'stop', reason: payload.stop_reason });
      else if (payload.status === 'completed') emit({ type: 'stop', reason: 'stop' });
      else if (payload.status === 'incomplete') emit({ type: 'stop', reason: 'incomplete' });
    } catch {
      // Non-JSON response; no normalized events.
    }
  }

  return {
    push(chunk: Uint8Array): void {
      if (ended || capped) return;
      buffer += decoder.decode(chunk, { stream: true });
      if (isSse) {
        if (buffer.length > maxJson) {
          capped = true;
          buffer = '';
          return;
        }
        drainSse();
      } else if (buffer.length > maxJson) {
        capped = true;
        buffer = '';
      }
    },
    end(): void {
      if (ended) return;
      ended = true;
      if (!capped) {
        buffer += decoder.decode();
        if (isSse) {
          drainSse();
          if (buffer.trim()) handleSseBlock(buffer);
        } else {
          handleWholeJson();
        }
      }
      for (const call of anthropicTools.values()) emitTool(call);
      anthropicTools.clear();
      flushOpenAiTools();
      emit({ type: 'response-end' });
    },
  };
}