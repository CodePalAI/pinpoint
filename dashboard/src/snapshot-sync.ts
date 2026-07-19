import type { DashboardSnapshot } from '../../src/dashboard/types.js';

function snapshotRevision(snapshot: DashboardSnapshot): string {
  return JSON.stringify({
    groupId: snapshot.groupId,
    state: snapshot.state,
    requests: snapshot.requests,
    eventCount: snapshot.eventCount,
    negativeSavingsRoutes: snapshot.negativeSavingsRoutes,
    reversibleCount: snapshot.reversibleCount,
    corruptRecords: snapshot.corruptRecords,
    tokenLanes: snapshot.tokenLanes,
    byteLanes: snapshot.byteLanes,
    mcp: snapshot.mcp,
    headroom: snapshot.headroom,
    sources: snapshot.sources,
    latestEvent: snapshot.recentEvents.at(-1) ?? null,
  });
}

export function compareDashboardSnapshots(
  current: DashboardSnapshot | null,
  incoming: DashboardSnapshot,
): 'changed' | 'unchanged' | 'rejected' {
  if (current == null || current.groupId !== incoming.groupId) return 'changed';
  if (incoming.eventCount < current.eventCount) return 'rejected';
  if (snapshotRevision(current) === snapshotRevision(incoming)) return 'unchanged';
  if (
    incoming.eventCount === current.eventCount &&
    Date.parse(incoming.generatedAt) < Date.parse(current.generatedAt)
  ) return 'rejected';
  return 'changed';
}