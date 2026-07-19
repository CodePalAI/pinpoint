import type { Readable } from 'node:stream';

export const MAX_MCP_JSON_RPC_FRAME_BYTES = 16 * 1024 * 1024;

export interface BoundedNdjsonHandlers {
  readonly onLine: (line: string) => void;
  readonly onOverflow: () => void;
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
  let chunks: Buffer[] = [];
  let frameBytes = 0;
  let discarding = false;
  let closed = false;

  const reset = (): void => {
    chunks = [];
    frameBytes = 0;
  };
  const emitLine = (): void => {
    const line = Buffer.concat(chunks, frameBytes).toString('utf8');
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
    chunks.push(Buffer.from(chunk));
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