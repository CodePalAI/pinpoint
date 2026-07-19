import { describe, expect, it } from 'vitest';

import { compareDashboardSnapshots } from '../dashboard/src/snapshot-sync.js';
import { DASHBOARD_SCHEMA_VERSION, type DashboardSnapshot } from '../src/dashboard/types.js';

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: '2026-07-19T10:00:00.000Z',
    groupId: 'dash_00000000000000000000000000000000',
    state: 'active',
    requests: 1,
    eventCount: 1,
    negativeSavingsRoutes: 0,
    reversibleCount: 0,
    tokenLanes: [],
    byteLanes: [],
    mcp: { toolCalls: 0, succeeded: 0, failed: 0, denied: 0, queries: 0, flows: 0, receiptsEmitted: 0 },
    headroom: null,
    sources: [],
    recentEvents: [],
    corruptRecords: 0,
    privacy: { metadataOnly: true, neverStored: [] },
    ...overrides,
  };
}

describe('dashboard snapshot synchronization', () => {
  it('does not repaint for a newer generatedAt with identical evidence', () => {
    expect(compareDashboardSnapshots(
      snapshot(),
      snapshot({ generatedAt: '2026-07-19T10:00:02.000Z' }),
    )).toBe('unchanged');
  });

  it('accepts same-count lifecycle changes and newer evidence', () => {
    expect(compareDashboardSnapshots(snapshot(), snapshot({ state: 'ended' }))).toBe('changed');
    expect(compareDashboardSnapshots(snapshot(), snapshot({ requests: 2, eventCount: 2 }))).toBe('changed');
  });

  it('rejects regressive and out-of-order snapshots', () => {
    expect(compareDashboardSnapshots(snapshot({ eventCount: 2 }), snapshot())).toBe('rejected');
    expect(compareDashboardSnapshots(
      snapshot({ generatedAt: '2026-07-19T10:00:02.000Z' }),
      snapshot({ generatedAt: '2026-07-19T09:59:59.000Z', state: 'ended' }),
    )).toBe('rejected');
  });
});