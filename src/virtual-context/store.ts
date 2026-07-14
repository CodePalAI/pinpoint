import { createHash } from 'node:crypto';

export const VIRTUAL_QUERY_TOOL_NAME = 'pixroom_query';

type JsonPrimitive = string | number | boolean | null;
type JsonRecord = Record<string, unknown>;

export type VirtualContextKind = 'json-array' | 'json-object' | 'lines';

export interface VirtualContextDescriptor {
  readonly id: string;
  readonly kind: VirtualContextKind;
  readonly bytes: number;
  readonly items: number;
  readonly fields: readonly string[];
}

export interface VirtualContextQuery {
  readonly id: string;
  readonly op: 'schema' | 'json_select' | 'count' | 'grep' | 'slice';
  readonly where?: Readonly<Record<string, JsonPrimitive>>;
  readonly fields?: readonly string[];
  readonly query?: string;
  readonly offset?: number;
  readonly limit?: number;
}

interface VirtualContextEntry {
  readonly descriptor: VirtualContextDescriptor;
  readonly raw: string;
  readonly value: unknown;
}

export interface VirtualContextPrefetch {
  readonly query: VirtualContextQuery;
  readonly result: string;
}

export interface VirtualContextInspection {
  readonly descriptor: VirtualContextDescriptor;
  readonly prefetch?: VirtualContextPrefetch;
}

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function recordFields(records: readonly unknown[]): string[] {
  const fields = new Set<string>();
  for (const value of records.slice(0, 100)) {
    if (!isRecord(value)) continue;
    for (const key of Object.keys(value)) fields.add(key);
  }
  return [...fields].sort();
}

function clampInteger(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function samePrimitive(left: unknown, right: JsonPrimitive): boolean {
  return left === right;
}

function matchesWhere(value: unknown, where: Readonly<Record<string, JsonPrimitive>>): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(where).every(([field, expected]) => samePrimitive(value[field], expected));
}

function project(value: unknown, fields: readonly string[]): unknown {
  if (!isRecord(value) || fields.length === 0) return value;
  const selected: JsonRecord = {};
  for (const field of fields) {
    if (Object.hasOwn(value, field)) selected[field] = value[field];
  }
  return selected;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function primitive(raw: string): JsonPrimitive {
  const normalized = raw.replace(/^['"]|['"]$/g, '');
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;
  return normalized;
}

/** JSON for prompt-delimited data: preserve values while neutralizing delimiter characters. */
export function serializePromptData(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const hex = character.codePointAt(0)!.toString(16).padStart(4, '0');
    return `\\u${hex}`;
  });
}

function buildEntry(raw: string): VirtualContextEntry {
  const digest = createHash('sha256').update(raw).digest('hex');
  let value: unknown = raw.split(/\r?\n/);
  let kind: VirtualContextKind = 'lines';
  let fields: string[] = [];
  try {
    value = JSON.parse(raw);
    if (Array.isArray(value)) {
      kind = 'json-array';
      fields = recordFields(value);
    } else if (isRecord(value)) {
      kind = 'json-object';
      fields = Object.keys(value).sort();
    } else {
      value = raw.split(/\r?\n/);
    }
  } catch {
    // Line-oriented text stays exact in the local store.
  }

  const descriptor = {
    id: `vctx_${digest.slice(0, 32)}`,
    kind,
    bytes: Buffer.byteLength(raw),
    items: Array.isArray(value) ? value.length : 1,
    fields,
  } satisfies VirtualContextDescriptor;
  return { descriptor, raw, value };
}

export class VirtualContextStore {
  private readonly entries = new Map<string, VirtualContextEntry>();
  private retainedBytes = 0;

  constructor(
    private readonly maxResultChars = 12_000,
    private readonly maxEntries = 256,
    private readonly maxStoredBytes = 64 * 1024 * 1024,
  ) {}

  private resolveId(
    entry: VirtualContextEntry,
    entries: ReadonlyMap<string, VirtualContextEntry> = this.entries,
  ): VirtualContextEntry {
    let existing = entries.get(entry.descriptor.id);
    if (!existing || existing.raw === entry.raw) return entry;

    const fullId = `vctx_${createHash('sha256').update(entry.raw).digest('hex')}`;
    existing = entries.get(fullId);
    if (existing && existing.raw !== entry.raw) {
      throw new Error('virtual context content hash collision');
    }
    return { ...entry, descriptor: { ...entry.descriptor, id: fullId } };
  }

  put(raw: string): VirtualContextDescriptor {
    return this.putMany([raw])[0]!;
  }

  putMany(
    rawValues: readonly string[],
    requiredIds: ReadonlySet<string> = new Set(),
  ): VirtualContextDescriptor[] {
    const entries = new Map(this.entries);
    let retainedBytes = this.retainedBytes;
    const descriptors: VirtualContextDescriptor[] = [];
    for (const raw of rawValues) {
      const entry = this.resolveId(buildEntry(raw), entries);
      const existing = entries.get(entry.descriptor.id);
      if (existing?.raw === raw) {
        entries.delete(existing.descriptor.id);
        entries.set(existing.descriptor.id, existing);
        descriptors.push(existing.descriptor);
        continue;
      }

      entries.set(entry.descriptor.id, entry);
      retainedBytes += entry.descriptor.bytes;
      descriptors.push(entry.descriptor);
      while (entries.size > this.maxEntries || retainedBytes > this.maxStoredBytes) {
        const oldest = entries.keys().next().value as string | undefined;
        if (!oldest) break;
        const removed = entries.get(oldest);
        entries.delete(oldest);
        retainedBytes -= removed?.descriptor.bytes ?? 0;
      }
    }

    if ([...requiredIds].some((id) => !entries.has(id))) {
      throw new Error('virtual context capacity cannot retain every required dataset');
    }
    this.entries.clear();
    for (const [id, entry] of entries) this.entries.set(id, entry);
    this.retainedBytes = retainedBytes;
    return descriptors;
  }

  inspect(raw: string, question: string): VirtualContextInspection {
    const entry = this.resolveId(buildEntry(raw));
    return { descriptor: entry.descriptor, prefetch: this.prefetchEntry(entry, question) };
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.retainedBytes;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  manifest(descriptor: VirtualContextDescriptor, queryFallback: boolean): string {
    const fieldText = serializePromptData(descriptor.fields);
    const access = queryFallback
      ? `Use ${VIRTUAL_QUERY_TOOL_NAME} with this id for bounded access.`
      : 'Relevant exact results are attached to the current live turn when safely derivable.';
    return (
      `<<pixroom_virtual id=${descriptor.id} kind=${descriptor.kind} ` +
      `items=${descriptor.items} bytes=${descriptor.bytes} fields=${fieldText} ` +
      `query=${queryFallback ? 'available' : 'disabled'}>>\n` +
      `Exact content is stored locally. ${access}`
    );
  }

  /** Plan a narrow exact query from explicit field/value or count language. */
  plan(descriptor: VirtualContextDescriptor, question: string): VirtualContextQuery | undefined {
    if (!question.trim()) return undefined;
    if (
      /\b(?:not|except|without|between|range|from|through|before|after|at least|at most|more than|less than|under|over|or)\b|[<>]/i.test(
        question,
      )
    ) {
      return undefined;
    }
    if (descriptor.kind === 'json-array' || descriptor.kind === 'json-object') {
      const where: Record<string, JsonPrimitive> = {};
      const mentioned = descriptor.fields.filter((field) =>
        new RegExp(`\\b${escapeRegExp(field)}\\b`, 'i').test(question),
      );
      for (const field of mentioned) {
        const matches = [...question.matchAll(new RegExp(
          `\\b${escapeRegExp(field)}\\b\\s*(?:(is|equals?|[:=])\\s*)?(['"]?[A-Za-z0-9_.@-]+['"]?)`,
          'gi',
        ))];
        if (matches.length > 1) return undefined;
        const match = matches[0];
        if (!match?.[2]) continue;
        const value = primitive(match[2]);
        const explicitOperator = match[1] != null;
        const implicitNumericKey = /(?:^|_)(?:id|index|number|no)$/i.test(field) && typeof value === 'number';
        if (explicitOperator || implicitNumericKey) where[field] = value;
      }
      const whereFields = new Set(Object.keys(where));
      const fields = mentioned.filter((field) => !whereFields.has(field));
      if (Object.keys(where).length > 0) {
        if (/\b(how many|count|number of)\b/i.test(question)) {
          return { id: descriptor.id, op: 'count', where };
        }
        return {
          id: descriptor.id,
          op: 'json_select',
          where,
          fields: fields.length > 0 ? fields : undefined,
          limit: 20,
        };
      }
    }

    if (/\b(how many|count|number of)\b/i.test(question)) {
      const level = question.match(/\b(ERROR|WARN|WARNING|INFO|FATAL|DEBUG|TRACE)\b/i)?.[1];
      if (level) {
        return { id: descriptor.id, op: 'count', query: level.toUpperCase() };
      }
    }
    if (descriptor.kind === 'lines' && /\b(exported?|classes?)\b/i.test(question)) {
      return { id: descriptor.id, op: 'grep', query: 'export class', limit: 20 };
    }
    return undefined;
  }

  prefetch(descriptor: VirtualContextDescriptor, question: string): VirtualContextPrefetch | undefined {
    const entry = this.entries.get(descriptor.id);
    return entry ? this.prefetchEntry(entry, question) : undefined;
  }

  private prefetchEntry(entry: VirtualContextEntry, question: string): VirtualContextPrefetch | undefined {
    const descriptor = entry.descriptor;
    const query = this.plan(descriptor, question);
    if (!query) return undefined;
    const result = this.serializeBounded(this.execute(entry, query));
    try {
      const parsed = JSON.parse(result);
      if (isRecord(parsed) && Object.hasOwn(parsed, 'error')) return undefined;
      if (query.op === 'json_select') {
        if (!query.fields?.length || !isRecord(parsed)) return undefined;
        const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
        if (parsed.count !== 1 || matches.length !== 1 || parsed.truncated !== false) return undefined;
      } else if (query.op === 'count') {
        if (!isRecord(parsed) || typeof parsed.count !== 'number') return undefined;
      } else if (query.op === 'grep') {
        if (!isRecord(parsed) || !Array.isArray(parsed.matches) || parsed.truncated !== false) {
          return undefined;
        }
      } else {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { query, result };
  }

  query(input: VirtualContextQuery): string {
    const entry = this.entries.get(input.id);
    if (!entry) return JSON.stringify({ error: 'virtual context not found', id: input.id });

    return this.serializeBounded(this.execute(entry, input));
  }

  private execute(entry: VirtualContextEntry, input: VirtualContextQuery): unknown {
    let result: unknown;
    switch (input.op) {
      case 'schema':
        result = entry.descriptor;
        break;
      case 'json_select':
        result = this.selectJson(entry, input);
        break;
      case 'count':
        result = this.count(entry, input);
        break;
      case 'grep':
        result = this.grep(entry, input);
        break;
      case 'slice':
        result = this.slice(entry, input);
        break;
      default:
        result = { error: 'unsupported virtual context operation' };
    }
    return result;
  }

  private selectJson(entry: VirtualContextEntry, input: VirtualContextQuery): unknown {
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    const where = input.where ?? {};
    const fields = input.fields ?? [];
    const limit = clampInteger(input.limit, 20, 100);
    const allMatches = values.filter(
      (value) => Object.keys(where).length === 0 || matchesWhere(value, where),
    );
    const matches = allMatches
      .slice(0, limit)
      .map((value) => project(value, fields));
    return { matches, count: allMatches.length, truncated: allMatches.length > limit };
  }

  private count(entry: VirtualContextEntry, input: VirtualContextQuery): unknown {
    if (entry.descriptor.kind === 'json-array') {
      const where = input.where ?? {};
      const values = entry.value as unknown[];
      const count =
        Object.keys(where).length === 0
          ? values.length
          : values.filter((value) => matchesWhere(value, where)).length;
      return { count };
    }
    const lines = entry.raw.split(/\r?\n/);
    if (!input.query) return { count: lines.length };
    const severity = /^(ERROR|WARN|WARNING|INFO|FATAL|DEBUG|TRACE)$/i.exec(input.query)?.[1];
    if (severity) {
      const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(severity)}(?:\\s|$)`, 'i');
      return { count: lines.filter((line) => pattern.test(line)).length };
    }
    const needle = input.query.toLocaleLowerCase();
    return { count: lines.filter((line) => line.toLocaleLowerCase().includes(needle)).length };
  }

  private grep(entry: VirtualContextEntry, input: VirtualContextQuery): unknown {
    if (!input.query) return { error: 'grep requires query' };
    const needle = input.query.toLocaleLowerCase();
    const limit = clampInteger(input.limit, 20, 100);
    const allMatches = entry.raw
      .split(/\r?\n/)
      .map((text, index) => ({ line: index + 1, text }))
      .filter((row) => row.text.toLocaleLowerCase().includes(needle));
    return {
      matches: allMatches.slice(0, limit),
      count: allMatches.length,
      truncated: allMatches.length > limit,
    };
  }

  private slice(entry: VirtualContextEntry, input: VirtualContextQuery): unknown {
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    const offset = clampInteger(input.offset, 0, values.length);
    const limit = clampInteger(input.limit, 20, 100);
    return { offset, items: values.slice(offset, offset + limit), total: values.length };
  }

  private serializeBounded(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized.length <= this.maxResultChars) return serialized;
    return JSON.stringify({
      error: 'query result exceeded output cap',
      maxChars: this.maxResultChars,
      preview: serialized.slice(0, Math.max(0, this.maxResultChars - 120)),
    });
  }
}

export function virtualQueryToolSchema(): Record<string, unknown> {
  return {
    name: VIRTUAL_QUERY_TOOL_NAME,
    description:
      'Query exact structured or line-oriented content stored behind a <<pixroom_virtual ...>> manifest. ' +
      'Use this instead of guessing or requesting the entire original.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        op: { enum: ['schema', 'json_select', 'count', 'grep', 'slice'] },
        where: { type: 'object', additionalProperties: true },
        fields: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['id', 'op'],
    },
  };
}