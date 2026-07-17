import type { RuntimeMode } from '../kernel/types.js';
import type {
  AuthMode,
  CompressionReason,
  Provider,
  Stage,
  TokenBasis,
} from '../types.js';

export const DASHBOARD_SCHEMA_VERSION = 1 as const;

export type DashboardSource = 'pinpoint' | 'headroom' | 'mcp';

export type DashboardMetricUnit = 'tokens' | 'bytes' | 'requests' | 'milliseconds' | 'usd';

export type DashboardMetricBasis =
  | TokenBasis
  | 'mixed-token-bases'
  | 'exact-bytes'
  | 'provider-reported'
  | 'derived'
  | 'estimated-list-price';

export type DashboardMetricScope = 'request' | 'session' | 'history' | 'provider-window';

export interface DashboardMetricValue {
  readonly value: number;
  readonly unit: DashboardMetricUnit;
  readonly source: DashboardSource;
  readonly basis: DashboardMetricBasis;
  readonly scope: DashboardMetricScope;
}

export interface DashboardStageOutcome {
  readonly stage: Stage;
  readonly applied: boolean;
  readonly reason: CompressionReason;
  readonly tokensText: number;
  readonly tokensCompressed: number;
  readonly tokensSaved: number;
  readonly basis: TokenBasis;
}

export interface DashboardProviderRouteEvent {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly type: 'provider.route';
  readonly source: 'pinpoint';
  readonly occurredAt: string;
  readonly provider: Provider;
  readonly model: string | null;
  readonly authMode: AuthMode;
  readonly mode: RuntimeMode;
  readonly durationMs: number;
  readonly tokensText: DashboardMetricValue;
  readonly tokensCompressed: DashboardMetricValue;
  readonly tokensSaved: DashboardMetricValue;
  readonly reversibleCount: number;
  readonly stages: readonly DashboardStageOutcome[];
}

export type DashboardMcpOutcome = 'succeeded' | 'failed' | 'denied';

interface DashboardMcpEventBase {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly source: 'mcp';
  readonly occurredAt: string;
}

export interface DashboardMcpToolEvent extends DashboardMcpEventBase {
  readonly type: 'mcp.tool';
  readonly tool: string;
  readonly outcome: DashboardMcpOutcome;
  readonly durationMs: number;
}

export interface DashboardMcpResultEvent extends DashboardMcpEventBase {
  readonly type: 'mcp.result';
  readonly tool: string;
  readonly outcome: DashboardMcpOutcome;
  readonly virtualized: boolean;
  readonly protectedSource: boolean;
  readonly bytesBefore: DashboardMetricValue;
  readonly bytesVisible: DashboardMetricValue;
  readonly artifactKind: string | null;
  readonly artifactItems: number | null;
}

export interface DashboardMcpQueryEvent extends DashboardMcpEventBase {
  readonly type: 'mcp.query';
  readonly operation: 'schema' | 'json_select' | 'count' | 'grep' | 'slice' | 'json_join' | 'invalid';
  readonly outcome: DashboardMcpOutcome;
  readonly resultBytes: DashboardMetricValue;
  readonly durationMs: number;
}

export interface DashboardMcpFlowEvent extends DashboardMcpEventBase {
  readonly type: 'mcp.flow';
  readonly flow: string;
  readonly sourceTool: string;
  readonly destinationTool: string;
  readonly destinationServer: string | null;
  readonly operation: 'json_select' | 'count' | 'grep' | 'slice';
  readonly outcome: DashboardMcpOutcome;
  readonly items: number;
  readonly payloadBytes: DashboardMetricValue;
  readonly destinationResultBytes: DashboardMetricValue;
  readonly receiptEmitted: boolean;
  readonly durationMs: number;
}

export interface DashboardMcpLifecycleEvent extends DashboardMcpEventBase {
  readonly type: 'mcp.lifecycle';
  readonly state: 'started' | 'stopped' | 'failed';
  readonly flowsConfigured: number;
  readonly privateDestination: boolean;
}

export type DashboardHeadroomAttribution = 'dedicated' | 'shared';
export type DashboardHeadroomCoverage = 'copilot-request-logs' | 'aggregate-fallback' | 'unavailable';

export interface DashboardProviderQuota {
  readonly category: 'chat' | 'completions' | 'premium_interactions';
  readonly entitlement: number | null;
  readonly remaining: number | null;
  readonly used: number | null;
  readonly usedPercent: number | null;
  readonly unlimited: boolean;
  readonly resetAt: string | null;
  readonly reportedAt: string | null;
}

export interface DashboardHeadroomSampleEvent {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly type: 'headroom.sample';
  readonly source: 'headroom';
  readonly occurredAt: string;
  readonly healthy: boolean;
  readonly version: string | null;
  readonly attribution: DashboardHeadroomAttribution;
  readonly coverage: DashboardHeadroomCoverage;
  readonly model: string | null;
  readonly requests: DashboardMetricValue;
  readonly tokensText: DashboardMetricValue;
  readonly tokensSent: DashboardMetricValue;
  readonly outputTokens: DashboardMetricValue;
  readonly tokensSaved: DashboardMetricValue;
  readonly costSaved: DashboardMetricValue | null;
  readonly quota: readonly DashboardProviderQuota[];
}

export type DashboardEvent =
  | DashboardProviderRouteEvent
  | DashboardMcpToolEvent
  | DashboardMcpResultEvent
  | DashboardMcpQueryEvent
  | DashboardMcpFlowEvent
  | DashboardMcpLifecycleEvent
  | DashboardHeadroomSampleEvent;

export type DashboardSourceState = 'active' | 'ended' | 'degraded';

export interface DashboardSourceSummary {
  readonly source: DashboardSource;
  readonly state: DashboardSourceState;
  readonly producers: number;
  readonly lastActivityAt: string | null;
}

export interface DashboardTokenLane {
  readonly source: DashboardSource;
  readonly basis: DashboardMetricBasis;
  readonly tokensText: number;
  readonly tokensSent: number;
  readonly tokensSaved: number;
  readonly appliedStages: number;
}

export interface DashboardByteLane {
  readonly source: 'mcp';
  readonly basis: 'exact-bytes';
  readonly bytesBefore: number;
  readonly bytesVisible: number;
  readonly bytesRetained: number;
  readonly virtualizedResults: number;
}

export interface DashboardMcpSummary {
  readonly toolCalls: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly denied: number;
  readonly queries: number;
  readonly flows: number;
  readonly receiptsEmitted: number;
}

export interface DashboardHeadroomSummary {
  readonly healthy: boolean;
  readonly version: string | null;
  readonly attribution: DashboardHeadroomAttribution;
  readonly coverage: DashboardHeadroomCoverage;
  readonly model: string | null;
  readonly outputTokens: number;
  readonly costSaved: DashboardMetricValue | null;
  readonly quota: readonly DashboardProviderQuota[];
}

export interface DashboardSnapshot {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly groupId: string;
  readonly state: 'active' | 'ended' | 'degraded';
  readonly requests: number;
  readonly reversibleCount: number;
  readonly tokenLanes: readonly DashboardTokenLane[];
  readonly byteLanes: readonly DashboardByteLane[];
  readonly mcp: DashboardMcpSummary;
  readonly headroom: DashboardHeadroomSummary | null;
  readonly sources: readonly DashboardSourceSummary[];
  readonly recentEvents: readonly DashboardEvent[];
  readonly corruptRecords: number;
  readonly privacy: {
    readonly metadataOnly: true;
    readonly neverStored: readonly string[];
  };
}

export interface DashboardHistorySession {
  readonly groupId: string;
  readonly state: DashboardSnapshot['state'];
  readonly startedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly requests: number;
  readonly sources: readonly DashboardSource[];
  readonly corruptRecords: number;
}

export interface DashboardObserver {
  onEvent(event: DashboardEvent): void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field: ${unknown[0]}`);
  const missing = expected.filter((key) => !(key in value));
  if (missing.length > 0) throw new TypeError(`${label} is missing field: ${missing[0]}`);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

export function sanitizeDashboardLabel(value: string | null, maxLength = 128): string | null {
  if (value == null) return null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return sanitized ? sanitized.slice(0, Math.max(1, maxLength)) : null;
}

function normalizeMetric(value: unknown, label: string): DashboardMetricValue {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  exactKeys(value, ['value', 'unit', 'source', 'basis', 'scope'], label);
  return {
    value: finiteNumber(value.value, `${label}.value`),
    unit: oneOf(value.unit, ['tokens', 'bytes', 'requests', 'milliseconds', 'usd'], `${label}.unit`),
    source: oneOf(value.source, ['pinpoint', 'headroom', 'mcp'], `${label}.source`),
    basis: oneOf(
      value.basis,
      [
        'anthropic-count_tokens',
        'gpt-tokenizer',
        'tiktoken',
        'estimate',
        'mixed-token-bases',
        'exact-bytes',
        'provider-reported',
        'derived',
        'estimated-list-price',
      ],
      `${label}.basis`,
    ),
    scope: oneOf(value.scope, ['request', 'session', 'history', 'provider-window'], `${label}.scope`),
  };
}

function normalizeStage(value: unknown, index: number): DashboardStageOutcome {
  const label = `dashboard event stage ${index}`;
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  exactKeys(
    value,
    ['stage', 'applied', 'reason', 'tokensText', 'tokensCompressed', 'tokensSaved', 'basis'],
    label,
  );
  if (typeof value.applied !== 'boolean') throw new TypeError(`${label}.applied must be boolean`);
  const tokensText = nonNegativeInteger(value.tokensText, `${label}.tokensText`);
  const tokensCompressed = nonNegativeInteger(value.tokensCompressed, `${label}.tokensCompressed`);
  const tokensSaved = finiteNumber(value.tokensSaved, `${label}.tokensSaved`);
  if (tokensSaved !== tokensText - tokensCompressed) {
    throw new TypeError(`${label}.tokensSaved does not match before and after values`);
  }
  return {
    stage: oneOf(value.stage, ['optical', 'semantic', 'virtual'], `${label}.stage`),
    applied: value.applied,
    reason: oneOf(
      value.reason,
      [
        'applied',
        'not_profitable',
        'unsupported_model',
        'below_threshold',
        'disabled',
        'degraded',
        'stealth',
        'error',
        'passthrough',
      ],
      `${label}.reason`,
    ),
    tokensText,
    tokensCompressed,
    tokensSaved,
    basis: oneOf(
      value.basis,
      ['anthropic-count_tokens', 'gpt-tokenizer', 'tiktoken', 'estimate'],
      `${label}.basis`,
    ),
  };
}

function eventTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('dashboard event occurredAt must be an ISO timestamp');
  }
  return new Date(value).toISOString();
}

function boundedLabel(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const sanitized = sanitizeDashboardLabel(value, 128);
  if (sanitized == null) throw new TypeError(`${label} must not be empty`);
  return sanitized;
}

function nullableBoundedLabel(value: unknown, label: string): string | null {
  if (value === null) return null;
  return boundedLabel(value, label);
}

function exactByteMetric(value: unknown, label: string, scope: DashboardMetricScope): DashboardMetricValue {
  const metric = normalizeMetric(value, label);
  if (
    metric.unit !== 'bytes' ||
    metric.source !== 'mcp' ||
    metric.basis !== 'exact-bytes' ||
    metric.scope !== scope ||
    !Number.isInteger(metric.value) ||
    metric.value < 0
  ) {
    throw new TypeError(`${label} must be a non-negative exact MCP byte count`);
  }
  return metric;
}

function normalizeMcpEvent(value: Record<string, unknown>): Exclude<DashboardEvent, DashboardProviderRouteEvent> {
  const common = {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    source: 'mcp' as const,
    occurredAt: eventTimestamp(value.occurredAt),
  };
  if (value.source !== 'mcp') throw new TypeError('MCP event source must be mcp');
  if (value.type === 'mcp.tool') {
    exactKeys(value, ['schemaVersion', 'type', 'source', 'occurredAt', 'tool', 'outcome', 'durationMs'], 'dashboard MCP tool event');
    return {
      ...common,
      type: 'mcp.tool',
      tool: boundedLabel(value.tool, 'dashboard MCP tool'),
      outcome: oneOf(value.outcome, ['succeeded', 'failed', 'denied'], 'dashboard MCP outcome'),
      durationMs: Math.max(0, finiteNumber(value.durationMs, 'dashboard MCP durationMs')),
    };
  }
  if (value.type === 'mcp.result') {
    exactKeys(
      value,
      ['schemaVersion', 'type', 'source', 'occurredAt', 'tool', 'outcome', 'virtualized', 'protectedSource', 'bytesBefore', 'bytesVisible', 'artifactKind', 'artifactItems'],
      'dashboard MCP result event',
    );
    if (typeof value.virtualized !== 'boolean' || typeof value.protectedSource !== 'boolean') {
      throw new TypeError('dashboard MCP result flags must be boolean');
    }
    if (value.artifactItems !== null && (!Number.isInteger(value.artifactItems) || Number(value.artifactItems) < 0)) {
      throw new TypeError('dashboard MCP artifactItems must be a non-negative integer or null');
    }
    return {
      ...common,
      type: 'mcp.result',
      tool: boundedLabel(value.tool, 'dashboard MCP result tool'),
      outcome: oneOf(value.outcome, ['succeeded', 'failed', 'denied'], 'dashboard MCP result outcome'),
      virtualized: value.virtualized,
      protectedSource: value.protectedSource,
      bytesBefore: exactByteMetric(value.bytesBefore, 'dashboard MCP bytesBefore', 'request'),
      bytesVisible: exactByteMetric(value.bytesVisible, 'dashboard MCP bytesVisible', 'request'),
      artifactKind: nullableBoundedLabel(value.artifactKind, 'dashboard MCP artifactKind'),
      artifactItems: value.artifactItems === null ? null : Number(value.artifactItems),
    };
  }
  if (value.type === 'mcp.query') {
    exactKeys(value, ['schemaVersion', 'type', 'source', 'occurredAt', 'operation', 'outcome', 'resultBytes', 'durationMs'], 'dashboard MCP query event');
    return {
      ...common,
      type: 'mcp.query',
      operation: oneOf(value.operation, ['schema', 'json_select', 'count', 'grep', 'slice', 'json_join', 'invalid'], 'dashboard MCP query operation'),
      outcome: oneOf(value.outcome, ['succeeded', 'failed', 'denied'], 'dashboard MCP query outcome'),
      resultBytes: exactByteMetric(value.resultBytes, 'dashboard MCP query resultBytes', 'request'),
      durationMs: Math.max(0, finiteNumber(value.durationMs, 'dashboard MCP query durationMs')),
    };
  }
  if (value.type === 'mcp.flow') {
    exactKeys(
      value,
      ['schemaVersion', 'type', 'source', 'occurredAt', 'flow', 'sourceTool', 'destinationTool', 'destinationServer', 'operation', 'outcome', 'items', 'payloadBytes', 'destinationResultBytes', 'receiptEmitted', 'durationMs'],
      'dashboard MCP flow event',
    );
    if (typeof value.receiptEmitted !== 'boolean') throw new TypeError('dashboard MCP receiptEmitted must be boolean');
    return {
      ...common,
      type: 'mcp.flow',
      flow: boundedLabel(value.flow, 'dashboard MCP flow'),
      sourceTool: boundedLabel(value.sourceTool, 'dashboard MCP sourceTool'),
      destinationTool: boundedLabel(value.destinationTool, 'dashboard MCP destinationTool'),
      destinationServer: nullableBoundedLabel(value.destinationServer, 'dashboard MCP destinationServer'),
      operation: oneOf(value.operation, ['json_select', 'count', 'grep', 'slice'], 'dashboard MCP flow operation'),
      outcome: oneOf(value.outcome, ['succeeded', 'failed', 'denied'], 'dashboard MCP flow outcome'),
      items: nonNegativeInteger(value.items, 'dashboard MCP flow items'),
      payloadBytes: exactByteMetric(value.payloadBytes, 'dashboard MCP flow payloadBytes', 'request'),
      destinationResultBytes: exactByteMetric(value.destinationResultBytes, 'dashboard MCP destinationResultBytes', 'request'),
      receiptEmitted: value.receiptEmitted,
      durationMs: Math.max(0, finiteNumber(value.durationMs, 'dashboard MCP flow durationMs')),
    };
  }
  if (value.type === 'mcp.lifecycle') {
    exactKeys(value, ['schemaVersion', 'type', 'source', 'occurredAt', 'state', 'flowsConfigured', 'privateDestination'], 'dashboard MCP lifecycle event');
    if (typeof value.privateDestination !== 'boolean') throw new TypeError('dashboard MCP privateDestination must be boolean');
    return {
      ...common,
      type: 'mcp.lifecycle',
      state: oneOf(value.state, ['started', 'stopped', 'failed'], 'dashboard MCP lifecycle state'),
      flowsConfigured: nonNegativeInteger(value.flowsConfigured, 'dashboard MCP flowsConfigured'),
      privateDestination: value.privateDestination,
    };
  }
  throw new TypeError('unsupported dashboard event type');
}

function nullableNonNegativeNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  const parsed = finiteNumber(value, label);
  if (parsed < 0) throw new TypeError(`${label} must be non-negative or null`);
  return parsed;
}

function normalizeQuota(value: unknown, index: number): DashboardProviderQuota {
  const label = `dashboard quota ${index}`;
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  exactKeys(
    value,
    ['category', 'entitlement', 'remaining', 'used', 'usedPercent', 'unlimited', 'resetAt', 'reportedAt'],
    label,
  );
  if (typeof value.unlimited !== 'boolean') throw new TypeError(`${label}.unlimited must be boolean`);
  const timestamp = (input: unknown, field: string): string | null => {
    if (input === null) return null;
    if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) {
      throw new TypeError(`${label}.${field} must be an ISO timestamp or null`);
    }
    return new Date(input).toISOString();
  };
  return {
    category: oneOf(value.category, ['chat', 'completions', 'premium_interactions'], `${label}.category`),
    entitlement: nullableNonNegativeNumber(value.entitlement, `${label}.entitlement`),
    remaining: nullableNonNegativeNumber(value.remaining, `${label}.remaining`),
    used: nullableNonNegativeNumber(value.used, `${label}.used`),
    usedPercent: nullableNonNegativeNumber(value.usedPercent, `${label}.usedPercent`),
    unlimited: value.unlimited,
    resetAt: timestamp(value.resetAt, 'resetAt'),
    reportedAt: timestamp(value.reportedAt, 'reportedAt'),
  };
}

function normalizeHeadroomMetric(
  value: unknown,
  label: string,
  unit: 'tokens' | 'requests',
): DashboardMetricValue {
  const metric = normalizeMetric(value, label);
  if (
    metric.source !== 'headroom' ||
    metric.scope !== 'session' ||
    metric.unit !== unit ||
    metric.basis !== 'provider-reported' ||
    metric.value < 0
  ) {
    throw new TypeError(`${label} must be a non-negative session-scoped Headroom provider report`);
  }
  return metric;
}

function normalizeHeadroomEvent(value: Record<string, unknown>): DashboardHeadroomSampleEvent {
  exactKeys(
    value,
    ['schemaVersion', 'type', 'source', 'occurredAt', 'healthy', 'version', 'attribution', 'coverage', 'model', 'requests', 'tokensText', 'tokensSent', 'outputTokens', 'tokensSaved', 'costSaved', 'quota'],
    'dashboard Headroom sample',
  );
  if (value.source !== 'headroom') throw new TypeError('Headroom sample source must be headroom');
  if (typeof value.healthy !== 'boolean') throw new TypeError('Headroom sample healthy must be boolean');
  if (!Array.isArray(value.quota) || value.quota.length > 3) {
    throw new TypeError('Headroom sample quota must contain at most three categories');
  }
  let costSaved: DashboardMetricValue | null = null;
  if (value.costSaved !== null) {
    costSaved = normalizeMetric(value.costSaved, 'dashboard Headroom costSaved');
    if (
      costSaved.source !== 'headroom' ||
      costSaved.scope !== 'session' ||
      costSaved.unit !== 'usd' ||
      costSaved.basis !== 'estimated-list-price' ||
      costSaved.value < 0
    ) {
      throw new TypeError('dashboard Headroom costSaved must be a non-negative session estimate');
    }
  }
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    type: 'headroom.sample',
    source: 'headroom',
    occurredAt: eventTimestamp(value.occurredAt),
    healthy: value.healthy,
    version: nullableBoundedLabel(value.version, 'dashboard Headroom version'),
    attribution: oneOf(value.attribution, ['dedicated', 'shared'], 'dashboard Headroom attribution'),
    coverage: oneOf(value.coverage, ['copilot-request-logs', 'aggregate-fallback', 'unavailable'], 'dashboard Headroom coverage'),
    model: nullableBoundedLabel(value.model, 'dashboard Headroom model'),
    requests: normalizeHeadroomMetric(value.requests, 'dashboard Headroom requests', 'requests'),
    tokensText: normalizeHeadroomMetric(value.tokensText, 'dashboard Headroom tokensText', 'tokens'),
    tokensSent: normalizeHeadroomMetric(value.tokensSent, 'dashboard Headroom tokensSent', 'tokens'),
    outputTokens: normalizeHeadroomMetric(value.outputTokens, 'dashboard Headroom outputTokens', 'tokens'),
    tokensSaved: normalizeHeadroomMetric(value.tokensSaved, 'dashboard Headroom tokensSaved', 'tokens'),
    costSaved,
    quota: value.quota.map(normalizeQuota),
  };
}

/** Rebuild one dashboard event from an exact allowlist before persistence or display. */
export function normalizeDashboardEvent(value: unknown): DashboardEvent {
  if (!isRecord(value)) throw new TypeError('dashboard event must be an object');
  if (value.schemaVersion !== DASHBOARD_SCHEMA_VERSION) {
    throw new TypeError('unsupported dashboard event schema');
  }
  if (value.type === 'headroom.sample') return normalizeHeadroomEvent(value);
  if (typeof value.type === 'string' && value.type.startsWith('mcp.')) return normalizeMcpEvent(value);
  if (value.type !== 'provider.route') throw new TypeError('unsupported dashboard event type');
  exactKeys(
    value,
    [
      'schemaVersion',
      'type',
      'source',
      'occurredAt',
      'provider',
      'model',
      'authMode',
      'mode',
      'durationMs',
      'tokensText',
      'tokensCompressed',
      'tokensSaved',
      'reversibleCount',
      'stages',
    ],
    'dashboard event',
  );
  if (value.source !== 'pinpoint') throw new TypeError('provider.route source must be pinpoint');
  if (value.model !== null && typeof value.model !== 'string') {
    throw new TypeError('dashboard event model must be a string or null');
  }
  if (!Array.isArray(value.stages) || value.stages.length > 16) {
    throw new TypeError('dashboard event stages must contain at most 16 entries');
  }
  const tokensText = normalizeMetric(value.tokensText, 'dashboard event tokensText');
  const tokensCompressed = normalizeMetric(value.tokensCompressed, 'dashboard event tokensCompressed');
  const tokensSaved = normalizeMetric(value.tokensSaved, 'dashboard event tokensSaved');
  for (const metric of [tokensText, tokensCompressed, tokensSaved]) {
    if (metric.unit !== 'tokens' || metric.source !== 'pinpoint' || metric.scope !== 'request') {
      throw new TypeError('provider.route metrics must be request-scoped Pinpoint token values');
    }
  }
  const tokenBases: readonly DashboardMetricBasis[] = [
    'anthropic-count_tokens',
    'gpt-tokenizer',
    'tiktoken',
    'estimate',
    'mixed-token-bases',
  ];
  for (const metric of [tokensText, tokensCompressed, tokensSaved]) {
    if (!tokenBases.includes(metric.basis)) {
      throw new TypeError('provider.route metrics must use a token-counting basis');
    }
  }
  if (tokensSaved.value !== tokensText.value - tokensCompressed.value) {
    throw new TypeError('dashboard event tokensSaved does not match before and after values');
  }
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    type: 'provider.route',
    source: 'pinpoint',
    occurredAt: eventTimestamp(value.occurredAt),
    provider: oneOf(value.provider, ['anthropic', 'openai'], 'dashboard event provider'),
    model: sanitizeDashboardLabel(value.model),
    authMode: oneOf(value.authMode, ['payg', 'oauth', 'subscription'], 'dashboard event authMode'),
    mode: oneOf(value.mode, ['audit', 'shadow', 'optimize', 'enforce'], 'dashboard event mode'),
    durationMs: Math.max(0, finiteNumber(value.durationMs, 'dashboard event durationMs')),
    tokensText,
    tokensCompressed,
    tokensSaved,
    reversibleCount: nonNegativeInteger(value.reversibleCount, 'dashboard event reversibleCount'),
    stages: value.stages.map(normalizeStage),
  };
}