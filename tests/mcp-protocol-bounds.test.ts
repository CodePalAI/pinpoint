import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { readBoundedNdjson } from '../src/mcp/ndjson.js';
import { isValidMcpCallToolResult } from '../src/mcp/tool-result.js';

describe('MCP protocol bounds', () => {
  it('discards one oversized frame and recovers at the next newline', () => {
    const input = new PassThrough();
    const lines: string[] = [];
    let overflows = 0;
    readBoundedNdjson(input, {
      onLine: (line) => lines.push(line),
      onOverflow: () => { overflows += 1; },
    }, 8);

    input.end('1234567890\n{"ok":1}\n');

    expect(overflows).toBe(1);
    expect(lines).toEqual(['{"ok":1}']);
  });

  it('accepts an exact-limit frame across one-byte chunks and preserves CRLF framing', () => {
    const input = new PassThrough();
    const lines: string[] = [];
    let overflows = 0;
    readBoundedNdjson(input, {
      onLine: (line) => lines.push(line),
      onOverflow: () => { overflows += 1; },
    }, 8);

    for (const byte of Buffer.from('12345678\nOK\r\n')) input.write(Buffer.of(byte));
    input.end();

    expect(overflows).toBe(0);
    expect(lines).toEqual(['12345678', 'OK\r']);
  });

  it('rejects invalid UTF-8 without emitting a line', () => {
    const input = new PassThrough();
    const lines: string[] = [];
    let invalid = 0;
    readBoundedNdjson(input, {
      onLine: (line) => lines.push(line),
      onOverflow: () => {},
      onInvalidEncoding: () => { invalid += 1; },
    }, 8);

    input.end(Buffer.from([0xc3, 0x28, 0x0a]));

    expect(invalid).toBe(1);
    expect(lines).toEqual([]);
  });

  it('rejects deeply nested destination output before canonicalization', () => {
    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let depth = 0; depth < 65; depth += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    expect(isValidMcpCallToolResult({ content: [{ type: 'text', nested: root }] })).toBe(false);
  });
});