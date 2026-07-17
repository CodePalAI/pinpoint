import {
  DASHBOARD_SCHEMA_VERSION,
  sanitizeDashboardLabel,
  type DashboardHeadroomAttribution,
  type DashboardHeadroomCoverage,
  type DashboardHeadroomSampleEvent,
  type DashboardObserver,
  type DashboardProviderQuota,
} from './types.js';

interface HeadroomCounters {
  readonly requests: number;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly outputTokens: number;
  readonly tokensSaved: number;
  readonly costSavedUsd: number | null;
  readonly model: string | null;
  readonly coverage: DashboardHeadroomCoverage;
}

export interface HeadroomDashboardAdapterOptions {
  readonly baseUrl: string;
  readonly attribution: DashboardHeadroomAttribution;
  readonly observer: DashboardObserver;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nullableNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function emptyCounters(): HeadroomCounters {
  return {
    requests: 0,
    beforeTokens: 0,
    afterTokens: 0,
    outputTokens: 0,
    tokensSaved: 0,
    costSavedUsd: 0,
    model: null,
    coverage: 'unavailable',
  };
}

function readCounters(payload: unknown, attribution: DashboardHeadroomAttribution): HeadroomCounters {
  if (!isRecord(payload)) return emptyCounters();
  const usage = isRecord(payload.agent_usage) ? payload.agent_usage : {};
  const agents = Array.isArray(usage.agents) ? usage.agents.filter(isRecord) : [];
  const copilot = agents.find((row) => row.agent === 'copilot');
  let source: Record<string, unknown> | undefined = copilot;
  let coverage: DashboardHeadroomCoverage = copilot ? 'copilot-request-logs' : 'unavailable';
  if (!source && attribution === 'dedicated' && isRecord(usage.totals)) {
    source = usage.totals;
    coverage = 'aggregate-fallback';
  }
  const models = source && isRecord(source.models) ? source.models : {};
  const primaryModel = Object.entries(models)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const summary = isRecord(payload.summary) ? payload.summary : {};
  const summaryCost = isRecord(summary.cost) ? summary.cost : {};
  const breakdown = isRecord(summaryCost.breakdown) ? summaryCost.breakdown : {};
  return {
    requests: nonNegative(source?.requests),
    beforeTokens: nonNegative(source?.before_tokens),
    afterTokens: nonNegative(source?.after_tokens),
    outputTokens: nonNegative(source?.output_tokens),
    tokensSaved: nonNegative(source?.tokens_saved),
    costSavedUsd: attribution === 'dedicated'
      ? nullableNonNegative(breakdown.compression_savings_usd)
      : null,
    model: sanitizeDashboardLabel(primaryModel),
    coverage,
  };
}

function counterDelta(current: number, baseline: number): number {
  return current >= baseline ? current - baseline : current;
}

function parseQuota(payload: unknown): DashboardProviderQuota[] {
  if (!isRecord(payload) || !isRecord(payload.copilot_quota)) return [];
  const latest = isRecord(payload.copilot_quota.latest) ? payload.copilot_quota.latest : undefined;
  if (!latest || !isRecord(latest.categories)) return [];
  const resetAt = typeof latest.quota_reset_date_utc === 'string' && Number.isFinite(Date.parse(latest.quota_reset_date_utc))
    ? new Date(latest.quota_reset_date_utc).toISOString()
    : null;
  const allowed = ['chat', 'completions', 'premium_interactions'] as const;
  const result: DashboardProviderQuota[] = [];
  for (const category of allowed) {
    const raw = latest.categories[category];
    if (!isRecord(raw)) continue;
    const reportedAt = typeof raw.timestamp_utc === 'string' && Number.isFinite(Date.parse(raw.timestamp_utc))
      ? new Date(raw.timestamp_utc).toISOString()
      : null;
    result.push({
      category,
      entitlement: nullableNonNegative(raw.entitlement),
      remaining: nullableNonNegative(raw.remaining),
      used: nullableNonNegative(raw.used),
      usedPercent: nullableNonNegative(raw.used_percent),
      unlimited: raw.unlimited === true,
      resetAt,
      reportedAt,
    });
  }
  return result;
}

export class HeadroomDashboardAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private baseline: HeadroomCounters | null;
  private lastFingerprint: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(private readonly options: HeadroomDashboardAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.intervalMs = Math.max(250, options.intervalMs ?? 5_000);
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 2_000);
    this.baseline = options.attribution === 'dedicated' ? emptyCounters() : null;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.polling) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const [healthResponse, statsResponse] = await Promise.all([
          this.fetchImpl(`${this.baseUrl}/health`, { signal: controller.signal }),
          this.fetchImpl(`${this.baseUrl}/stats?cached=1`, { signal: controller.signal }),
        ]);
        if (!healthResponse.ok || !statsResponse.ok) throw new Error('headroom unavailable');
        const health = await healthResponse.json() as unknown;
        const stats = await statsResponse.json() as unknown;
        const current = readCounters(stats, this.options.attribution);
        if (this.baseline == null) this.baseline = current;
        const baseline = this.baseline;
        const costSaved = current.costSavedUsd == null || baseline.costSavedUsd == null
          ? null
          : counterDelta(current.costSavedUsd, baseline.costSavedUsd);
        const healthRecord = isRecord(health) ? health : {};
        this.emit({
          schemaVersion: DASHBOARD_SCHEMA_VERSION,
          type: 'headroom.sample',
          source: 'headroom',
          occurredAt: this.now().toISOString(),
          healthy: healthRecord.status === 'healthy',
          version: sanitizeDashboardLabel(typeof healthRecord.version === 'string' ? healthRecord.version : null),
          attribution: this.options.attribution,
          coverage: current.coverage,
          model: current.model,
          requests: this.metric(counterDelta(current.requests, baseline.requests), 'requests'),
          tokensText: this.metric(counterDelta(current.beforeTokens, baseline.beforeTokens), 'tokens'),
          tokensSent: this.metric(counterDelta(current.afterTokens, baseline.afterTokens), 'tokens'),
          outputTokens: this.metric(counterDelta(current.outputTokens, baseline.outputTokens), 'tokens'),
          tokensSaved: this.metric(counterDelta(current.tokensSaved, baseline.tokensSaved), 'tokens'),
          costSaved: costSaved == null ? null : {
            value: costSaved,
            unit: 'usd',
            source: 'headroom',
            basis: 'estimated-list-price',
            scope: 'session',
          },
          quota: parseQuota(stats),
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      this.emitUnavailable();
    } finally {
      this.polling = false;
    }
  }

  private metric(value: number, unit: 'tokens' | 'requests') {
    return {
      value,
      unit,
      source: 'headroom' as const,
      basis: 'provider-reported' as const,
      scope: 'session' as const,
    };
  }

  private emitUnavailable(): void {
    this.emit({
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      type: 'headroom.sample',
      source: 'headroom',
      occurredAt: this.now().toISOString(),
      healthy: false,
      version: null,
      attribution: this.options.attribution,
      coverage: 'unavailable',
      model: null,
      requests: this.metric(0, 'requests'),
      tokensText: this.metric(0, 'tokens'),
      tokensSent: this.metric(0, 'tokens'),
      outputTokens: this.metric(0, 'tokens'),
      tokensSaved: this.metric(0, 'tokens'),
      costSaved: null,
      quota: [],
    });
  }

  private emit(event: DashboardHeadroomSampleEvent): void {
    const fingerprint = JSON.stringify({ ...event, occurredAt: '' });
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    try {
      const pending = this.options.observer.onEvent(event);
      if (pending) void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // The wrapped agent remains authoritative; dashboard failures are isolated.
    }
  }
}
