import { estimateTokens } from 'pixroom';

const DEFAULT_PATTERNS = [
  /\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*[^\s,;]+/gi,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

function redact(value, patterns, replacement) {
  if (typeof value === 'string') {
    return patterns.reduce((text, pattern) => text.replace(pattern, replacement), value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, patterns, replacement));
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, patterns, replacement)]),
    );
  }
  return value;
}

/** Example non-compression policy integration. It is intentionally opt-in and lossy. */
export function createSecretRedactionIntegration(options = {}) {
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const replacement = options.replacement ?? '[REDACTED]';
  return {
    id: 'example.secret-redaction',
    version: '1.0.0',
    order: 1,
    capabilities: {
      regions: ['system', 'tools', 'history', 'current-turn', 'tool-result'],
      fidelity: 'lossy',
      cacheImpact: 'invalidate',
    },
    async propose(ctx) {
      const before = JSON.stringify(ctx.body);
      const body = redact(structuredClone(ctx.body), patterns, replacement);
      const after = JSON.stringify(body);
      const changed = before !== after;
      return {
        id: `example.secret-redaction:${ctx.stages.length}`,
        integrationId: this.id,
        regions: changed ? this.capabilities.regions : [],
        fidelity: this.capabilities.fidelity,
        cacheImpact: changed ? this.capabilities.cacheImpact : 'preserve',
        estimate: {
          tokensBefore: estimateTokens(before),
          tokensAfter: estimateTokens(after),
          basis: 'estimate',
        },
        patch: { replaceBody: changed ? body : undefined },
      };
    },
  };
}