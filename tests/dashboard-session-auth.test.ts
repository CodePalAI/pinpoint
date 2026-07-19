import { describe, expect, it } from 'vitest';

import {
  clearDashboardToken,
  readDashboardToken,
  type SessionTokenStorage,
} from '../dashboard/src/session-auth.js';

function memoryStorage(initial?: string): SessionTokenStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
    removeItem() { this.value = null; },
  };
}

describe('dashboard tab authentication', () => {
  it('consumes a protected fragment and restores it after refresh', () => {
    const storage = memoryStorage();
    expect(readDashboardToken('#access_token=fresh-token', storage)).toEqual({
      token: 'fresh-token',
      consumedHash: true,
    });
    expect(readDashboardToken('', storage)).toEqual({
      token: 'fresh-token',
      consumedHash: false,
    });
  });

  it('lets a new protected URL replace a stale token on the same port', () => {
    const storage = memoryStorage('stale-token');
    expect(readDashboardToken('#access_token=replacement-token', storage).token)
      .toBe('replacement-token');
    expect(storage.value).toBe('replacement-token');
  });

  it('clears rejected credentials and tolerates blocked storage', () => {
    const storage = memoryStorage('rejected-token');
    clearDashboardToken(storage);
    expect(storage.value).toBeNull();
    const blocked: SessionTokenStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(readDashboardToken('', blocked)).toEqual({ token: null, consumedHash: false });
    expect(() => clearDashboardToken(blocked)).not.toThrow();
  });
});