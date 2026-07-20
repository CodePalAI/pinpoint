import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';

export const MAX_MCP_JSON_RPC_FRAME_BYTES = 16 * 1024 * 1024;

export interface BoundedNdjsonHandlers {
  readonly onLine: (line: string) => void;
  readonly onOverflow: () => void;
  readonly onInvalidEncoding?: () => void;
  readonly onEnd?: () => void;
}

export interface BoundedNdjsonReader {
  close(): void;
}

export function readBoundedNdjson(
  input: Readable,
  handlers: BoundedNdjsonHandlers,
  maxFrameBytes = MAX_MCP_JSON_RPC_FRAME_BYTES,
): BoundedNdjsonReader {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) {
    throw new TypeError('maxFrameBytes must be a positive safe integer');
  }
  let buffer = Buffer.allocUnsafe(Math.min(maxFrameBytes, 64 * 1024));
  let frameBytes = 0;
  let discarding = false;
  let closed = false;

  const reset = (): void => {
    frameBytes = 0;
  };
  const emitLine = (): void => {
    let line: string;
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, frameBytes));
    } catch {
      reset();
      handlers.onInvalidEncoding?.();
      return;
    }
    reset();
    handlers.onLine(line);
  };
  const append = (chunk: Buffer): void => {
    if (chunk.length === 0 || discarding) return;
    if (frameBytes + chunk.length > maxFrameBytes) {
      reset();
      discarding = true;
      handlers.onOverflow();
      return;
    }
    const required = frameBytes + chunk.length;
    if (required > buffer.length) {
      let capacity = buffer.length;
      while (capacity < required) capacity = Math.min(maxFrameBytes, Math.max(capacity * 2, required));
      const grown = Buffer.allocUnsafe(capacity);
      buffer.copy(grown, 0, 0, frameBytes);
      buffer = grown;
    }
    chunk.copy(buffer, frameBytes);
    frameBytes += chunk.length;
  };
  const onData = (value: Buffer | string): void => {
    const chunk = typeof value === 'string' ? Buffer.from(value) : value;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline < 0 ? chunk.length : newline;
      append(chunk.subarray(offset, end));
      if (newline < 0) return;
      if (discarding) {
        discarding = false;
        reset();
      } else {
        emitLine();
      }
      offset = newline + 1;
    }
  };
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (!discarding && frameBytes > 0) emitLine();
    reset();
    handlers.onEnd?.();
  };

  input.on('data', onData);
  input.once('end', finish);
  input.once('close', finish);
  return {
    close(): void {
      if (closed) return;
      closed = true;
      reset();
      input.off('data', onData);
      input.off('end', finish);
      input.off('close', finish);
    },
  };
}