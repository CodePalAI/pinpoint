/**
 * Auth-mode classifier — a faithful port of headroom's `classify_auth_mode`
 * (headroom/headroom/proxy/auth_mode.py).
 *
 * The client's auth posture decides how aggressive pinpoint may be:
 *   - PAYG (API key): full pipeline, including lossy optical imaging.
 *   - OAuth / Subscription: stealth — the forwarded request must stay native,
 *     so the lossy optical stage is off by default and transport headers
 *     (accept-encoding, User-Agent) are preserved unmutated.
 *
 * Pure function, no I/O, never throws. Decision order = most-specific signal wins.
 */

import type { AuthMode } from '../types.js';

/** User-Agent substrings that identify a UX-bound CLI / IDE (subscription seat). */
const SUBSCRIPTION_UA_PREFIXES: readonly string[] = [
  'claude-cli/',
  'claude-code/',
  'codex-cli/',
  'cursor/',
  'claude-vscode/',
  'github-copilot/',
  'anthropic-cli/',
  'antigravity/',
];

export type HeaderBag = Record<string, string | string[] | undefined> | Headers;

function headerValue(headers: HeaderBag, name: string): string {
  const lower = name.toLowerCase();
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(lower) ?? '';
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  // Node lowercases header names; fall back to a case-insensitive scan otherwise.
  let value = bag[lower];
  if (value === undefined) {
    for (const [k, v] of Object.entries(bag)) {
      if (k.toLowerCase() === lower) {
        value = v;
        break;
      }
    }
  }
  if (value == null) return '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

/**
 * Classify the auth mode of an inbound request from its headers.
 * Safe default is PAYG (a misclassified request just costs a re-run, not a
 * revoked subscription).
 */
export function classifyAuthMode(headers: HeaderBag): AuthMode {
  const auth = headerValue(headers, 'authorization');
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    // Order matters: sk-ant-oat* (Claude Pro/Max OAuth) shares a prefix with sk-ant-api*.
    if (token.startsWith('sk-ant-oat')) return 'oauth';
    if (token.startsWith('sk-ant-api') || token.startsWith('sk-')) return 'payg';
    // Classic three-segment JWT → Codex / Cursor / Copilot OAuth.
    if (token.split('.').length >= 3) return 'oauth';
    // Unknown bearer shape — fall through to default.
  } else if (auth) {
    // Authorization present but not Bearer (e.g. AWS SigV4 → Bedrock): passthrough-prefer.
    return 'oauth';
  }

  if (headerValue(headers, 'x-api-key')) return 'payg';
  if (headerValue(headers, 'x-goog-api-key')) return 'payg';

  const ua = headerValue(headers, 'user-agent').toLowerCase();
  for (const prefix of SUBSCRIPTION_UA_PREFIXES) {
    if (ua.includes(prefix)) return 'subscription';
  }

  return 'payg';
}

/** Stealth = the request must stay native-looking (no lossy transforms / mutations). */
export function isStealth(mode: AuthMode): boolean {
  return mode !== 'payg';
}
