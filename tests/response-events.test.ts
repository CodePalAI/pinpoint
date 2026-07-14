import { describe, expect, it } from 'vitest';

import { createResponseEventDecoder } from '../src/protocols/response-events.js';
import type { ResponseEvent } from '../src/output/types.js';

function chunks(text: string, cuts: readonly number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const result: Uint8Array[] = [];
  let start = 0;
  for (const end of cuts) {
    result.push(bytes.slice(start, end));
    start = end;
  }
  result.push(bytes.slice(start));
  return result;
}

describe('createResponseEventDecoder', () => {
  it('normalizes fragmented Anthropic SSE text, tool calls, usage, and stop', () => {
    const events: ResponseEvent[] = [];
    const raw = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"headroom_retrieve","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"id\\":\\"h1\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"done"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
    ].join('');
    const decoder = createResponseEventDecoder({
      provider: 'anthropic',
      contentType: 'text/event-stream',
      onEvent: (event) => events.push(event),
    });
    for (const chunk of chunks(raw, [3, 17, 79, 143, 211])) decoder.push(chunk);
    decoder.end();

    expect(events).toContainEqual({
      type: 'tool-call',
      name: 'headroom_retrieve',
      arguments: '{"id":"h1"}',
      callId: 't1',
    });
    expect(events).toContainEqual({ type: 'text-delta', text: 'done' });
    expect(events).toContainEqual({ type: 'usage', outputTokens: 7 });
    expect(events).toContainEqual({ type: 'stop', reason: 'end_turn' });
    expect(events.at(-1)).toEqual({ type: 'response-end' });
  });

  it('normalizes OpenAI Responses function-call and completion events', () => {
    const events: ResponseEvent[] = [];
    const raw = [
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"id":"i1","type":"function_call","call_id":"c1","name":"lookup","arguments":""}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"i1","delta":"{\\"q\\":1}"}\n\n',
      'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","item_id":"i1","arguments":"{\\"q\\":1}"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":3,"input_tokens_details":{"cached_tokens":8}}}}\n\n',
    ].join('');
    const decoder = createResponseEventDecoder({
      provider: 'openai',
      contentType: 'text/event-stream; charset=utf-8',
      onEvent: (event) => events.push(event),
    });
    decoder.push(new TextEncoder().encode(raw));
    decoder.end();

    expect(events).toContainEqual({
      type: 'tool-call',
      name: 'lookup',
      arguments: '{"q":1}',
      callId: 'c1',
    });
    expect(events).toContainEqual({ type: 'text-delta', text: 'OK' });
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 20,
      outputTokens: 3,
      cacheReadTokens: 8,
    });
  });

  it('normalizes non-stream OpenAI Chat JSON', () => {
    const events: ResponseEvent[] = [];
    const decoder = createResponseEventDecoder({
      provider: 'openai',
      contentType: 'application/json',
      onEvent: (event) => events.push(event),
    });
    decoder.push(
      new TextEncoder().encode(
        JSON.stringify({
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
      ),
    );
    decoder.end();
    expect(events).toContainEqual({ type: 'text-delta', text: 'hello' });
    expect(events).toContainEqual({ type: 'stop', reason: 'stop' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 2 });
  });

  it('normalizes non-stream OpenAI Responses message text', () => {
    const events: ResponseEvent[] = [];
    const decoder = createResponseEventDecoder({
      provider: 'openai',
      contentType: 'application/json',
      onEvent: (event) => events.push(event),
    });
    decoder.push(
      new TextEncoder().encode(
        JSON.stringify({
          id: 'resp_1',
          object: 'response',
          status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'first' },
              { type: 'refusal', refusal: 'not emitted as text' },
              { type: 'output_text', text: ' second' },
            ],
          }],
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
      ),
    );
    decoder.end();

    expect(events.filter((event) => event.type === 'text-delta')).toEqual([
      { type: 'text-delta', text: 'first' },
      { type: 'text-delta', text: ' second' },
    ]);
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 3 });
    expect(events).toContainEqual({ type: 'stop', reason: 'stop' });
    expect(events.at(-1)).toEqual({ type: 'response-end' });
  });
});