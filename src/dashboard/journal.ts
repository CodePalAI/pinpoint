import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DASHBOARD_SCHEMA_VERSION,
  normalizeDashboardEvent,
  type DashboardEvent,
  type DashboardHistorySession,
  type DashboardObserver,
  type DashboardSnapshot,
  type DashboardSource,
} from './types.js';

export const DEFAULT_DASHBOARD_ROOT = join(homedir(), '.pinpoint', 'dashboard');
export const DEFAULT_DASHBOARD_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const DEFAULT_DASHBOARD_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DASHBOARD_PRODUCER_BYTES = 4 * 1024 * 1024;

const IDENTIFIER_PATTERN = /^(?:dash|prod)_[a-f0-9]{32}$/;
const MAX_EVENT_BYTES = 64 * 1024;

export interface DashboardProducerState {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly producerId: string;
  readonly source: DashboardSource;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly endedAt: string | null;
  readonly eventCount: number;
}

export interface DashboardJournalOptions {
  readonly rootDir?: string;
  readonly groupId?: string;
  readonly producerId?: string;
  readonly source: DashboardSource;
  readonly now?: () => Date;
  readonly maxProducerBytes?: number;
  readonly retentionMs?: number;
  readonly maxTotalBytes?: number;
}

export interface DashboardGroupReadResult {
  readonly groupId: string;
  readonly producers: readonly DashboardProducerState[];
  readonly events: readonly DashboardEvent[];
  readonly corruptRecords: number;
}

export interface DashboardPruneResult {
  readonly removedGroups: number;
  readonly retainedBytes: number;
  readonly overBudget: boolean;
}

function randomIdentifier(prefix: 'dash' | 'prod'): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function validateIdentifier(value: string, prefix: 'dash' | 'prod'): string {
  if (!IDENTIFIER_PATTERN.test(value) || !value.startsWith(`${prefix}_`)) {
    throw new TypeError(`invalid dashboard ${prefix === 'dash' ? 'group' : 'producer'} id`);
  }
  return value;
}

export function createDashboardGroupId(): string {
  return randomIdentifier('dash');
}

export function createDashboardProducerId(): string {
  return randomIdentifier('prod');
}

export function dashboardRootFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PINPOINT_DASHBOARD_DIR?.trim();
  return configured || DEFAULT_DASHBOARD_ROOT;
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicPrivateJson(path: string, value: unknown): void {
  ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600);
  const descriptor = openSync(temporary, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  fsyncDirectory(dirname(path));
}

function appendPrivate(path: string, line: string): void {
  const descriptor = openSync(path, 'a', 0o600);
  try {
    chmodSync(path, 0o600);
    writeSync(descriptor, line);
  } finally {
    closeSync(descriptor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseProducerState(value: unknown): DashboardProducerState {
  if (!isRecord(value)) throw new TypeError('dashboard producer state must be an object');
  const keys = [
    'schemaVersion',
    'producerId',
    'source',
    'startedAt',
    'lastActivityAt',
    'endedAt',
    'eventCount',
  ];
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) {
    throw new TypeError('invalid dashboard producer state fields');
  }
  if (value.schemaVersion !== DASHBOARD_SCHEMA_VERSION) throw new TypeError('unsupported producer schema');
  if (typeof value.producerId !== 'string') throw new TypeError('invalid producer id');
  const producerId = validateIdentifier(value.producerId, 'prod');
  if (!['pinpoint', 'headroom', 'mcp'].includes(String(value.source))) {
    throw new TypeError('invalid producer source');
  }
  const startedAt = value.startedAt;
  const lastActivityAt = value.lastActivityAt;
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) {
    throw new TypeError('invalid producer startedAt');
  }
  if (typeof lastActivityAt !== 'string' || !Number.isFinite(Date.parse(lastActivityAt))) {
    throw new TypeError('invalid producer lastActivityAt');
  }
  if (value.endedAt !== null && (typeof value.endedAt !== 'string' || !Number.isFinite(Date.parse(value.endedAt)))) {
    throw new TypeError('invalid producer endedAt');
  }
  if (!Number.isInteger(value.eventCount) || Number(value.eventCount) < 0) {
    throw new TypeError('invalid producer eventCount');
  }
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    producerId,
    source: value.source as DashboardSource,
    startedAt: new Date(startedAt).toISOString(),
    lastActivityAt: new Date(lastActivityAt).toISOString(),
    endedAt: value.endedAt === null ? null : new Date(value.endedAt).toISOString(),
    eventCount: Number(value.eventCount),
  };
}

function fileBytes(path: string): number {
  try {
    return lstatSync(path).isFile() ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += directoryBytes(candidate);
    else if (entry.isFile()) total += fileBytes(candidate);
  }
  return total;
}

function groupEnded(path: string): boolean {
  const states = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.state.json'));
  if (states.length === 0) return true;
  return states.every((entry) => {
    try {
      return parseProducerState(JSON.parse(readFileSync(join(path, entry.name), 'utf8'))).endedAt !== null;
    } catch {
      return true;
    }
  });
}

export function pruneDashboardHistory(
  rootDir = DEFAULT_DASHBOARD_ROOT,
  options: { readonly now?: Date; readonly retentionMs?: number; readonly maxTotalBytes?: number } = {},
): DashboardPruneResult {
  if (!existsSync(rootDir)) return { removedGroups: 0, retainedBytes: 0, overBudget: false };
  const now = options.now?.getTime() ?? Date.now();
  const retentionMs = Math.max(0, options.retentionMs ?? DEFAULT_DASHBOARD_RETENTION_MS);
  const maxTotalBytes = Math.max(1, options.maxTotalBytes ?? DEFAULT_DASHBOARD_MAX_BYTES);
  const groups = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && IDENTIFIER_PATTERN.test(entry.name) && entry.name.startsWith('dash_'))
    .map((entry) => {
      const path = join(rootDir, entry.name);
      return {
        path,
        bytes: directoryBytes(path),
        modifiedAt: statSync(path).mtimeMs,
        ended: groupEnded(path),
      };
    });
  let removedGroups = 0;
  for (const group of groups) {
    if (group.ended && now - group.modifiedAt > retentionMs) {
      rmSync(group.path, { recursive: true, force: true });
      group.bytes = 0;
      removedGroups += 1;
    }
  }
  let retainedBytes = groups.reduce((sum, group) => sum + group.bytes, 0);
  for (const group of groups.filter((item) => item.ended && item.bytes > 0).sort((a, b) => a.modifiedAt - b.modifiedAt)) {
    if (retainedBytes <= maxTotalBytes) break;
    rmSync(group.path, { recursive: true, force: true });
    retainedBytes -= group.bytes;
    removedGroups += 1;
  }
  return { removedGroups, retainedBytes, overBudget: retainedBytes > maxTotalBytes };
}

export class DashboardJournal implements DashboardObserver {
  readonly rootDir: string;
  readonly groupId: string;
  readonly producerId: string;
  readonly groupDir: string;
  private readonly statePath: string;
  private readonly eventsPath: string;
  private readonly now: () => Date;
  private readonly maxProducerBytes: number;
  private readonly retentionMs: number;
  private readonly maxTotalBytes: number;
  private state: DashboardProducerState;

  constructor(private readonly options: DashboardJournalOptions) {
    this.rootDir = options.rootDir ?? DEFAULT_DASHBOARD_ROOT;
    this.groupId = validateIdentifier(options.groupId ?? createDashboardGroupId(), 'dash');
    this.producerId = validateIdentifier(options.producerId ?? createDashboardProducerId(), 'prod');
    this.groupDir = join(this.rootDir, this.groupId);
    this.statePath = join(this.groupDir, `${this.producerId}.state.json`);
    this.eventsPath = join(this.groupDir, `${this.producerId}.events.jsonl`);
    this.now = options.now ?? (() => new Date());
    this.maxProducerBytes = Math.max(MAX_EVENT_BYTES, options.maxProducerBytes ?? DEFAULT_DASHBOARD_PRODUCER_BYTES);
    this.retentionMs = Math.max(0, options.retentionMs ?? DEFAULT_DASHBOARD_RETENTION_MS);
    this.maxTotalBytes = Math.max(1, options.maxTotalBytes ?? DEFAULT_DASHBOARD_MAX_BYTES);
    ensurePrivateDirectory(this.rootDir);
    ensurePrivateDirectory(this.groupDir);
    const startedAt = this.now().toISOString();
    this.state = {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      producerId: this.producerId,
      source: options.source,
      startedAt,
      lastActivityAt: startedAt,
      endedAt: null,
      eventCount: 0,
    };
    atomicPrivateJson(this.statePath, this.state);
    pruneDashboardHistory(this.rootDir, {
      now: this.now(),
      retentionMs: this.retentionMs,
      maxTotalBytes: this.maxTotalBytes,
    });
  }

  onEvent(rawEvent: DashboardEvent): void {
    if (this.state.endedAt !== null) throw new Error('dashboard producer is closed');
    const event = normalizeDashboardEvent(rawEvent);
    if (event.source !== this.options.source) throw new TypeError('dashboard event source does not match producer');
    const line = `${JSON.stringify(event)}\n`;
    const incomingBytes = Buffer.byteLength(line);
    if (incomingBytes > MAX_EVENT_BYTES) throw new TypeError('dashboard event exceeds the metadata limit');
    if (fileBytes(this.eventsPath) + incomingBytes > this.maxProducerBytes) {
      const rotated = `${this.eventsPath}.1`;
      rmSync(rotated, { force: true });
      if (existsSync(this.eventsPath)) renameSync(this.eventsPath, rotated);
    }
    appendPrivate(this.eventsPath, line);
    this.state = {
      ...this.state,
      lastActivityAt: this.now().toISOString(),
      eventCount: this.state.eventCount + 1,
    };
    atomicPrivateJson(this.statePath, this.state);
  }

  close(): void {
    if (this.state.endedAt !== null) return;
    const endedAt = this.now().toISOString();
    this.state = { ...this.state, lastActivityAt: endedAt, endedAt };
    atomicPrivateJson(this.statePath, this.state);
    pruneDashboardHistory(this.rootDir, {
      now: this.now(),
      retentionMs: this.retentionMs,
      maxTotalBytes: this.maxTotalBytes,
    });
  }

  snapshot(): DashboardProducerState {
    return { ...this.state };
  }
}

export function readDashboardGroup(rootDir: string, groupId: string): DashboardGroupReadResult {
  validateIdentifier(groupId, 'dash');
  const groupDir = join(rootDir, groupId);
  if (!existsSync(groupDir)) return { groupId, producers: [], events: [], corruptRecords: 0 };
  const producers: DashboardProducerState[] = [];
  const events: DashboardEvent[] = [];
  let corruptRecords = 0;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.state.json')) continue;
    try {
      producers.push(parseProducerState(JSON.parse(readFileSync(join(groupDir, entry.name), 'utf8'))));
    } catch {
      corruptRecords += 1;
    }
  }
  const eventFiles = readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.events\.jsonl(?:\.1)?$/.test(entry.name))
    .sort((left, right) => left.name.endsWith('.1') === right.name.endsWith('.1')
      ? left.name.localeCompare(right.name)
      : left.name.endsWith('.1') ? -1 : 1);
  for (const entry of eventFiles) {
    for (const line of readFileSync(join(groupDir, entry.name), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(normalizeDashboardEvent(JSON.parse(line)));
      } catch {
        corruptRecords += 1;
      }
    }
  }
  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  producers.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return { groupId, producers, events, corruptRecords };
}

export function buildDashboardSnapshot(
  group: DashboardGroupReadResult,
  generatedAt = new Date(),
  recentEventLimit = 100,
): DashboardSnapshot {
  const lanes = new Map<string, DashboardSnapshot['tokenLanes'][number]>();
  let bytesBefore = 0;
  let bytesVisible = 0;
  let virtualizedResults = 0;
  const mcp = {
    toolCalls: 0,
    succeeded: 0,
    failed: 0,
    denied: 0,
    queries: 0,
    flows: 0,
    receiptsEmitted: 0,
  };
  let reversibleCount = 0;
  let latestHeadroom: Extract<DashboardEvent, { type: 'headroom.sample' }> | undefined;
  for (const event of group.events) {
    if (event.type === 'headroom.sample') {
      if (!latestHeadroom || event.occurredAt >= latestHeadroom.occurredAt) latestHeadroom = event;
      continue;
    }
    if (event.type === 'provider.route') {
      reversibleCount += event.reversibleCount;
      for (const stage of event.stages) {
        const key = `${event.source}:${stage.basis}`;
        const previous = lanes.get(key);
        lanes.set(key, {
          source: event.source,
          basis: stage.basis,
          tokensText: (previous?.tokensText ?? 0) + stage.tokensText,
          tokensSent: (previous?.tokensSent ?? 0) + stage.tokensCompressed,
          tokensSaved: (previous?.tokensSaved ?? 0) + stage.tokensSaved,
          appliedStages: (previous?.appliedStages ?? 0) + (stage.applied ? 1 : 0),
        });
      }
      continue;
    }
    if (event.type === 'mcp.result') {
      bytesBefore += event.bytesBefore.value;
      bytesVisible += event.bytesVisible.value;
      if (event.virtualized) virtualizedResults += 1;
      continue;
    }
    if (event.type === 'mcp.tool') mcp.toolCalls += 1;
    else if (event.type === 'mcp.query') mcp.queries += 1;
    else if (event.type === 'mcp.flow') {
      mcp.flows += 1;
      if (event.receiptEmitted) mcp.receiptsEmitted += 1;
    }
    if ('outcome' in event) mcp[event.outcome] += 1;
  }
  if (latestHeadroom) {
    lanes.set('headroom:provider-reported', {
      source: 'headroom',
      basis: 'provider-reported',
      tokensText: latestHeadroom.tokensText.value,
      tokensSent: latestHeadroom.tokensSent.value,
      tokensSaved: latestHeadroom.tokensSaved.value,
      appliedStages: latestHeadroom.tokensSaved.value > 0 ? 1 : 0,
    });
  }
  const sourceMap = new Map<DashboardSource, DashboardSnapshot['sources'][number]>();
  for (const producer of group.producers) {
    const previous = sourceMap.get(producer.source);
    const lastActivityAt = previous?.lastActivityAt == null || producer.lastActivityAt > previous.lastActivityAt
      ? producer.lastActivityAt
      : previous.lastActivityAt;
    sourceMap.set(producer.source, {
      source: producer.source,
      state: previous?.state === 'active' || producer.endedAt === null ? 'active' : 'ended',
      producers: (previous?.producers ?? 0) + 1,
      lastActivityAt,
    });
  }
  const headroomSource = sourceMap.get('headroom');
  if (headroomSource && latestHeadroom && !latestHeadroom.healthy) {
    sourceMap.set('headroom', { ...headroomSource, state: 'degraded' });
  }
  const sourceStates = [...sourceMap.values()];
  const state = group.corruptRecords > 0
    ? 'degraded'
    : sourceStates.some((source) => source.state === 'degraded')
      ? 'degraded'
    : sourceStates.some((source) => source.state === 'active')
      ? 'active'
      : 'ended';
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    groupId: group.groupId,
    state,
    requests: group.events.filter((event) => event.type === 'provider.route').length +
      (latestHeadroom?.requests.value ?? 0),
    reversibleCount,
    tokenLanes: [...lanes.values()].sort((left, right) =>
      `${left.source}:${left.basis}`.localeCompare(`${right.source}:${right.basis}`)),
    byteLanes: bytesBefore > 0 || bytesVisible > 0 ? [{
      source: 'mcp',
      basis: 'exact-bytes',
      bytesBefore,
      bytesVisible,
      bytesRetained: bytesBefore - bytesVisible,
      virtualizedResults,
    }] : [],
    mcp,
    headroom: latestHeadroom ? {
      healthy: latestHeadroom.healthy,
      version: latestHeadroom.version,
      attribution: latestHeadroom.attribution,
      coverage: latestHeadroom.coverage,
      model: latestHeadroom.model,
      outputTokens: latestHeadroom.outputTokens.value,
      costSaved: latestHeadroom.costSaved,
      quota: latestHeadroom.quota,
    } : null,
    sources: sourceStates.sort((left, right) => left.source.localeCompare(right.source)),
    recentEvents: group.events.slice(-Math.max(0, recentEventLimit)),
    corruptRecords: group.corruptRecords,
    privacy: {
      metadataOnly: true,
      neverStored: [
        'prompts and responses',
        'tool arguments and results',
        'credentials and headers',
        'artifact capabilities and receipts',
      ],
    },
  };
}

export function listDashboardHistory(rootDir = DEFAULT_DASHBOARD_ROOT): DashboardHistorySession[] {
  if (!existsSync(rootDir)) return [];
  const sessions: DashboardHistorySession[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !IDENTIFIER_PATTERN.test(entry.name) || !entry.name.startsWith('dash_')) {
      continue;
    }
    const group = readDashboardGroup(rootDir, entry.name);
    const snapshot = buildDashboardSnapshot(group);
    const startedAt = group.producers.reduce<string | null>(
      (earliest, producer) => earliest == null || producer.startedAt < earliest ? producer.startedAt : earliest,
      null,
    );
    const lastActivityAt = group.producers.reduce<string | null>(
      (latest, producer) => latest == null || producer.lastActivityAt > latest ? producer.lastActivityAt : latest,
      null,
    );
    sessions.push({
      groupId: group.groupId,
      state: snapshot.state,
      startedAt,
      lastActivityAt,
      requests: snapshot.requests,
      sources: snapshot.sources.map(({ source }) => source),
      corruptRecords: snapshot.corruptRecords,
    });
  }
  return sessions.sort((left, right) => (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? ''));
}