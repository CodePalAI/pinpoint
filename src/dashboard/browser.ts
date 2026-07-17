import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface DashboardOpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export type DashboardSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export function dashboardOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): DashboardOpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export function openDashboardInBrowser(
  url: string,
  spawnProcess: DashboardSpawn = spawn,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const open = dashboardOpenCommand(url, platform);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(open.command, open.args, { detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once('spawn', () => {
      child.unref();
      finish(true);
    });
    child.once('error', () => finish(false));
  });
}