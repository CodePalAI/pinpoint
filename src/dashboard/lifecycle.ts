import type { DashboardJournal } from './journal.js';
import type { DashboardServer } from './server.js';

export const DASHBOARD_SESSION_SAVED_MESSAGE =
  'pinpoint dashboard: session saved to local history; reopen it with `pinpoint dashboard`.';

export async function closeDashboardSession(
  journal: Pick<DashboardJournal, 'close'> | undefined,
  server: Pick<DashboardServer, 'close'> | undefined,
  announce = true,
  write: (message: string) => void = console.error,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    journal?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await server?.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'dashboard session shutdown failed');
  if (announce && server) write(DASHBOARD_SESSION_SAVED_MESSAGE);
}
