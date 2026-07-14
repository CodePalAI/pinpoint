import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { CaptureConfig } from '../config.js';
import type { PipelineResult } from '../kernel/pipeline.js';
import type { AuthMode, Provider, SavingsReport } from '../types.js';

export interface CaptureRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly provider: Provider;
  readonly model: string | null;
  readonly authMode: AuthMode;
  readonly mode: string;
  readonly originalBodySha256: string;
  readonly transformedBodySha256: string;
  readonly originalBody?: Record<string, unknown>;
  readonly transformedBody?: Record<string, unknown>;
  readonly report: SavingsReport;
  readonly pipeline: {
    readonly decisions: readonly {
      readonly integrationId: string;
      readonly status: string;
      readonly reason?: string;
    }[];
    readonly transactions: readonly {
      readonly integrationId: string;
      readonly status: string;
      readonly error?: string;
    }[];
    readonly errors: readonly { readonly integrationId: string; readonly error: string }[];
  };
}

export interface CaptureStats {
  readonly records: number;
  readonly failures: number;
}

export interface CaptureInput {
  readonly durationMs: number;
  readonly provider: Provider;
  readonly model: string | null;
  readonly authMode: AuthMode;
  readonly mode: string;
  readonly originalBody: Record<string, unknown>;
  readonly transformedBody: Record<string, unknown>;
  readonly report: SavingsReport;
  readonly pipeline: PipelineResult;
}

export function hashCaptureBody(body: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function summarizePipeline(pipeline: PipelineResult): CaptureRecord['pipeline'] {
  return {
    decisions: pipeline.decisions.map((decision) => ({
      integrationId: decision.proposal.integrationId,
      status: decision.status,
      reason: decision.reason,
    })),
    transactions: pipeline.transactions.map((transaction) => ({
      integrationId: transaction.proposal.integrationId,
      status: transaction.status,
      error: transaction.error,
    })),
    errors: pipeline.errors.map((error) => ({ ...error })),
  };
}

export class CaptureWriter {
  private records = 0;
  private failures = 0;

  constructor(
    private readonly config: CaptureConfig,
    private readonly onError?: (error: unknown) => void,
  ) {}

  get enabled(): boolean {
    return this.config.path.length > 0;
  }

  get includeBodies(): boolean {
    return this.config.includeBodies;
  }

  stats(): CaptureStats {
    return { records: this.records, failures: this.failures };
  }

  record(input: CaptureInput): void {
    if (!this.enabled) return;
    const record: CaptureRecord = {
      schemaVersion: 1,
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      durationMs: input.durationMs,
      provider: input.provider,
      model: input.model,
      authMode: input.authMode,
      mode: input.mode,
      originalBodySha256: hashCaptureBody(input.originalBody),
      transformedBodySha256: hashCaptureBody(input.transformedBody),
      originalBody: this.config.includeBodies ? structuredClone(input.originalBody) : undefined,
      transformedBody: this.config.includeBodies ? structuredClone(input.transformedBody) : undefined,
      report: structuredClone(input.report),
      pipeline: summarizePipeline(input.pipeline),
    };

    try {
      mkdirSync(dirname(this.config.path), { recursive: true, mode: 0o700 });
      const line = `${JSON.stringify(record)}\n`;
      this.rotateIfNeeded(Buffer.byteLength(line));
      const descriptor = openSync(this.config.path, 'a', 0o600);
      try {
        chmodSync(this.config.path, 0o600);
        writeSync(descriptor, line);
        if (this.config.fsync) fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      this.records += 1;
    } catch (error) {
      this.failures += 1;
      this.onError?.(error);
    }
  }

  private rotateIfNeeded(incomingBytes: number): void {
    const maxBytes = Math.max(1, this.config.maxBytes);
    if (incomingBytes > maxBytes) {
      throw new Error(`capture record exceeds PIXROOM_CAPTURE_MAX_BYTES (${incomingBytes} > ${maxBytes})`);
    }
    const currentBytes = existsSync(this.config.path) ? statSync(this.config.path).size : 0;
    if (currentBytes + incomingBytes <= maxBytes) return;

    const maxFiles = Math.max(1, this.config.maxFiles);
    if (maxFiles === 1) {
      rmSync(this.config.path, { force: true });
      return;
    }
    for (let suffix = maxFiles - 1; suffix >= 1; suffix -= 1) {
      const source = suffix === 1 ? this.config.path : `${this.config.path}.${suffix - 1}`;
      const destination = `${this.config.path}.${suffix}`;
      if (!existsSync(source)) continue;
      rmSync(destination, { force: true });
      renameSync(source, destination);
    }
    if (this.config.fsync) {
      const directory = openSync(dirname(this.config.path), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  }
}

export function readCaptureFile(path: string): CaptureRecord[] {
  const text = readFileSync(path, 'utf8');
  const records: CaptureRecord[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `invalid capture JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`invalid capture record at line ${index + 1}`);
    }
    const record = value as Partial<CaptureRecord>;
    if (
      record.schemaVersion !== 1 ||
      typeof record.id !== 'string' ||
      (record.provider !== 'anthropic' && record.provider !== 'openai') ||
      typeof record.originalBodySha256 !== 'string' ||
      typeof record.transformedBodySha256 !== 'string'
    ) {
      throw new Error(`unsupported capture record at line ${index + 1}`);
    }
    records.push(record as CaptureRecord);
  }
  return records;
}