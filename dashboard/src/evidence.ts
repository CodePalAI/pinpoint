import type {
  DashboardEvent,
  DashboardTokenLane,
} from '../../src/dashboard/types.js';

export function isIdleHeadroomSample(
  event: DashboardEvent,
): boolean {
  return event.type === 'headroom.sample' &&
    event.requests.value === 0 &&
    event.tokensText.value === 0 &&
    event.tokensSent.value === 0 &&
    event.outputTokens.value === 0 &&
    event.tokensSaved.value === 0 &&
    (event.costSaved?.value ?? 0) === 0;
}

export function selectVisibleEvidenceEvents(
  events: readonly DashboardEvent[],
): readonly DashboardEvent[] {
  const hasHeadroomUsage = events.some(
    (event) => event.type === 'headroom.sample' && !isIdleHeadroomSample(event),
  );
  const latestHealthyIdleIndex = hasHeadroomUsage
    ? -1
    : events.findLastIndex(
      (event) => event.type === 'headroom.sample' && isIdleHeadroomSample(event) && event.healthy,
    );
  const latestHeadroomActivity = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.type !== 'headroom.sample' || isIdleHeadroomSample(event)) return;
    latestHeadroomActivity.set(JSON.stringify([
      event.requests.value,
      event.tokensText.value,
      event.tokensSent.value,
      event.outputTokens.value,
      event.tokensSaved.value,
      event.costSaved?.value ?? null,
    ]), index);
  });

  return events.filter((event, index) => {
    if (isIdleHeadroomSample(event)) return index === latestHealthyIdleIndex;
    if (event.type !== 'headroom.sample') return true;
    const signature = JSON.stringify([
      event.requests.value,
      event.tokensText.value,
      event.tokensSent.value,
      event.outputTokens.value,
      event.tokensSaved.value,
      event.costSaved?.value ?? null,
    ]);
    return latestHeadroomActivity.get(signature) === index;
  });
}

export function selectVisibleTokenLanes(
  lanes: readonly DashboardTokenLane[],
): readonly DashboardTokenLane[] {
  return lanes.filter((lane) => lane.source !== 'headroom' ||
    lane.tokensText !== 0 ||
    lane.tokensSent !== 0 ||
    lane.tokensSaved !== 0 ||
    lane.appliedStages !== 0);
}