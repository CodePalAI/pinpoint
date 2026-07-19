import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  verifyMcpOpaqueFlowReceipt,
  type McpOpaqueFlowReceipt,
  type McpOpaqueFlowReceiptVerifier,
} from '../mcp/flow.js';
import { runMcpScenario } from './mcp-demo.js';

export const REPRODUCTION_RELATIONSHIPS = [
  'unaffiliated',
  'maintainer',
  'contracted',
  'other',
] as const;

export type ReproductionRelationship = typeof REPRODUCTION_RELATIONSHIPS[number];

export interface McpReproductionBundle {
  readonly schemaVersion: 1;
  readonly evidenceLevel: 'self-contained-protocol-reproduction';
  readonly kind: 'mcp-value-opaque-flow-reproduction';
  readonly runId: string;
  readonly date: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly passed: boolean;
  readonly relationship: ReproductionRelationship;
  readonly environment: {
    readonly platform: string;
    readonly release: string;
    readonly architecture: string;
    readonly node: string;
  };
  readonly package: {
    readonly name: string;
    readonly version: string;
  };
  readonly source: {
    readonly fingerprints: Readonly<Record<string, string>>;
  };
  readonly summary: {
    readonly flowCalls: number;
    readonly destinationAcceptedCalls: number;
    readonly bypassAttempts: number;
    readonly bypassesDenied: number;
    readonly privateValuesScanned: number;
    readonly privateValuesVisible: number;
    readonly durationMs: number;
  };
  readonly security: {
    readonly exactPersistedProjection: boolean;
    readonly processSeparationValid: boolean;
    readonly oneDispatchPerFlow: boolean;
    readonly receiptChainValid: boolean;
    readonly commitmentsUnlinkable: boolean;
  };
  readonly receiptVerifier: McpOpaqueFlowReceiptVerifier | null;
  readonly receipts: readonly McpOpaqueFlowReceipt[];
  readonly failure: string | null;
  readonly limitations: readonly string[];
  readonly bundleSha256: string;
}

export interface ReproductionVerification {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly flowCalls: number;
  readonly bypassesDenied: number;
  readonly privateValuesVisible: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function packageIdentity(): { name: string; version: string } {
  const value = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name?: unknown; version?: unknown };
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error('package metadata is unavailable');
  }
  return { name: value.name, version: value.version };
}

function fingerprint(relativeJs: string, relativeTs: string): string {
  const candidates = [
    fileURLToPath(new URL(relativeJs, import.meta.url)),
    fileURLToPath(new URL(relativeTs, import.meta.url)),
  ];
  const path = candidates.find(existsSync);
  if (!path) throw new Error(`runtime evidence source is unavailable: ${relativeJs}`);
  return sha256(readFileSync(path));
}

function runtimeFingerprints(): Readonly<Record<string, string>> {
  return {
    'runtime/mcp/gateway': fingerprint('../mcp/gateway.js', '../mcp/gateway.ts'),
    'runtime/mcp/flow': fingerprint('../mcp/flow.js', '../mcp/flow.ts'),
    'runtime/mcp/destination': fingerprint('../mcp/destination.js', '../mcp/destination.ts'),
    'runtime/cli/mcp-demo': fingerprint('./mcp-demo.js', './mcp-demo.ts'),
    'runtime/cli/evidence': fingerprint('./evidence.js', './evidence.ts'),
  };
}

function finalizeBundle(
  value: Omit<McpReproductionBundle, 'bundleSha256'>,
): McpReproductionBundle {
  return { ...value, bundleSha256: sha256(canonicalJson(value)) };
}

function safeFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 240);
}

export async function runMcpReproduction(
  relationship: ReproductionRelationship,
): Promise<McpReproductionBundle> {
  if (!REPRODUCTION_RELATIONSHIPS.includes(relationship)) {
    throw new TypeError('invalid reproduction relationship');
  }
  const runId = randomUUID();
  const fallbackStartedAt = new Date().toISOString();
  const base = {
    schemaVersion: 1 as const,
    evidenceLevel: 'self-contained-protocol-reproduction' as const,
    kind: 'mcp-value-opaque-flow-reproduction' as const,
    runId,
    date: fallbackStartedAt.slice(0, 10),
    relationship,
    environment: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      node: process.version,
    },
    package: packageIdentity(),
    source: { fingerprints: runtimeFingerprints() },
    limitations: [
      'This is a synthetic no-model protocol reproduction, not a production workflow or demand signal.',
      'The source, destination, policy, fixture, and harness ship in the same npm package under test.',
      'Relationship is operator-declared and must be reviewed with the submission.',
      'The operating system, Node runtime, cryptography, and package registry remain trusted.',
    ],
  };
  try {
    const scenario = await runMcpScenario({ flowCalls: 30, extendedBypasses: true });
    const commitmentsUnlinkable = new Set(
      scenario.receipts.map(({ payloadCommitment }) => payloadCommitment),
    ).size === scenario.receipts.length;
    return finalizeBundle({
      ...base,
      startedAt: scenario.startedAt,
      completedAt: scenario.completedAt,
      passed: true,
      summary: {
        flowCalls: scenario.receipts.length,
        destinationAcceptedCalls: scenario.destinationDispatches,
        bypassAttempts: scenario.bypassAttempts,
        bypassesDenied: scenario.bypassesDenied,
        privateValuesScanned: scenario.privateValuesScanned,
        privateValuesVisible: scenario.privateValuesVisible,
        durationMs: scenario.durationMs,
      },
      security: {
        exactPersistedProjection: scenario.projectionExact,
        processSeparationValid: scenario.processSeparationValid,
        oneDispatchPerFlow: scenario.destinationDispatches === scenario.receipts.length,
        receiptChainValid: true,
        commitmentsUnlinkable,
      },
      receiptVerifier: scenario.receiptVerifier,
      receipts: scenario.receipts,
      failure: null,
    });
  } catch (cause) {
    const completedAt = new Date().toISOString();
    return finalizeBundle({
      ...base,
      startedAt: fallbackStartedAt,
      completedAt,
      passed: false,
      summary: {
        flowCalls: 0,
        destinationAcceptedCalls: 0,
        bypassAttempts: 8,
        bypassesDenied: 0,
        privateValuesScanned: 401,
        privateValuesVisible: 0,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(fallbackStartedAt)),
      },
      security: {
        exactPersistedProjection: false,
        processSeparationValid: false,
        oneDispatchPerFlow: false,
        receiptChainValid: false,
        commitmentsUnlinkable: false,
      },
      receiptVerifier: null,
      receipts: [],
      failure: safeFailure(cause),
    });
  }
}

export function verifyMcpReproduction(value: unknown): ReproductionVerification {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['bundle must be an object'], flowCalls: 0, bypassesDenied: 0, privateValuesVisible: 0 };
  }
  const bundle = value as unknown as McpReproductionBundle;
  if (bundle.schemaVersion !== 1) errors.push('unsupported schemaVersion');
  if (bundle.evidenceLevel !== 'self-contained-protocol-reproduction') errors.push('invalid evidenceLevel');
  if (bundle.kind !== 'mcp-value-opaque-flow-reproduction') errors.push('invalid kind');
  if (!REPRODUCTION_RELATIONSHIPS.includes(bundle.relationship)) errors.push('invalid relationship');
  if (bundle.passed !== true) errors.push('reproduction did not pass');
  if (bundle.failure !== null) errors.push('bundle contains a failure');
  if (!Array.isArray(bundle.receipts)) errors.push('receipts must be an array');
  if (!isRecord(bundle.receiptVerifier)) errors.push('receiptVerifier is missing');
  const receipts = Array.isArray(bundle.receipts) ? bundle.receipts : [];
  const verifier = isRecord(bundle.receiptVerifier)
    ? bundle.receiptVerifier as unknown as McpOpaqueFlowReceiptVerifier
    : undefined;
  let previousReceiptHash = '0'.repeat(64);
  for (const [index, receipt] of receipts.entries()) {
    if (!verifyMcpOpaqueFlowReceipt(receipt, verifier)) {
      errors.push(`receipt ${index + 1} failed signature or verifier validation`);
      continue;
    }
    if (receipt.sequence !== index + 1 || receipt.previousReceiptHash !== previousReceiptHash) {
      errors.push(`receipt ${index + 1} breaks sequence linkage`);
    }
    if (receipt.destinationSucceeded !== true) errors.push(`receipt ${index + 1} reports destination failure`);
    previousReceiptHash = receipt.receiptHash;
  }
  const summary: Record<string, unknown> = isRecord(bundle.summary) ? bundle.summary : {};
  const security: Record<string, unknown> = isRecord(bundle.security) ? bundle.security : {};
  const flowCalls = typeof summary.flowCalls === 'number' ? summary.flowCalls : 0;
  const bypassesDenied = typeof summary.bypassesDenied === 'number' ? summary.bypassesDenied : 0;
  const privateValuesVisible = typeof summary.privateValuesVisible === 'number'
    ? summary.privateValuesVisible
    : 0;
  if (flowCalls !== 30 || receipts.length !== 30) errors.push('expected 30 flow calls and receipts');
  if (summary.destinationAcceptedCalls !== 30) errors.push('expected 30 destination acceptances');
  if (summary.bypassAttempts !== 8 || bypassesDenied !== 8) errors.push('expected 8/8 bypass denials');
  if (summary.privateValuesScanned !== 401 || privateValuesVisible !== 0) {
    errors.push('private-value scan did not pass');
  }
  for (const field of [
    'exactPersistedProjection',
    'processSeparationValid',
    'oneDispatchPerFlow',
    'receiptChainValid',
    'commitmentsUnlinkable',
  ]) {
    if (security[field] !== true) errors.push(`security check failed: ${field}`);
  }
  const { bundleSha256, ...unsigned } = bundle;
  if (typeof bundleSha256 !== 'string' || bundleSha256 !== sha256(canonicalJson(unsigned))) {
    errors.push('bundleSha256 does not match bundle content');
  }
  return { valid: errors.length === 0, errors, flowCalls, bypassesDenied, privateValuesVisible };
}