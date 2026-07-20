#!/usr/bin/env node
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

const path = process.argv[2];
const limit = Number(process.argv[3]);
if (!path) throw new Error('bundle path is required');
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('bundle limit is invalid');
const nonblock = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;
const nofollow = process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number'
  ? 0
  : constants.O_NOFOLLOW;
const pathMetadata = lstatSync(path);
if (pathMetadata.isSymbolicLink()) throw new Error('bundle must not be a symbolic link');
const descriptor = openSync(path, constants.O_RDONLY | nonblock | nofollow);
try {
  const metadata = fstatSync(descriptor);
  if (!metadata.isFile()) throw new Error('bundle must be a regular file');
  if (metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
    throw new Error('bundle path changed during validation');
  }
  const chunks = [];
  let bytes = 0;
  while (bytes <= limit) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - bytes));
    const count = readSync(descriptor, chunk, 0, chunk.length, null);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    bytes += count;
  }
  if (bytes > limit) throw new Error(`bundle exceeds ${limit} bytes`);
  process.stdout.write(Buffer.concat(chunks, bytes));
} finally {
  closeSync(descriptor);
}