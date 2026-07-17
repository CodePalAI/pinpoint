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

import { DashboardJournal, readDashboardGroup } from '../src/dashboard/journal.js';
import type { DashboardProviderRouteEvent } from '../src/dashboard/types.js';

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

describe('DashboardJournal', () => {
  it('persists only validated metadata in private producer files', () => {
    const historyRoot = root();
    const journal = new DashboardJournal({ rootDir: historyRoot, source: 'pinpoint' });
    journal.onEvent(routeEvent());
    journal.close();

    expect(statSync(historyRoot).mode & 0o777).toBe(0o700);
    expect(statSync(journal.groupDir).mode & 0o777).toBe(0o700);
    const statePath = join(journal.groupDir, `${journal.producerId}.state.json`);
    const eventPath = join(journal.groupDir, `${journal.producerId}.events.jsonl`);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect(statSync(eventPath).mode & 0o777).toBe(0o600);

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
});