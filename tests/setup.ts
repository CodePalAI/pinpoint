import { webcrypto } from 'node:crypto';

if (globalThis.crypto == null) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}