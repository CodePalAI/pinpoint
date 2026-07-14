/**
 * headroom sidecar lifecycle (planning/end_product.md §10 #4).
 *
 * pinpoint talks to headroom only through its stateless, loopback-only seam
 * (`/v1/compress`, `/v1/retrieve*`). This manager finds a running sidecar or spawns
 * `headroom proxy` as a managed child, health-checks it, and — crucially — degrades
 * to "unavailable" (semantic stage becomes a no-op) rather than failing closed when
 * headroom is not installed.
 *
 * The spawned sidecar needs no upstream API keys: `/v1/compress` never calls the
 * provider. Headroom may still download optional local model assets on first use.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { SemanticConfig } from '../config.js';
import type { Logger } from '../logger.js';

export type SidecarState = 'unknown' | 'external' | 'spawned' | 'unavailable';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MANAGED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'PYTHONHOME',
  'PYTHONPATH',
  'DYLD_LIBRARY_PATH',
  'LD_LIBRARY_PATH',
  'ORT_DYLIB_PATH',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'HF_HOME',
  'HUGGINGFACE_HUB_CACHE',
  'TRANSFORMERS_CACHE',
  'TOKENIZERS_PARALLELISM',
  'OMP_NUM_THREADS',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
  'ComSpec',
] as const;

/** Minimal environment for a keyless, process-local managed compression sidecar. */
export function managedSidecarEnvironment(
  port: number,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of MANAGED_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return {
    ...env,
    HEADROOM_HOST: '127.0.0.1',
    HEADROOM_PORT: String(port),
    HEADROOM_WORKERS: '1',
    HEADROOM_MODE: 'cache',
    HEADROOM_STATELESS: 'true',
    HEADROOM_CCR_BACKEND: 'memory',
    HEADROOM_TELEMETRY: 'off',
    HEADROOM_UPDATE_CHECK: 'off',
  };
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      resolve(value);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, 500)) return;
  child.kill('SIGKILL');
  await waitForExit(child, 500);
}

export class HeadroomSidecar {
  private child?: ChildProcess;
  private state: SidecarState = 'unknown';
  private baseUrl: string;
  private checked = false;
  private startup?: Promise<boolean>;

  constructor(
    private readonly cfg: SemanticConfig,
    private readonly log: Logger,
  ) {
    this.baseUrl = cfg.sidecarUrl.replace(/\/+$/, '');
  }

  /** Current resolved base URL of the sidecar (may change after a spawn). */
  get url(): string {
    return this.baseUrl;
  }

  get status(): SidecarState {
    return this.state;
  }

  /** True once a health probe (or spawn) has confirmed reachability. */
  get available(): boolean {
    return this.state === 'external' || this.state === 'spawned';
  }

  /**
   * Ensure a healthy sidecar is reachable. Idempotent: the first successful check
   * is cached. Returns `false` (and sets state `unavailable`) instead of throwing
   * when headroom cannot be reached or spawned.
   */
  async ensureHealthy(): Promise<boolean> {
    if (this.checked && this.state !== 'unknown') return this.available;
    if (this.startup) return this.startup;

    this.startup = this.resolveHealth();
    try {
      return await this.startup;
    } finally {
      this.startup = undefined;
    }
  }

  private async resolveHealth(): Promise<boolean> {
    if (await this.ping(this.baseUrl, this.cfg.healthTimeoutMs)) {
      this.state = 'external';
      this.checked = true;
      this.log.info(`sidecar reachable (external) at ${this.baseUrl}`);
      return true;
    }

    if (!this.cfg.autoSpawn) {
      this.state = 'unavailable';
      this.checked = true;
      this.log.warn(`sidecar not reachable at ${this.baseUrl} and autoSpawn=off — semantic stage degraded`);
      return false;
    }

    const ok = await this.trySpawn();
    this.state = ok ? 'spawned' : 'unavailable';
    this.checked = true;
    if (!ok) {
      this.log.warn('could not start headroom sidecar — semantic stage degraded (optical stays on)');
    }
    return ok;
  }

  private async ping(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Spawn a headroom proxy on the configured port. Tries the `headroom` CLI first,
   * then falls back to `python3 -m headroom.proxy.server`. Polls /health until ready
   * or the child errors/exits or the timeout elapses.
   */
  private async trySpawn(): Promise<boolean> {
    const port = this.cfg.sidecarPort;
    const spawnUrl = `http://127.0.0.1:${port}`;
    const attempts: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'headroom', args: ['proxy', '--host', '127.0.0.1', '--port', String(port)] },
      {
        cmd: 'python3',
        args: ['-m', 'headroom.proxy.server', '--host', '127.0.0.1', '--port', String(port)],
      },
    ];

    for (const attempt of attempts) {
      this.log.info(`spawning headroom sidecar: ${attempt.cmd} ${attempt.args.join(' ')}`);
      const child = spawn(attempt.cmd, attempt.args, {
        env: managedSidecarEnvironment(port),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let failed = false;
      child.once('error', (err) => {
        failed = true;
        this.log.debug(`sidecar spawn error (${attempt.cmd}): ${err.message}`);
      });
      child.once('exit', (code) => {
        if (!this.available) failed = true;
        this.log.debug(`sidecar (${attempt.cmd}) exited with code ${code}`);
      });
      child.stderr?.on('data', (d: Buffer) => this.log.debug(`[headroom] ${d.toString().trimEnd()}`));

      const deadline = Date.now() + this.cfg.spawnReadyTimeoutMs;
      while (Date.now() < deadline && !failed) {
        if (await this.ping(spawnUrl, this.cfg.healthTimeoutMs)) {
          this.child = child;
          this.baseUrl = spawnUrl;
          this.log.info(`headroom sidecar healthy at ${spawnUrl}`);
          return true;
        }
        await sleep(300);
      }

      // This attempt didn't come up; clean it up and try the next command.
      await terminateChild(child);
      if (failed) continue;
    }
    return false;
  }

  /** Stop a managed child sidecar (no-op for an external one). */
  async stop(): Promise<void> {
    if (this.child) await terminateChild(this.child);
    this.child = undefined;
  }
}
