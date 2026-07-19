import { describe, expect, it } from 'vitest';

import {
  closeDashboardSession,
  DASHBOARD_SESSION_SAVED_MESSAGE,
} from '../src/dashboard/lifecycle.js';

describe('dashboard lifecycle', () => {
  it('closes the journal before the server and announces durable history', async () => {
    const calls: string[] = [];
    await closeDashboardSession(
      { close: () => { calls.push('journal'); } },
      { close: async () => { calls.push('server'); } },
      true,
      (message) => { calls.push(message); },
    );

    expect(calls).toEqual(['journal', 'server', DASHBOARD_SESSION_SAVED_MESSAGE]);
  });

  it('does not announce start-up cleanup or sessions without a dashboard server', async () => {
    const messages: string[] = [];
    await closeDashboardSession(
      { close: () => undefined },
      { close: async () => undefined },
      false,
      (message) => { messages.push(message); },
    );
    await closeDashboardSession(
      { close: () => undefined },
      undefined,
      true,
      (message) => { messages.push(message); },
    );
    expect(messages).toEqual([]);
  });

  it('still closes the server and suppresses the saved claim when journaling fails', async () => {
    const calls: string[] = [];
    const journalError = new Error('journal failed');

    await expect(closeDashboardSession(
      { close: () => { calls.push('journal'); throw journalError; } },
      { close: async () => { calls.push('server'); } },
      true,
      (message) => { calls.push(message); },
    )).rejects.toBe(journalError);

    expect(calls).toEqual(['journal', 'server']);
  });
});
