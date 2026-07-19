import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeadroomDashboardAdapter } from '../src/dashboard/headroom.js';
import type { DashboardEvent } from '../src/dashboard/types.js';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stats(overrides: {
  requests: number;
  before: number;
  after: number;
  output: number;
  saved: number;
  cost?: number;
  agent?: string;
  model?: string;
}) {
  return {
    agent_usage: {
      agents: [{
        agent: overrides.agent ?? 'copilot',
        label: 'GitHub Copilot',
        source: 'client',
        requests: overrides.requests,
        before_tokens: overrides.before,
        after_tokens: overrides.after,
        output_tokens: overrides.output,
        tokens_saved: overrides.saved,
        models: { [overrides.model ?? 'gpt-5.3-codex']: overrides.requests },
        providers: { openai: overrides.requests },
        request_id: 'sensitive-request-id',
        tags: { private: 'sensitive-tag-value' },
      }],
      totals: {
        requests: overrides.requests + 99,
        before_tokens: overrides.before + 99_000,
        after_tokens: overrides.after + 99_000,
        output_tokens: overrides.output + 99_000,
        tokens_saved: overrides.saved + 99_000,
      },
    },
    summary: {
      cost: { breakdown: { compression_savings_usd: overrides.cost ?? 0 } },
    },
    copilot_quota: {
      latest: {
        login: 'private-github-login',
        copilot_plan: 'individual',
        quota_reset_date_utc: '2026-08-01T00:00:00Z',
        categories: {
          premium_interactions: {
            entitlement: 300,
            remaining: 250,
            used: 50,
            used_percent: 16.67,
            unlimited: false,
            timestamp_utc: '2026-07-17T10:00:00Z',
          },
        },
      },
    },
    request_logs: [{ request_id: 'private-log-id', prompt: 'private-prompt' }],
  };
}

function queuedFetch(payloads: unknown[]): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/health')) return response({ status: 'healthy', version: '1.2.3' });
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return response(payload);
  }) as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HeadroomDashboardAdapter', () => {
  it('recovers the model from a sole provider-labeled row on a dedicated proxy', async () => {
    const events: DashboardEvent[] = [];
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'dedicated',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: queuedFetch([
        stats({
          requests: 2,
          before: 4_000,
          after: 4_000,
          output: 80,
          saved: 0,
          agent: 'openai',
          model: 'gpt-4o',
        }),
      ]),
    });

    await adapter.poll();

    expect(events[0]).toMatchObject({
      model: 'gpt-4o',
      requests: { value: 2 },
      tokensText: { value: 4_000 },
      outputTokens: { value: 80 },
    });
  });

  it('samples fast enough to observe short-lived wrapped requests', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(queuedFetch([
      stats({ requests: 0, before: 0, after: 0, output: 0, saved: 0 }),
      stats({ requests: 1, before: 1_000, after: 800, output: 50, saved: 200 }),
    ]));
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'dedicated',
      observer: { onEvent: () => undefined },
      fetch: fetchImpl,
    });

    await adapter.start();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await adapter.stop();
  });

  it('does not replace final usage with an unavailable sample during shutdown', async () => {
    const events: DashboardEvent[] = [];
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    const pending = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'dedicated',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: (() => pending) as typeof fetch,
    });

    const poll = adapter.poll();
    await Promise.resolve();
    const stop = adapter.stop();
    rejectFetch?.(new Error('proxy stopped'));
    await Promise.all([poll, stop]);

    expect(events).toEqual([]);
  });

  it('cancels a deferred disconnect when a healthy adapter stops', async () => {
    vi.useFakeTimers();
    const events: DashboardEvent[] = [];
    let available = true;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (!available) throw new Error('proxy stopped');
      return String(input).endsWith('/health')
        ? response({ status: 'healthy', version: '1.2.3' })
        : response(stats({ requests: 1, before: 1_000, after: 800, output: 50, saved: 200 }));
    }) as typeof fetch;
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'dedicated',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: fetchImpl,
    });

    await adapter.start();
    available = false;
    await adapter.poll();
    await adapter.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ healthy: true, requests: { value: 1 } });
  });

  it('baselines a shared proxy and emits only Copilot-class deltas without cost attribution', async () => {
    const events: DashboardEvent[] = [];
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'shared',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: queuedFetch([
        stats({ requests: 40, before: 40_000, after: 25_000, output: 2_000, saved: 15_000, cost: 2 }),
        stats({ requests: 43, before: 44_000, after: 27_500, output: 2_500, saved: 16_500, cost: 3 }),
        stats({ requests: 43, before: 44_000, after: 27_500, output: 2_500, saved: 16_500, cost: 3 }),
      ]),
      now: () => new Date('2026-07-17T10:00:00Z'),
    });

    await adapter.poll();
    await adapter.poll();
    await adapter.poll();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'headroom.sample',
      attribution: 'shared',
      coverage: 'copilot-request-logs',
      requests: { value: 0, basis: 'provider-reported' },
      tokensSaved: { value: 0, basis: 'provider-reported' },
      costSaved: null,
    });
    expect(events[1]).toMatchObject({
      type: 'headroom.sample',
      requests: { value: 3 },
      tokensText: { value: 4_000 },
      tokensSent: { value: 2_500 },
      outputTokens: { value: 500 },
      tokensSaved: { value: 1_500 },
      costSaved: null,
      quota: [{ category: 'premium_interactions', entitlement: 300, remaining: 250 }],
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('private-github-login');
    expect(serialized).not.toContain('sensitive-request-id');
    expect(serialized).not.toContain('private-prompt');
    expect(serialized).not.toContain('sensitive-tag-value');
  });

  it('attributes a fresh dedicated proxy from zero and labels cost as an estimate', async () => {
    const events: DashboardEvent[] = [];
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'dedicated',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: queuedFetch([
        stats({ requests: 2, before: 5_000, after: 2_000, output: 700, saved: 3_000, cost: 0.75 }),
      ]),
      now: () => new Date('2026-07-17T10:00:00Z'),
    });

    await adapter.poll();

    expect(events[0]).toMatchObject({
      type: 'headroom.sample',
      attribution: 'dedicated',
      requests: { value: 2 },
      tokensSaved: { value: 3_000 },
      costSaved: {
        value: 0.75,
        unit: 'usd',
        source: 'headroom',
        basis: 'estimated-list-price',
        scope: 'session',
      },
    });
  });

  it('degrades to an unavailable content-free sample when Headroom is malformed', async () => {
    const events: DashboardEvent[] = [];
    const adapter = new HeadroomDashboardAdapter({
      baseUrl: 'http://127.0.0.1:8787',
      attribution: 'shared',
      observer: { onEvent: (event) => { events.push(event); } },
      fetch: (async () => response({ error: 'sensitive-upstream-error' }, 500)) as typeof fetch,
      now: () => new Date('2026-07-17T10:00:00Z'),
    });

    await adapter.poll();

    expect(events[0]).toMatchObject({
      type: 'headroom.sample',
      healthy: false,
      coverage: 'unavailable',
      requests: { value: 0 },
      costSaved: null,
      quota: [],
    });
    expect(JSON.stringify(events)).not.toContain('sensitive-upstream-error');
  });
});