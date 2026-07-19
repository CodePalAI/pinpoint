import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDashboardSnapshot,
  DashboardGroupReader,
  DashboardJournal,
  readDashboardGroup,
} from '../src/dashboard/journal.js';
import type {
  DashboardHeadroomSampleEvent,
  DashboardProviderRouteEvent,
} from '../src/dashboard/types.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pinpoint-dashboard-'));
  directories.push(directory);
  return join(directory, 'history');
}

function routeEvent(): DashboardProviderRouteEvent {
  const metric = (value: number) => ({
    value,
    unit: 'tokens' as const,
    source: 'pinpoint' as const,
    basis: 'estimate' as const,
    scope: 'request' as const,
  });
  return {
    schemaVersion: 1,
    type: 'provider.route',
    source: 'pinpoint',
    occurredAt: '2026-07-17T10:00:00.000Z',
    provider: 'openai',
    model: 'gpt-test',
    authMode: 'payg',
    mode: 'optimize',
    durationMs: 2.5,
    tokensText: metric(10),
    tokensCompressed: metric(15),
    tokensSaved: metric(-5),
    reversibleCount: 0,
    stages: [{
      stage: 'virtual',
      applied: true,
      reason: 'applied',
      tokensText: 10,
      tokensCompressed: 15,
      tokensSaved: -5,
      basis: 'estimate',
    }],
  };
}

function idleHeadroomEvent(): DashboardHeadroomSampleEvent {
  const metric = (value: number, unit: 'requests' | 'tokens') => ({
    value,
    unit,
    source: 'headroom' as const,
    basis: 'provider-reported' as const,
    scope: 'session' as const,
  });
  return {
    schemaVersion: 1,
    type: 'headroom.sample',
    source: 'headroom',
    occurredAt: '2026-07-17T10:00:00.000Z',
    healthy: true,
    version: '1.2.3',
    attribution: 'dedicated',
    coverage: 'aggregate-fallback',
    model: null,
    requests: metric(0, 'requests'),
    tokensText: metric(0, 'tokens'),
    tokensSent: metric(0, 'tokens'),
    outputTokens: metric(0, 'tokens'),
    tokensSaved: metric(0, 'tokens'),
    costSaved: null,
    quota: [],
  };
}

describe('DashboardJournal', () => {
  it('keeps a cleanly ended Headroom producer ended after a final unavailable sample', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'headroom' });
    journal.onEvent(idleHeadroomEvent());
    journal.onEvent({
      ...idleHeadroomEvent(),
      occurredAt: '2026-07-17T10:00:01.000Z',
      healthy: false,
      coverage: 'unavailable',
      version: null,
    });
    journal.close();

    const snapshot = buildDashboardSnapshot(readDashboardGroup(historyRoot, journal.groupId));
    expect(snapshot.sources).toContainEqual(expect.objectContaining({
      source: 'headroom',
      state: 'ended',
    }));
    expect(snapshot.state).toBe('ended');
  });

  it('keeps idle Headroom attachment out of token calibration', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'headroom' });
    journal.onEvent(idleHeadroomEvent());

    const snapshot = buildDashboardSnapshot(readDashboardGroup(historyRoot, journal.groupId));
    expect(snapshot.requests).toBe(0);
    expect(snapshot.tokenLanes).toEqual([]);
    expect(snapshot.headroom).toMatchObject({
      healthy: true,
      attribution: 'dedicated',
      model: null,
    });
    journal.close();
  });

  it('preserves observed Headroom usage across a later unavailable sample', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'headroom' });
    const usage = idleHeadroomEvent();
    journal.onEvent({
      ...usage,
      occurredAt: '2026-07-17T10:00:01.000Z',
      model: 'gpt-4o',
      requests: { ...usage.requests, value: 1 },
      tokensText: { ...usage.tokensText, value: 1_000 },
      tokensSent: { ...usage.tokensSent, value: 800 },
      outputTokens: { ...usage.outputTokens, value: 50 },
      tokensSaved: { ...usage.tokensSaved, value: 200 },
    });
    journal.onEvent({
      ...idleHeadroomEvent(),
      occurredAt: '2026-07-17T10:00:02.000Z',
      healthy: false,
      coverage: 'unavailable',
      version: null,
    });

    const snapshot = buildDashboardSnapshot(readDashboardGroup(historyRoot, journal.groupId));
    expect(snapshot.state).toBe('degraded');
    expect(snapshot.requests).toBe(1);
    expect(snapshot.tokenLanes).toContainEqual(expect.objectContaining({
      source: 'headroom',
      tokensText: 1_000,
      tokensSent: 800,
      tokensSaved: 200,
    }));
    expect(snapshot.headroom).toMatchObject({
      healthy: false,
      model: 'gpt-4o',
      outputTokens: 50,
    });
    journal.close();
  });

  it('persists only validated metadata with private POSIX modes', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'pinpoint' });
    journal.onEvent(routeEvent());
    journal.close();

    const statePath = join(journal.groupDir, `${journal.producerId}.state.json`);
    const eventPath = join(journal.groupDir, `${journal.producerId}.events.jsonl`);
    if (process.platform !== 'win32') {
      expect(statSync(historyRoot).mode & 0o777).toBe(0o700);
      expect(statSync(journal.groupDir).mode & 0o777).toBe(0o700);
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
      expect(statSync(eventPath).mode & 0o777).toBe(0o600);
    }

    const result = readDashboardGroup(historyRoot, journal.groupId);
    expect(result.corruptRecords).toBe(0);
    expect(result.producers[0]).toMatchObject({ source: 'pinpoint', eventCount: 1 });
    expect(result.events[0]).toMatchObject({
      type: 'provider.route',
      tokensSaved: { value: -5, basis: 'estimate' },
    });
  });

  it('rejects unknown fields before they reach disk', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'pinpoint' });
    const secret = 'raw-prompt-must-never-be-written';

    expect(() => journal.onEvent({ ...routeEvent(), rawPrompt: secret } as DashboardProviderRouteEvent))
      .toThrow('unknown field');
    journal.close();

    const serialized = readFileSync(
      join(journal.groupDir, `${journal.producerId}.state.json`),
      'utf8',
    );
    expect(serialized).not.toContain(secret);
    expect(readDashboardGroup(historyRoot, journal.groupId).events).toHaveLength(0);
  });

  it('isolates corrupt event lines and retains valid history', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'pinpoint' });
    journal.onEvent(routeEvent());
    const eventPath = join(journal.groupDir, `${journal.producerId}.events.jsonl`);
    appendFileSync(eventPath, '{"raw":"secret"}\n', 'utf8');

    const result = readDashboardGroup(historyRoot, journal.groupId);
    expect(result.events).toHaveLength(1);
    expect(result.corruptRecords).toBe(1);
    journal.close();
  });

  it('reuses parsed group state until a journal file changes', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'pinpoint' });
    journal.onEvent(routeEvent());
    const reader = new DashboardGroupReader(historyRoot, journal.groupId);

    expect(reader.read().events).toHaveLength(1);
    expect(reader.read().events).toHaveLength(1);
    expect(reader.stats()).toEqual({ scans: 2, parses: 1, cacheHits: 1 });

    journal.onEvent({ ...routeEvent(), occurredAt: '2026-07-17T10:00:01.000Z' });
    expect(reader.read().events).toHaveLength(2);
    expect(reader.stats()).toEqual({ scans: 3, parses: 2, cacheHits: 1 });
    journal.close();
  });

  it('uses MCP lifecycle evidence when a producer state close marker is interrupted', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'mcp' });
    const metric = (value: number) => ({
      value,
      unit: 'bytes' as const,
      source: 'mcp' as const,
      basis: 'exact-bytes' as const,
      scope: 'request' as const,
    });
    journal.onEvent({
      schemaVersion: 1,
      type: 'mcp.result',
      source: 'mcp',
      occurredAt: '2026-07-17T10:00:00.000Z',
      tool: 'accounts_list',
      outcome: 'succeeded',
      virtualized: true,
      protectedSource: false,
      bytesBefore: metric(1_000),
      bytesVisible: metric(100),
      artifactKind: 'json-array',
      artifactItems: 10,
    });
    journal.onEvent({
      schemaVersion: 1,
      type: 'mcp.lifecycle',
      source: 'mcp',
      occurredAt: '2026-07-17T10:00:01.000Z',
      state: 'stopped',
      flowsConfigured: 0,
      privateDestination: false,
    });

    const snapshot = buildDashboardSnapshot(readDashboardGroup(historyRoot, journal.groupId));
    expect(journal.snapshot().endedAt).toBeNull();
    expect(snapshot.sources).toContainEqual(expect.objectContaining({ source: 'mcp', state: 'ended' }));
    expect(snapshot.state).toBe('ended');
    journal.close();
  });
});