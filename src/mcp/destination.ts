import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { McpCallToolResult } from './gateway.js';
import { readBoundedNdjson } from './ndjson.js';
import { isValidMcpCallToolResult } from './tool-result.js';

export interface McpDestinationStdioConfig {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly declaredEnvNames?: readonly string[];
  readonly sharedEnvNames?: readonly string[];
  readonly initializeTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly shutdownGraceMs?: number;
}

export interface McpOpaqueFlowDestinationConfig {
  readonly version: 1;
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly envAllowlist: readonly string[];
  readonly sharedEnvAllowlist: readonly string[];
  readonly initializeTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly shutdownGraceMs: number;
}

export type McpDestinationState =
  | 'spawned'
  | 'initializing'
  | 'cataloging'
  | 'ready'
  | 'closing'
  | 'closed'
  | 'failed';

interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseRpc(line: string): JsonRpcMessage | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) && value.jsonrpc === '2.0'
      ? value as unknown as JsonRpcMessage
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 100 || value > 300_000) {
    throw new TypeError('destination timeouts must be integers from 100 to 300000 milliseconds');
  }
  return value;
}

function environmentNameKey(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? name.toUpperCase() : name;
}

export const PINPOINT_RESERVED_CHILD_ENV_NAMES = [
  'PINPOINT_DASHBOARD_GROUP',
  'PINPOINT_DASHBOARD_DIR',
] as const;

export function destinationEnvironmentNames(
  config: Pick<McpDestinationStdioConfig, 'declaredEnvNames' | 'env'>,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  const names = [...(config.declaredEnvNames ?? []), ...Object.keys(config.env ?? {})];
  const byKey = new Map<string, string>();
  for (const name of names) byKey.set(environmentNameKey(name, platform), name);
  return [...byKey.values()].sort();
}

export function withoutDestinationOnlyEnvironment(
  sourceEnv: NodeJS.ProcessEnv,
  destinationNames: readonly string[],
  sharedNames: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const destination = new Set(destinationNames.map((name) => environmentNameKey(name, platform)));
  const shared = new Set(sharedNames.map((name) => environmentNameKey(name, platform)));
  const reserved = new Set(
    PINPOINT_RESERVED_CHILD_ENV_NAMES.map((name) => environmentNameKey(name, platform)),
  );
  return Object.fromEntries(Object.entries(sourceEnv).filter(([name]) => {
    const key = environmentNameKey(name, platform);
    if (reserved.has(key)) return false;
    return !destination.has(key) || shared.has(key);
  }));
}

export function parseMcpOpaqueFlowDestinationConfig(
  value: unknown,
  sourceEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): McpOpaqueFlowDestinationConfig & McpDestinationStdioConfig {
  if (!isRecord(value)) throw new TypeError('opaque-flow destination config must be a JSON object');
  const allowedKeys = new Set([
    '$schema',
    'version',
    'id',
    'command',
    'args',
    'cwd',
    'envAllowlist',
    'sharedEnvAllowlist',
    'initializeTimeoutMs',
    'requestTimeoutMs',
    'shutdownGraceMs',
  ]);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`unknown opaque-flow destination config field: ${unknownKeys.join(', ')}`);
  }
  if (value.$schema != null && (typeof value.$schema !== 'string' || value.$schema.length > 4096)) {
    throw new TypeError('opaque-flow destination $schema must be a string of at most 4096 characters');
  }
  if (value.version !== 1) throw new TypeError('opaque-flow destination config version must be 1');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.id)) {
    throw new TypeError(`invalid opaque-flow destination id: ${String(value.id)}`);
  }
  if (typeof value.command !== 'string' || value.command.length === 0 || value.command.length > 4096) {
    throw new TypeError('opaque-flow destination command must be a non-empty string of at most 4096 characters');
  }
  const args = value.args ?? [];
  if (
    !Array.isArray(args) ||
    args.length > 128 ||
    args.some((argument) => typeof argument !== 'string' || argument.length > 4096)
  ) {
    throw new TypeError('opaque-flow destination args must contain at most 128 strings of at most 4096 characters');
  }
  if (value.cwd != null && (typeof value.cwd !== 'string' || value.cwd.length === 0 || value.cwd.length > 4096)) {
    throw new TypeError('opaque-flow destination cwd must be a non-empty string of at most 4096 characters');
  }
  const envAllowlist = value.envAllowlist ?? [];
  const envNameKeys = Array.isArray(envAllowlist)
    ? envAllowlist.filter((name): name is string => typeof name === 'string')
      .map((name) => environmentNameKey(name, platform))
    : [];
  if (
    !Array.isArray(envAllowlist) ||
    envAllowlist.length > 64 ||
    new Set(envNameKeys).size !== envAllowlist.length ||
    envAllowlist.some((name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))
  ) {
    throw new TypeError('opaque-flow destination envAllowlist must contain at most 64 unique environment names');
  }
  const reservedEnvNameKeys = new Set(
    PINPOINT_RESERVED_CHILD_ENV_NAMES.map((name) => environmentNameKey(name, platform)),
  );
  if (envNameKeys.some((name) => reservedEnvNameKeys.has(name))) {
    throw new TypeError('opaque-flow destination envAllowlist contains a reserved Pinpoint environment name');
  }
  const sharedEnvAllowlist = value.sharedEnvAllowlist ?? [];
  const allowedEnvNameKeys = new Set(envNameKeys);
  const sharedEnvNameKeys = Array.isArray(sharedEnvAllowlist)
    ? sharedEnvAllowlist.filter((name): name is string => typeof name === 'string')
      .map((name) => environmentNameKey(name, platform))
    : [];
  if (
    !Array.isArray(sharedEnvAllowlist) ||
    sharedEnvAllowlist.length > 64 ||
    new Set(sharedEnvNameKeys).size !== sharedEnvAllowlist.length ||
    sharedEnvAllowlist.some((name) =>
      typeof name !== 'string' || !allowedEnvNameKeys.has(environmentNameKey(name, platform)))
  ) {
    throw new TypeError('opaque-flow destination sharedEnvAllowlist must be a unique subset of envAllowlist');
  }
  const initializeTimeoutMs = positiveTimeout(
    value.initializeTimeoutMs as number | undefined,
    10_000,
  );
  const requestTimeoutMs = positiveTimeout(value.requestTimeoutMs as number | undefined, 30_000);
  const shutdownGraceMs = positiveTimeout(value.shutdownGraceMs as number | undefined, 2_000);
  const sourceEntries = Object.entries(sourceEnv);
  const env = Object.fromEntries((envAllowlist as string[]).flatMap((name) => {
    const key = environmentNameKey(name, platform);
    const matches = sourceEntries.filter(([sourceName]) => environmentNameKey(sourceName, platform) === key);
    if (matches.length > 1) throw new TypeError(`ambiguous inherited environment name: ${name}`);
    return matches[0]?.[1] == null ? [] : [[name, matches[0][1]]];
  }));
  return {
    version: 1,
    id: value.id,
    command: value.command,
    args: [...args] as string[],
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    envAllowlist: [...envAllowlist] as string[],
    sharedEnvAllowlist: [...sharedEnvAllowlist] as string[],
    env,
    declaredEnvNames: [...envAllowlist] as string[],
    sharedEnvNames: [...sharedEnvAllowlist] as string[],
    initializeTimeoutMs,
    requestTimeoutMs,
    shutdownGraceMs,
  };
}

export class McpDestinationPeer {
  private readonly child;
  private readonly lines;
  private readonly sessionId = randomUUID();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly initializeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly shutdownGraceMs: number;
  private requestSequence = 0;
  private currentState: McpDestinationState = 'spawned';
  private diagnosticEmitted = false;
  private failureNotified = false;
  private closeExpected = false;
  private closePromise?: Promise<number | null>;
  private readonly exited: Promise<number | null>;

  constructor(
    readonly config: McpDestinationStdioConfig,
    private readonly onDiagnostic: (message: string) => void = () => {},
    private readonly onFailure: () => void = () => {},
  ) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(config.id)) {
      throw new TypeError(`invalid destination id: ${config.id}`);
    }
    if (typeof config.command !== 'string' || config.command.trim().length === 0) {
      throw new TypeError('destination command is required');
    }
    if (
      config.args != null &&
      (
        !Array.isArray(config.args) ||
        config.args.length > 128 ||
        config.args.some((argument) => typeof argument !== 'string' || argument.length > 4096)
      )
    ) {
      throw new TypeError('destination args must contain at most 128 strings of at most 4096 characters');
    }
    const effectiveEnvNames = destinationEnvironmentNames(config);
    const reserved = new Set(PINPOINT_RESERVED_CHILD_ENV_NAMES.map((name) => environmentNameKey(name, process.platform)));
    if (effectiveEnvNames.some((name) =>
      reserved.has(environmentNameKey(name, process.platform)))) {
      throw new TypeError('destination environment contains a reserved Pinpoint environment name');
    }
    this.initializeTimeoutMs = positiveTimeout(config.initializeTimeoutMs, 10_000);
    this.requestTimeoutMs = positiveTimeout(config.requestTimeoutMs, 30_000);
    this.shutdownGraceMs = positiveTimeout(config.shutdownGraceMs, 2_000);
    this.child = spawn(config.command, [...(config.args ?? [])], {
      cwd: config.cwd,
      env: config.env ?? {},
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.lines = readBoundedNdjson(this.child.stdout, {
      onLine: (line) => this.handleLine(line),
      onOverflow: () => this.fail('destination output exceeded the JSON-RPC frame limit'),
      onInvalidEncoding: () => this.fail('destination output is not valid UTF-8'),
    });
    this.child.stderr.on('data', () => this.diagnostic('destination stderr suppressed'));
    this.child.stdin.on('error', () => {
      if (this.closeExpected || this.pending.size === 0) return;
      this.fail('destination input failed');
    });
    this.child.once('error', () => this.fail('destination process failed'));
    this.exited = new Promise((resolve) => {
      this.child.once('close', (code) => {
        this.lines.close();
        const hadPending = this.pending.size > 0;
        if ((!this.closeExpected || hadPending) && this.currentState !== 'failed') {
          this.currentState = 'failed';
          this.rejectPending('destination process exited');
          this.diagnostic('destination process exited');
          this.notifyFailure();
        } else if (this.currentState !== 'failed') {
          this.currentState = 'closed';
          this.rejectPending('destination process closed');
        }
        resolve(code);
      });
    });
  }

  get state(): McpDestinationState {
    return this.currentState;
  }

  get hasPendingRequests(): boolean {
    return this.pending.size > 0;
  }

  private diagnostic(message: string): void {
    if (this.diagnosticEmitted) return;
    this.diagnosticEmitted = true;
    this.onDiagnostic(`[pinpoint mcp gateway] ${message}\n`);
  }

  private rejectPending(message: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }

  private notifyFailure(): void {
    if (this.failureNotified) return;
    this.failureNotified = true;
    this.onFailure();
  }

  private fail(message: string): void {
    if (this.currentState === 'failed' || this.currentState === 'closed') return;
    this.currentState = 'failed';
    this.rejectPending(message);
    this.diagnostic(message);
    this.notifyFailure();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
  }

  private handleLine(line: string): void {
    if (this.currentState === 'failed' || this.currentState === 'closed') return;
    const message = parseRpc(line.trim());
    if (!message) {
      this.diagnostic('suppressed invalid destination output');
      return;
    }
    if (message.method) {
      if (message.method === 'notifications/tools/list_changed' && this.currentState === 'ready') {
        this.fail('destination tool catalog changed');
        return;
      }
      if (message.id !== undefined) {
        this.child.stdin.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'server requests are disabled' },
        })}\n`);
      }
      return;
    }
    if (message.id === undefined) return;
    if (typeof message.id !== 'string') {
      this.fail('destination returned an unknown response');
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) {
      this.fail('destination returned an unknown response');
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error != null) request.reject(new Error('destination returned a JSON-RPC error'));
    else request.resolve(message.result);
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.currentState === 'failed' || this.currentState === 'closing' || this.currentState === 'closed') {
      return Promise.reject(new Error('destination is unavailable'));
    }
    const id = `pinpoint-destination:${this.sessionId}:${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        request.reject(new Error('destination request timed out'));
        this.fail('destination request timed out');
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (cause) => {
        if (!cause) return;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        request.reject(new Error('destination request write failed'));
        this.fail('destination request write failed');
      });
    });
  }

  async initialize(protocolVersion: string): Promise<ReadonlySet<string>> {
    if (this.currentState !== 'spawned') throw new Error('destination has already been initialized');
    if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
      throw new TypeError('destination protocol version is required');
    }
    this.currentState = 'initializing';
    let initialized: unknown;
    try {
      initialized = await this.request('initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'pinpoint-gateway', version: '0.1.1' },
      }, this.initializeTimeoutMs);
    } catch {
      this.fail('destination initialization failed');
      throw new Error('destination initialization failed');
    }
    if (
      !isRecord(initialized) ||
      initialized.protocolVersion !== protocolVersion ||
      !isRecord(initialized.capabilities) ||
      !isRecord(initialized.capabilities.tools)
    ) {
      this.fail('destination returned an invalid initialize result');
      throw new Error('destination initialization failed');
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    this.currentState = 'cataloging';
    let catalog: unknown;
    try {
      catalog = await this.request('tools/list', {}, this.initializeTimeoutMs);
    } catch {
      this.fail('destination catalog validation failed');
      throw new Error('destination catalog validation failed');
    }
    if (!isRecord(catalog) || !Array.isArray(catalog.tools) || catalog.nextCursor != null) {
      this.fail('destination returned an invalid or paginated tool catalog');
      throw new Error('destination catalog validation failed');
    }
    const names = catalog.tools.map((tool) => isRecord(tool) ? tool.name : undefined);
    if (
      names.some((name) => typeof name !== 'string' || name.length === 0) ||
      new Set(names).size !== names.length
    ) {
      this.fail('destination returned an invalid tool catalog');
      throw new Error('destination catalog validation failed');
    }
    this.currentState = 'ready';
    return new Set(names as string[]);
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpCallToolResult> {
    if (this.currentState !== 'ready') throw new Error('destination is not ready');
    const result = await this.request('tools/call', { name, arguments: args }, this.requestTimeoutMs);
    if (!isValidMcpCallToolResult(result)) {
      this.fail('destination returned an invalid MCP tool result');
      throw new Error('destination returned an invalid MCP tool result');
    }
    return result as unknown as McpCallToolResult;
  }

  close(): Promise<number | null> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<number | null> {
    if (this.currentState === 'closed') return this.exited;
    if (this.currentState !== 'failed') this.currentState = 'closing';
    this.closeExpected = true;
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.shutdownGraceMs);
    });
    const first = await Promise.race([this.exited, timedOut]);
    if (timer) clearTimeout(timer);
    if (first === 'timeout' && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      let killTimer: NodeJS.Timeout | undefined;
      const force = new Promise<'force'>((resolve) => {
        killTimer = setTimeout(() => resolve('force'), this.shutdownGraceMs);
      });
      const second = await Promise.race([this.exited, force]);
      if (killTimer) clearTimeout(killTimer);
      if (second === 'force' && this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill('SIGKILL');
      }
    }
    return this.exited;
  }
}