import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DashboardJournal } from '../src/dashboard/journal.js';
import { createDashboardServer } from '../src/dashboard/server.js';
import {
  DASHBOARD_SCHEMA_VERSION,
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

function sample(requests: number, occurredAt: string): DashboardHeadroomSampleEvent {
  const before = requests === 1 ? 18_084 : 37_168;
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    type: 'headroom.sample',
    source: 'headroom',
    occurredAt,
    healthy: true,
    version: '0.31.0',
    attribution: 'dedicated',
    coverage: 'aggregate-fallback',
    model: 'gpt-4o',
    requests: metric(requests, 'requests'),
    tokensText: metric(before, 'tokens'),
    tokensSent: metric(before, 'tokens'),
    outputTokens: metric(requests * 6, 'tokens'),
    tokensSaved: metric(0, 'tokens'),
    costSaved: null,
    quota: [],
  };
}

test('dashboard stays live across subsequent requests, refresh, history, and disconnect', async ({ page }) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'pinpoint-dashboard-e2e-'));
  const journal = new DashboardJournal({ rootDir, source: 'headroom' });
  const server = createDashboardServer({
    rootDir,
    groupId: journal.groupId,
    assetsDir: join(process.cwd(), 'dist', 'dashboard', 'ui'),
    token: 'dashboard-e2e-token',
    port: 0,
    pollIntervalMs: 100,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    journal.onEvent(sample(1, '2026-07-19T10:00:00.000Z'));
    const address = await server.listen();
    await page.goto(address.launchUrl);

    await expect(page).toHaveURL(address.url);
    await expect(page.getByText('Copilot session reached 1 request')).toBeVisible();
    await expect(page.getByText('gpt-4o · dedicated session')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.length)).toBe(1);

    journal.onEvent(sample(2, '2026-07-19T10:00:01.000Z'));
    await expect(page.getByText('Copilot session reached 2 requests')).toBeVisible();
    await expect(page.getByText('37,168 → 37,168 input tokens')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Copilot session reached 2 requests')).toBeVisible();
    await expect(page.getByText('Access required')).toHaveCount(0);

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByRole('navigation', { name: 'Recorded sessions' })).toContainText('2');
    await expect(page.getByText('Copilot session reached 2 requests')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      const allowed = (element: Element): Element | null => element.closest(
        '.view-tabs, .table-wrap, .request-list, .session-index, .skip-link',
      );
      const offenders = [...document.querySelectorAll('main *, header *')].flatMap((element) => {
        if (allowed(element)) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || (rect.left >= -1 && rect.right <= innerWidth + 1)) return [];
        return [{
          tag: element.tagName.toLowerCase(),
          className: element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }];
      });
      return {
        body: document.documentElement.scrollWidth > innerWidth + 1,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        offenders,
      };
    });
    expect(overflow).toEqual({
      body: false,
      documentWidth: 390,
      viewportWidth: 390,
      offenders: [],
    });

    await server.close();
    await expect(page.getByText('Reconnecting')).toBeVisible();
    await expect(page.getByText('Copilot session reached 2 requests')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    journal.close();
    await server.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
});
