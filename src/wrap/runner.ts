/**
 * `pinpoint wrap` runner (planning/end_product.md §6).
 *
 * Dispatches each agent to the right composition:
 *   - launch:   start the pinpoint proxy, point the agent at it, spawn it.
 *   - print:    start the proxy and print IDE config (Cursor/Cline/Continue).
 *   - delegate: hand copilot to the headroom backbone (its subscription-OAuth
 *               transport is headroom's; pinpoint's lossy optical can't help
 *               copilot's models). pinpoint adds preflight + a unified CLI.
 *
 * Ephemeral: only the launched child's env is set — no config files are mutated.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { LogLevel } from '../config.js';
import { createProxyServer, type ProxyServer } from '../proxy/server.js';
import { openDashboardInBrowser } from '../dashboard/browser.js';
import { HeadroomDashboardAdapter } from '../dashboard/headroom.js';
import {
  dashboardRootFromEnvironment,
  DashboardJournal,
} from '../dashboard/journal.js';
import {
  createDashboardServer,
  DEFAULT_DASHBOARD_PORT,
  type DashboardServer,
} from '../dashboard/server.js';
import {
  BUILTIN_AGENT_REGISTRY,
  knownAgents,
  type AgentRegistry,
  type LaunchAgent,
  type PrintAgent,
} from './agents.js';

export interface WrapOptions {
  readonly agent: string;
  /** Args forwarded to the wrapped agent (everything after `--`). */
  readonly passthrough: string[];
  /** copilot only: use BYOK (API key) instead of the default subscription. */
  readonly byok?: boolean;
  /** copilot only: enable headroom's RTK context tool (writes repo files). Off by default (ephemeral). */
  readonly contextTool?: boolean;
  readonly port?: number;
  readonly verbose?: boolean;
  readonly dashboard?: {
    readonly port?: number;
    readonly open: boolean;
  };
  /** Custom adapter registry for embedders; built-ins by default. */
  readonly registry?: AgentRegistry;
}

/** Run `pinpoint wrap`. Resolves to the process exit code. Never throws. */
export async function runWrap(opts: WrapOptions): Promise<number> {
  const registry = opts.registry ?? BUILTIN_AGENT_REGISTRY;
  const spec = registry.get(opts.agent)?.adapter;
  if (spec === undefined) {
    console.error(`unknown agent '${opts.agent}'. Supported: ${knownAgents(registry).join(', ')}.`);
    console.error("For any compatible client, run 'pinpoint proxy' and point its base URL at it.");
    return 1;
  }
  switch (spec.kind) {
    case 'launch':
      return runLaunch(spec, opts);
    case 'print':
      return runPrint(spec, opts);
    case 'delegate':
      return runDelegateCopilot(opts);
  }
}

function proxyOverrides(opts: WrapOptions): { port?: number; logLevel?: LogLevel } {
  const o: { port?: number; logLevel?: LogLevel } = {};
  if (opts.port) o.port = opts.port;
  if (opts.verbose) o.logLevel = 'debug';
  return o;
}

async function runLaunch(spec: LaunchAgent, opts: WrapOptions): Promise<number> {
  const dashboard = opts.dashboard ? await startDashboard('pinpoint', opts.dashboard) : undefined;
  const server = createProxyServer(proxyOverrides(opts), {
    ...(dashboard ? { runtime: { observer: dashboard.journal } } : {}),
  });
  try {
    const { host, port } = await server.listen();
    const baseUrl = `http://${host}:${port}`;
    const agentEnv = spec.env(baseUrl);
    server.pinpoint.log.info(`wrapping '${opts.agent}': ${Object.keys(agentEnv).join(', ')} → ${baseUrl}`);
    return await spawnAndWait(spec.command, opts.passthrough, {
      ...process.env,
      ...agentEnv,
      ...dashboardEnvironment(dashboard),
    });
  } catch (err) {
    console.error(`failed to launch ${spec.command}: ${err instanceof Error ? err.message : String(err)}`);
    return 127;
  } finally {
    await server.close();
    await stopDashboard(dashboard);
  }
}

async function runPrint(spec: PrintAgent, opts: WrapOptions): Promise<number> {
  const dashboard = opts.dashboard ? await startDashboard('pinpoint', opts.dashboard) : undefined;
  const server = createProxyServer(proxyOverrides(opts), {
    ...(dashboard ? { runtime: { observer: dashboard.journal } } : {}),
  });
  try {
    const { host, port } = await server.listen();
    const baseUrl = `http://${host}:${port}`;
    console.log(`\npinpoint proxy is running for ${spec.displayName} at ${baseUrl}\n`);
    console.log(spec.instructions(baseUrl));
    console.log('\nLeave this running; press Ctrl-C to stop.\n');
    return await waitForSignal(server);
  } finally {
    await server.close();
    await stopDashboard(dashboard);
  }
}

// ── Copilot delegation ─────────────────────────────────────────────────────

export interface CopilotPreflight {
  /** Resolved headroom binary, or null if not found. */
  readonly headroomBin: string | null;
  /** Resolved copilot CLI, or null if not found. */
  readonly copilotCli: string | null;
  /** true = a login token was found; false = not found; 'unknown' = can't probe here. */
  readonly tokenFound: boolean | 'unknown';
  /** Model that will be used if the user omits --model. */
  readonly model: string;
}

export function copilotPreflight(): CopilotPreflight {
  return {
    headroomBin: locateHeadroom(),
    copilotCli: which('copilot'),
    tokenFound: probeCopilotToken(),
    model: process.env.PINPOINT_COPILOT_MODEL || 'gpt-4o',
  };
}

async function runDelegateCopilot(opts: WrapOptions): Promise<number> {
  const pf = copilotPreflight();

  if (!pf.headroomBin) {
    console.error(
      'Copilot support delegates to the headroom backbone, but `headroom` was not found.\n' +
        '  Install it (pipx install headroom-ai / pip install headroom-ai) or set\n' +
        '  PINPOINT_HEADROOM_BIN to the binary (e.g. ~/repos-pinpoint/.headroom-venv/bin/headroom).',
    );
    return 1;
  }
  if (!pf.copilotCli) {
    console.error(
      'GitHub Copilot CLI not found on PATH.\n  Install it: npm install -g @github/copilot',
    );
    return 1;
  }

  const resolvedHeadroom = opts.dashboard
    ? await resolveHeadroomPort(opts.port ?? 8787)
    : { port: opts.port, attribution: 'shared' as const };
  const dashboard = opts.dashboard ? await startDashboard('headroom', opts.dashboard) : undefined;
  const adapter = dashboard && resolvedHeadroom.port != null
    ? new HeadroomDashboardAdapter({
        baseUrl: `http://127.0.0.1:${resolvedHeadroom.port}`,
        attribution: resolvedHeadroom.attribution,
        observer: dashboard.journal,
      })
    : undefined;
  const passthrough = ensureModel(opts.passthrough, pf.model);
  const args = ['wrap', 'copilot'];
  if (!opts.byok) args.push('--subscription');
  // Ephemeral by default: don't let headroom's RTK context tool write repo files
  // (.github/copilot-instructions.md). Opt in with `--context-tool`.
  if (!opts.contextTool) args.push('--no-context-tool');
  if (resolvedHeadroom.port) args.push('--port', String(resolvedHeadroom.port));
  if (opts.verbose) args.push('-v');
  args.push('--', ...passthrough);

  const mode = opts.byok ? 'BYOK' : 'subscription';
  console.error(
    `pinpoint wrap copilot → delegating to headroom (${mode}); model=${modelOf(passthrough)}; headroom=${pf.headroomBin}`,
  );
  console.error(
    opts.dashboard
      ? `  Copilot compression is Headroom-owned; Pinpoint reports ${resolvedHeadroom.attribution} attribution.`
      : "  Copilot compression runs via headroom's semantic engine; savings appear in headroom's dashboard.",
  );

  try {
    await adapter?.start();
    return await spawnAndWait(pf.headroomBin, args, {
      ...process.env,
      ...dashboardEnvironment(dashboard),
    });
  } catch (err) {
    console.error(`failed to launch headroom: ${err instanceof Error ? err.message : String(err)}`);
    return 127;
  } finally {
    await adapter?.stop();
    await stopDashboard(dashboard);
  }
}

interface RunningDashboard {
  readonly journal: DashboardJournal;
  readonly server: DashboardServer;
  readonly rootDir: string;
}

async function startDashboard(
  source: 'pinpoint' | 'headroom',
  options: NonNullable<WrapOptions['dashboard']>,
): Promise<RunningDashboard> {
  const rootDir = dashboardRootFromEnvironment();
  const journal = new DashboardJournal({ rootDir, source });
  const server = createDashboardServer({
    rootDir,
    groupId: journal.groupId,
    port: options.port ?? dashboardPortFromEnvironment(),
    strictPort: options.port != null,
  });
  try {
    const address = await server.listen();
    if (options.open && await openDashboardInBrowser(address.launchUrl)) {
      console.error(`pinpoint dashboard: ${address.url}`);
    } else {
      console.error(`pinpoint dashboard (protected URL): ${address.launchUrl}`);
    }
    return { journal, server, rootDir };
  } catch (error) {
    journal.close();
    await server.close();
    throw error;
  }
}

async function stopDashboard(dashboard: RunningDashboard | undefined): Promise<void> {
  if (!dashboard) return;
  dashboard.journal.close();
  await dashboard.server.close();
}

function dashboardEnvironment(dashboard: RunningDashboard | undefined): NodeJS.ProcessEnv {
  return dashboard ? {
    PINPOINT_DASHBOARD_GROUP: dashboard.journal.groupId,
    PINPOINT_DASHBOARD_DIR: dashboard.rootDir,
  } : {};
}

function dashboardPortFromEnvironment(): number {
  const value = Number(process.env.PINPOINT_DASHBOARD_PORT ?? DEFAULT_DASHBOARD_PORT);
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : DEFAULT_DASHBOARD_PORT;
}

async function resolveHeadroomPort(preferredPort: number): Promise<{
  readonly port: number;
  readonly attribution: 'dedicated' | 'shared';
}> {
  if (await isHeadroomProxy(preferredPort)) return { port: preferredPort, attribution: 'shared' };
  if (await canBind(preferredPort)) return { port: preferredPort, attribution: 'dedicated' };
  return { port: await availableLoopbackPort(), attribution: 'dedicated' };
}

async function isHeadroomProxy(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json() as { service?: unknown };
    return payload.service === 'headroom-proxy';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function bindTest(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address != null ? address.port : port;
      server.close((error) => error ? reject(error) : resolve(boundPort));
    });
  });
}

async function canBind(port: number): Promise<boolean> {
  try {
    await bindTest(port);
    return true;
  } catch {
    return false;
  }
}

function availableLoopbackPort(): Promise<number> {
  return bindTest(0);
}

// ── process helpers ─────────────────────────────────────────────────────────

/** Spawn a child with inherited stdio, forward signals, resolve with its exit code. */
function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, { stdio: 'inherit', env });
    const forward = (sig: NodeJS.Signals) => {
      if (!child.killed) child.kill(sig);
    };
    const onInt = () => forward('SIGINT');
    const onTerm = () => forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const cleanup = () => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    child.once('error', (err) => {
      cleanup();
      reject(err);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function waitForSignal(server: ProxyServer): Promise<number> {
  return new Promise<number>((resolve) => {
    const stop = () => {
      void server.close().then(() => resolve(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// ── discovery helpers ────────────────────────────────────────────────────────

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | null {
  const path = process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .map((extension) => extension.trim())
      .filter(Boolean)
    : [];
  const hasWindowsExtension = extensions.some((extension) =>
    cmd.toLowerCase().endsWith(extension.toLowerCase()));
  const candidates = process.platform === 'win32' && !hasWindowsExtension
    ? [cmd, ...extensions.map((extension) => `${cmd}${extension}`)]
    : [cmd];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

function locateHeadroom(): string | null {
  const explicit = process.env.PINPOINT_HEADROOM_BIN;
  if (explicit && isExecutable(explicit)) return explicit;
  const onPath = which('headroom');
  if (onPath) return onPath;
  for (const c of [
    join(homedir(), 'repos-pinpoint', '.headroom-venv', 'bin', 'headroom'),
    join(process.cwd(), '.headroom-venv', 'bin', 'headroom'),
    join(homedir(), '.headroom-venv', 'bin', 'headroom'),
  ]) {
    if (isExecutable(c)) return c;
  }
  return null;
}

function probeCopilotToken(): boolean | 'unknown' {
  // Only check the explicit env var. We deliberately do NOT shell out to the OS
  // secret store (e.g. macOS `security find-generic-password`): reading another
  // app's Keychain item can trigger a BLOCKING GUI permission prompt. headroom
  // performs the real Keychain discovery at launch, where a one-time prompt is
  // expected and the user is present to allow it.
  return process.env.GITHUB_COPILOT_TOKEN ? true : 'unknown';
}

function ensureModel(passthrough: string[], model: string): string[] {
  const hasModel =
    passthrough.includes('--model') || passthrough.some((a) => a.startsWith('--model='));
  return hasModel ? passthrough : ['--model', model, ...passthrough];
}

function modelOf(args: string[]): string {
  const i = args.indexOf('--model');
  if (i >= 0 && i + 1 < args.length) return args[i + 1] ?? '(default)';
  const eq = args.find((a) => a.startsWith('--model='));
  return eq ? eq.slice('--model='.length) : '(default)';
}
