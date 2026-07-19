import { describe, expect, it } from 'vitest';

import {
  isIdleHeadroomSample,
  selectVisibleEvidenceEvents,
  selectVisibleTokenLanes,
} from '../dashboard/src/evidence.js';
import {
  DASHBOARD_SCHEMA_VERSION,
  type DashboardEvent,
  type DashboardHeadroomSampleEvent,
  type DashboardMetricUnit,
  type DashboardMetricValue,
} from '../src/dashboard/types.js';

function metric(value: number, unit: DashboardMetricUnit): DashboardMetricValue {
  return {
    value,
    unit,
    source: 'headroom',
    basis: 'provider-reported',
    scope: 'session',
  };
}

function headroomSample(
  occurredAt: string,
  overrides: Partial<DashboardHeadroomSampleEvent> = {},
): DashboardHeadroomSampleEvent {
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    type: 'headroom.sample',
    source: 'headroom',
    occurredAt,
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
    ...overrides,
  };
}

describe('dashboard evidence visibility', () => {
  it('collapses metadata-only duplicates but keeps each cumulative request update', () => {
    const first = headroomSample('2026-07-17T22:24:01.000Z', {
      model: 'gpt-4o',
      requests: metric(1, 'requests'),
      tokensText: metric(1_000, 'tokens'),
      tokensSent: metric(1_000, 'tokens'),
      outputTokens: metric(10, 'tokens'),
    });
    const duplicate = headroomSample('2026-07-17T22:24:02.000Z', {
      ...first,
      occurredAt: '2026-07-17T22:24:02.000Z',
    });
    const second = headroomSample('2026-07-17T22:24:03.000Z', {
      model: 'gpt-4o',
      requests: metric(2, 'requests'),
      tokensText: metric(2_100, 'tokens'),
      tokensSent: metric(2_100, 'tokens'),
      outputTokens: metric(20, 'tokens'),
    });

    expect(selectVisibleEvidenceEvents([first, duplicate, second])).toEqual([duplicate, second]);
  });

  it('hides only legacy all-zero Headroom calibration lanes', () => {
    const idleHeadroom = {
      source: 'headroom' as const,
      basis: 'provider-reported' as const,
      tokensText: 0,
      tokensSent: 0,
      tokensSaved: 0,
      appliedStages: 0,
    };
    const usedHeadroom = { ...idleHeadroom, tokensSent: 1 };
    const zeroPinpoint = {
      ...idleHeadroom,
      source: 'pinpoint' as const,
      basis: 'estimate' as const,
    };

    expect(selectVisibleTokenLanes([idleHeadroom, usedHeadroom, zeroPinpoint]))
      .toEqual([usedHeadroom, zeroPinpoint]);
  });

  it('collapses startup polling into the latest healthy connection state', () => {
    const unavailable = headroomSample('2026-07-17T22:23:51.291Z', {
      healthy: false,
      coverage: 'unavailable',
      version: null,
    });
    const attached = headroomSample('2026-07-17T22:23:56.571Z');

    expect(selectVisibleEvidenceEvents([unavailable, attached])).toEqual([attached]);
  });

  it('replaces startup states with the first real usage sample', () => {
    const attached = headroomSample('2026-07-17T22:23:56.571Z');
    const usage = headroomSample('2026-07-17T22:24:01.000Z', {
      model: 'gpt-4o',
      requests: metric(1, 'requests'),
      tokensText: metric(1_000, 'tokens'),
      tokensSent: metric(800, 'tokens'),
      outputTokens: metric(50, 'tokens'),
      tokensSaved: metric(200, 'tokens'),
    });

    expect(selectVisibleEvidenceEvents([attached, usage])).toEqual([usage]);
  });

  it('does not hide counter-only usage or non-Headroom evidence', () => {
    const counterOnly = headroomSample('2026-07-17T22:24:01.000Z', {
      tokensSent: metric(1, 'tokens'),
    });
    const lifecycle: DashboardEvent = {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      type: 'mcp.lifecycle',
      source: 'mcp',
      occurredAt: '2026-07-17T22:24:02.000Z',
      state: 'started',
      flowsConfigured: 0,
      privateDestination: false,
    };

    expect(isIdleHeadroomSample(counterOnly)).toBe(false);
    expect(selectVisibleEvidenceEvents([counterOnly, lifecycle])).toEqual([counterOnly, lifecycle]);
  });
});