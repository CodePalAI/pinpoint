const TOKEN_STORAGE_KEY = 'pinpoint.dashboard.access-token';

export interface SessionTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readDashboardToken(
  hash: string,
  storage: SessionTokenStorage,
): { readonly token: string | null; readonly consumedHash: boolean } {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const fragmentToken = fragment.get('access_token');
  if (fragmentToken) {
    try {
      storage.setItem(TOKEN_STORAGE_KEY, fragmentToken);
    } catch {
      // The protected URL still works when session storage is unavailable.
    }
    return { token: fragmentToken, consumedHash: true };
  }
  try {
    return { token: storage.getItem(TOKEN_STORAGE_KEY), consumedHash: false };
  } catch {
    return { token: null, consumedHash: false };
  }
}

export function clearDashboardToken(storage: SessionTokenStorage): void {
  try {
    storage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage may be blocked; there is nothing else to clear.
  }
}