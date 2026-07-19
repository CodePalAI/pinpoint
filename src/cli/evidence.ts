import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  verifyMcpOpaqueFlowReceipt,
  type McpOpaqueFlowReceipt,
  type McpOpaqueFlowReceiptVerifier,
} from '../mcp/flow.js';
import {
  runMcpScenario,
  type McpScenarioDenial,
} from './mcp-demo.js';

export const MAX_REPRODUCTION_BUNDLE_BYTES = 256 * 1024;

const REPRODUCTION_LIMITATIONS = [
  'This runs 30 repeated calls of one synthetic flow; it is not 30 distinct workflows.',
  'This is a no-model protocol reproduction, not a production workflow or demand signal.',
  'The source, destination, policy, fixture, and harness ship in the same npm package under test.',
  'Relationship is operator-declared and must be reviewed with the submission.',
  'The SHA-256 checksum detects accidental corruption; it is not a signature or operator authentication.',
  'Distinct commitments across repetitions are an observed smoke check, not a standalone unlinkability proof.',
  'The operating system, Node runtime, cryptography, and package registry remain trusted.',
] as const;

export const REPRODUCTION_RELATIONSHIPS = [
  'unaffiliated',
  'maintainer',
  'contracted',
  'other',
] as const;

export type ReproductionRelationship = typeof REPRODUCTION_RELATIONSHIPS[number];

export type ReproductionFailureCode =
  | 'PACKAGE_METADATA_UNAVAILABLE'
  | 'RUNTIME_MANIFEST_UNAVAILABLE'
  | 'GATEWAY_INITIALIZATION_FAILED'
  | 'CATALOG_VALIDATION_FAILED'
  | 'CAPABILITY_CAPTURE_FAILED'
  | 'BYPASS_DENIAL_FAILED'
  | 'UNAUTHORIZED_SIDE_EFFECT'
  | 'RECEIPT_CHAIN_FAILED'
  | 'PRIVATE_VALUE_VISIBLE'
  | 'GATEWAY_EXIT_FAILED'
  | 'SELF_CHECK_FAILED'
  | 'INTERNAL_ERROR';

const REPRODUCTION_FAILURE_CODES: readonly ReproductionFailureCode[] = [
  'PACKAGE_METADATA_UNAVAILABLE',
  'RUNTIME_MANIFEST_UNAVAILABLE',
  'GATEWAY_INITIALIZATION_FAILED',
  'CATALOG_VALIDATION_FAILED',
  'CAPABILITY_CAPTURE_FAILED',
  'BYPASS_DENIAL_FAILED',
  'UNAUTHORIZED_SIDE_EFFECT',
  'RECEIPT_CHAIN_FAILED',
  'PRIVATE_VALUE_VISIBLE',
  'GATEWAY_EXIT_FAILED',
  'SELF_CHECK_FAILED',
  'INTERNAL_ERROR',
] as const;

export interface ReproductionRuntimeManifest {
  readonly executionForm: 'compiled-javascript' | 'typescript-source';
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

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
    readonly name: string | null;
    readonly version: string | null;
  };
  readonly runtime: ReproductionRuntimeManifest | null;
  readonly summary: {
    readonly repeatedFlowCalls: number | null;
    readonly destinationAcceptedCalls: number | null;
    readonly bypassAttempts: number | null;
    readonly bypassesDenied: number | null;
    readonly privateValuesScanned: number | null;
    readonly privateValuesVisible: number | null;
    readonly durationMs: number;
  };
  readonly denials: readonly McpScenarioDenial[];
  readonly security: {
    readonly exactPersistedProjection: boolean | null;
    readonly processSeparationValid: boolean | null;
    readonly oneDispatchPerFlow: boolean | null;
    readonly receiptChainValid: boolean | null;
    readonly commitmentsDistinctAcrossRepetitions: boolean | null;
  };
  readonly receiptVerifier: McpOpaqueFlowReceiptVerifier | null;
  readonly receipts: readonly McpOpaqueFlowReceipt[];
  readonly failure: { readonly code: ReproductionFailureCode } | null;
  readonly limitations: readonly string[];
  readonly integrity: {
    readonly algorithm: 'SHA-256';
    readonly scope: 'canonical-bundle-without-integrity';
    readonly checksum: string;
    readonly authenticated: false;
  };
}

export interface ReproductionVerification {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly checks: {
    readonly schema: boolean;
    readonly checksum: boolean;
    readonly receiptChain: boolean;
    readonly reportedResults: boolean;
    readonly runtimeManifest: boolean;
    readonly relationshipDeclared: boolean;
    readonly operatorAuthenticated: false;
  };
  readonly repeatedFlowCalls: number | null;
  readonly bypassesDenied: number | null;
  readonly privateValuesVisible: number | null;
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

function runtimeFiles(root: string, directory: 'src' | 'dist', extension: '.ts' | '.js'): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(relative(root, absolute).split(sep).join('/'));
      }
    }
  };
  visit(join(root, directory));
  return files.sort();
}

function runtimeManifest(): ReproductionRuntimeManifest {
  const modulePath = fileURLToPath(import.meta.url);
  const compiled = modulePath.includes(`${sep}dist${sep}cli${sep}`);
  const rootUrl = new URL('../../', import.meta.url);
  const root = fileURLToPath(rootUrl);
  const paths = [
    ...runtimeFiles(root, compiled ? 'dist' : 'src', compiled ? '.js' : '.ts'),
    'bin/cli.js',
    'package.json',
  ];
  const files = paths.map((path) => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) throw new Error(`runtime manifest file is unavailable: ${path}`);
    return { path, sha256: sha256(readFileSync(absolute)) };
  });
  return {
    executionForm: compiled ? 'compiled-javascript' : 'typescript-source',
    files,
  };
}

function finalizeBundle(
  value: Omit<McpReproductionBundle, 'integrity'>,
): McpReproductionBundle {
  return {
    ...value,
    integrity: {
      algorithm: 'SHA-256',
      scope: 'canonical-bundle-without-integrity',
      checksum: sha256(canonicalJson(value)),
      authenticated: false,
    },
  };
}

function failureCode(cause: unknown): ReproductionFailureCode {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes('package metadata')) return 'PACKAGE_METADATA_UNAVAILABLE';
  if (message.includes('runtime manifest')) return 'RUNTIME_MANIFEST_UNAVAILABLE';
  if (message.includes('initialization')) return 'GATEWAY_INITIALIZATION_FAILED';
  if (message.includes('catalog validation')) return 'CATALOG_VALIDATION_FAILED';
  if (message.includes('capability')) return 'CAPABILITY_CAPTURE_FAILED';
  if (message.includes('bypass') && message.includes('denial')) return 'BYPASS_DENIAL_FAILED';
  if (message.includes('unauthorized destination side effect')) return 'UNAUTHORIZED_SIDE_EFFECT';
  if (message.includes('receipt chain')) return 'RECEIPT_CHAIN_FAILED';
  if (message.includes('private fixture value')) return 'PRIVATE_VALUE_VISIBLE';
  if (message.includes('gateway exited')) return 'GATEWAY_EXIT_FAILED';
  if (message.includes('self-check')) return 'SELF_CHECK_FAILED';
  return 'INTERNAL_ERROR';
}

function boundedJsonShape(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 50_000 || current.depth > 16) return false;
    if (typeof current.value === 'string') {
      if (current.value.length > 16_384) return false;
    } else if (Array.isArray(current.value)) {
      if (current.value.length > 1_000) return false;
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      const entries = Object.entries(current.value);
      if (entries.length > 100 || entries.some(([key]) => key.length > 128)) return false;
      for (const [, child] of entries) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
  errors: string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown[0]}`);
  if (missing.length > 0) errors.push(`${label} is missing field: ${missing[0]}`);
  return unknown.length === 0 && missing.length === 0;
}

function stringArray(value: unknown, expected?: readonly string[]): boolean {
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.length <= 128) &&
    (expected == null || canonicalJson(value) === canonicalJson(expected));
}

function hash(value: unknown, prefix = ''): boolean {
  return typeof value === 'string' && new RegExp(`^${prefix}[a-f0-9]{64}$`).test(value);
}

const RECEIPT_KEYS = [
  'receiptVersion', 'sequence', 'flow', 'artifactId', 'sourceTool', 'destinationTool',
  'destinationServer', 'destinationArgument', 'op', 'whereFields', 'projectionFields',
  'destinationArgumentNames', 'policyShapeSha256', 'policyLimits', 'items', 'payloadBytes',
  'commitmentAlgorithm', 'payloadCommitment', 'queryCommitment', 'destinationSucceeded',
  'destinationResultBytes', 'destinationResultCommitment', 'previousReceiptHash',
  'signingKeyId', 'disclosure', 'receiptHash', 'verifier', 'signature',
] as const;

function validReceiptShape(value: unknown, index: number, errors: string[]): value is McpOpaqueFlowReceipt {
  const label = `receipt ${index + 1}`;
  if (!exactKeys(value, RECEIPT_KEYS, [], label, errors)) return false;
  const receipt = value as Record<string, unknown>;
  let valid = true;
  const check = (condition: boolean, message: string): void => {
    if (!condition) {
      valid = false;
      errors.push(`${label} ${message}`);
    }
  };
  check(receipt.receiptVersion === 1, 'has invalid receiptVersion');
  check(receipt.sequence === index + 1, 'has invalid sequence');
  check(receipt.flow === 'deliver_active_accounts', 'has invalid flow');
  check(typeof receipt.artifactId === 'string' && /^vctx_[a-f0-9]{32}$/.test(receipt.artifactId), 'has invalid artifactId');
  check(receipt.sourceTool === 'accounts_list', 'has invalid sourceTool');
  check(receipt.destinationTool === 'campaign_deliver', 'has invalid destinationTool');
  check(receipt.destinationServer === 'demo-destination', 'has invalid destinationServer');
  check(receipt.destinationArgument === 'recipients', 'has invalid destinationArgument');
  check(receipt.op === 'json_select', 'has invalid operation');
  check(stringArray(receipt.whereFields, ['active']), 'has invalid whereFields');
  check(stringArray(receipt.projectionFields, ['email']), 'has invalid projectionFields');
  check(stringArray(receipt.destinationArgumentNames, ['campaign']), 'has invalid destinationArgumentNames');
  check(hash(receipt.policyShapeSha256), 'has invalid policyShapeSha256');
  if (exactKeys(receipt.policyLimits, ['maxItems', 'maxBytes'], [], `${label}.policyLimits`, errors)) {
    check(receipt.policyLimits.maxItems === 40 && receipt.policyLimits.maxBytes === 4_096, 'has invalid policyLimits');
  } else valid = false;
  check(receipt.items === 40, 'has invalid item count');
  check(typeof receipt.payloadBytes === 'number' && receipt.payloadBytes > 0, 'has invalid payloadBytes');
  check(receipt.commitmentAlgorithm === 'HMAC-SHA256', 'has invalid commitmentAlgorithm');
  check(hash(receipt.payloadCommitment, 'hmac-sha256:'), 'has invalid payloadCommitment');
  check(hash(receipt.queryCommitment, 'hmac-sha256:'), 'has invalid queryCommitment');
  check(receipt.destinationSucceeded === true, 'reports destination failure');
  check(typeof receipt.destinationResultBytes === 'number' && receipt.destinationResultBytes > 0, 'has invalid destinationResultBytes');
  check(hash(receipt.destinationResultCommitment, 'hmac-sha256:'), 'has invalid destinationResultCommitment');
  check(hash(receipt.previousReceiptHash), 'has invalid previousReceiptHash');
  check(hash(receipt.signingKeyId), 'has invalid signingKeyId');
  check(receipt.disclosure === 'receipt', 'has invalid disclosure');
  check(hash(receipt.receiptHash), 'has invalid receiptHash');
  if (exactKeys(receipt.verifier, ['algorithm', 'publicKey'], [], `${label}.verifier`, errors)) {
    check(
      receipt.verifier.algorithm === 'Ed25519' &&
      typeof receipt.verifier.publicKey === 'string' &&
      /^[A-Za-z0-9_-]{40,128}$/.test(receipt.verifier.publicKey),
      'has invalid verifier',
    );
  } else valid = false;
  check(typeof receipt.signature === 'string' && /^[A-Za-z0-9_-]{80,128}$/.test(receipt.signature), 'has invalid signature');
  return valid;
}

export async function runMcpReproduction(
  relationship: ReproductionRelationship,
  options: { readonly scenarioRunner?: typeof runMcpScenario } = {},
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
    limitations: REPRODUCTION_LIMITATIONS,
  };
  let identity: { name: string; version: string } | null = null;
  let runtime: ReproductionRuntimeManifest | null = null;
  let setupFailure: ReproductionFailureCode | undefined;
  try {
    identity = packageIdentity();
  } catch (cause) {
    setupFailure = failureCode(cause);
  }
  if (!setupFailure) {
    try {
      runtime = runtimeManifest();
    } catch (cause) {
      setupFailure = failureCode(cause);
    }
  }
  const failedBundle = (code: ReproductionFailureCode): McpReproductionBundle => {
    const completedAt = new Date().toISOString();
    return finalizeBundle({
      ...base,
      package: identity ?? { name: null, version: null },
      runtime,
      startedAt: fallbackStartedAt,
      completedAt,
      passed: false,
      summary: {
        repeatedFlowCalls: null,
        destinationAcceptedCalls: null,
        bypassAttempts: null,
        bypassesDenied: null,
        privateValuesScanned: null,
        privateValuesVisible: null,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(fallbackStartedAt)),
      },
      denials: [],
      security: {
        exactPersistedProjection: null,
        processSeparationValid: null,
        oneDispatchPerFlow: null,
        receiptChainValid: null,
        commitmentsDistinctAcrossRepetitions: null,
      },
      receiptVerifier: null,
      receipts: [],
      failure: { code },
    });
  };
  if (setupFailure) return failedBundle(setupFailure);
  try {
    const scenario = await (options.scenarioRunner ?? runMcpScenario)({
      flowCalls: 30,
      extendedBypasses: true,
    });
    const commitmentsDistinctAcrossRepetitions = new Set(
      scenario.receipts.map(({ payloadCommitment }) => payloadCommitment),
    ).size === scenario.receipts.length;
    return finalizeBundle({
      ...base,
      package: identity!,
      runtime: runtime!,
      startedAt: scenario.startedAt,
      completedAt: scenario.completedAt,
      passed: true,
      summary: {
        repeatedFlowCalls: scenario.receipts.length,
        destinationAcceptedCalls: scenario.destinationDispatches,
        bypassAttempts: scenario.bypassAttempts,
        bypassesDenied: scenario.bypassesDenied,
        privateValuesScanned: scenario.privateValuesScanned,
        privateValuesVisible: scenario.privateValuesVisible,
        durationMs: scenario.durationMs,
      },
      denials: scenario.denials,
      security: {
        exactPersistedProjection: scenario.projectionExact,
        processSeparationValid: scenario.processSeparationValid,
        oneDispatchPerFlow: scenario.destinationDispatches === scenario.receipts.length,
        receiptChainValid: true,
        commitmentsDistinctAcrossRepetitions,
      },
      receiptVerifier: scenario.receiptVerifier,
      receipts: scenario.receipts,
      failure: null,
    });
  } catch (cause) {
    return failedBundle(failureCode(cause));
  }
}

export function verifyMcpReproduction(value: unknown): ReproductionVerification {
  const errors: string[] = [];
  const warnings = [
    'Checksum and embedded receipt verifier do not authenticate the human operator or relationship.',
  ];
  const checks = {
    schema: false,
    checksum: false,
    receiptChain: false,
    reportedResults: false,
    runtimeManifest: false,
    relationshipDeclared: false,
    operatorAuthenticated: false as const,
  };
  let repeatedFlowCalls: number | null = null;
  let bypassesDenied: number | null = null;
  let privateValuesVisible: number | null = null;
  const result = (): ReproductionVerification => ({
    valid: checks.schema &&
      checks.checksum &&
      checks.receiptChain &&
      checks.reportedResults &&
      checks.runtimeManifest &&
      checks.relationshipDeclared &&
      errors.length === 0,
    errors,
    warnings,
    checks,
    repeatedFlowCalls,
    bypassesDenied,
    privateValuesVisible,
  });
  try {
    if (!boundedJsonShape(value)) {
      errors.push('bundle exceeds JSON depth, node, string, or collection bounds');
      return result();
    }
    const topKeys = [
      'schemaVersion', 'evidenceLevel', 'kind', 'runId', 'date', 'startedAt', 'completedAt',
      'passed', 'relationship', 'environment', 'package', 'runtime', 'summary', 'denials',
      'security', 'receiptVerifier', 'receipts', 'failure', 'limitations', 'integrity',
    ] as const;
    if (!isRecord(value)) {
      errors.push('bundle must be an object');
      return result();
    }
    const schemaErrors = errors.length;
    exactKeys(value, topKeys, [], 'bundle', errors);
    const bundle = value as unknown as McpReproductionBundle;
    if (bundle.schemaVersion !== 1) errors.push('unsupported schemaVersion');
    if (bundle.evidenceLevel !== 'self-contained-protocol-reproduction') errors.push('invalid evidenceLevel');
    if (bundle.kind !== 'mcp-value-opaque-flow-reproduction') errors.push('invalid kind');
    if (typeof bundle.runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(bundle.runId)) errors.push('invalid runId');
    for (const [label, dateValue] of [
      ['date', bundle.date], ['startedAt', bundle.startedAt], ['completedAt', bundle.completedAt],
    ] as const) {
      if (typeof dateValue !== 'string' || !Number.isFinite(Date.parse(dateValue))) errors.push(`invalid ${label}`);
    }
    const passedBundle = bundle.passed === true;
    const failedBundle = bundle.passed === false;
    if (!passedBundle && !failedBundle) errors.push('passed must be a boolean');
    checks.relationshipDeclared = REPRODUCTION_RELATIONSHIPS.includes(bundle.relationship);
    if (!checks.relationshipDeclared) errors.push('invalid relationship');

    if (exactKeys(bundle.environment, ['platform', 'release', 'architecture', 'node'], [], 'environment', errors)) {
      for (const key of ['platform', 'release', 'architecture', 'node'] as const) {
        if (typeof bundle.environment[key] !== 'string' || bundle.environment[key].length > 128) {
          errors.push(`invalid environment.${key}`);
        }
      }
    }
    if (exactKeys(bundle.package, ['name', 'version'], [], 'package', errors)) {
      const packageAvailable = bundle.package.name === '@codepalaiorg/pinpoint' &&
        typeof bundle.package.version === 'string';
      const packageUnavailable = failedBundle && bundle.package.name === null && bundle.package.version === null;
      if (!packageAvailable && !packageUnavailable) {
        errors.push('invalid package identity');
      }
    }
    if (bundle.runtime === null) {
      if (passedBundle) errors.push('passed bundle runtime manifest is missing');
    } else if (exactKeys(bundle.runtime, ['executionForm', 'files'], [], 'runtime', errors)) {
      if (!['compiled-javascript', 'typescript-source'].includes(String(bundle.runtime.executionForm))) {
        errors.push('invalid runtime.executionForm');
      }
      if (!Array.isArray(bundle.runtime.files) || bundle.runtime.files.length < 1 || bundle.runtime.files.length > 250) {
        errors.push('runtime manifest must contain 1 to 250 files');
      } else {
        for (const [index, file] of bundle.runtime.files.entries()) {
          if (!exactKeys(file, ['path', 'sha256'], [], `runtime.files[${index}]`, errors)) continue;
          if (typeof file.path !== 'string' || file.path.length > 128 || !hash(file.sha256)) {
            errors.push(`runtime.files[${index}] is invalid`);
          }
        }
      }
    }
    if (exactKeys(bundle.summary, [
      'repeatedFlowCalls', 'destinationAcceptedCalls', 'bypassAttempts', 'bypassesDenied',
      'privateValuesScanned', 'privateValuesVisible', 'durationMs',
    ], [], 'summary', errors)) {
      repeatedFlowCalls = typeof bundle.summary.repeatedFlowCalls === 'number'
        ? bundle.summary.repeatedFlowCalls : null;
      bypassesDenied = typeof bundle.summary.bypassesDenied === 'number'
        ? bundle.summary.bypassesDenied : null;
      privateValuesVisible = typeof bundle.summary.privateValuesVisible === 'number'
        ? bundle.summary.privateValuesVisible : null;
      if (typeof bundle.summary.durationMs !== 'number' || !Number.isFinite(bundle.summary.durationMs) || bundle.summary.durationMs < 0) {
        errors.push('summary.durationMs must be a finite non-negative number');
      }
    }
    const expectedDenials = [
      'direct-destination', 'direct-query', 'artifact-read', 'forged-capability',
      'operation-override', 'projection-override', 'fixed-predicate-override',
      'destination-argument-override',
    ];
    if (passedBundle) {
      if (bundle.failure !== null) errors.push('passed bundle must not contain a failure');
      if (!Array.isArray(bundle.denials) || bundle.denials.length !== expectedDenials.length) {
        errors.push('passed bundle must contain exactly 8 denial records');
      } else {
        for (const [index, denial] of bundle.denials.entries()) {
          if (!exactKeys(denial, ['id', 'outcome'], [], `denials[${index}]`, errors)) continue;
          if (denial.id !== expectedDenials[index] || denial.outcome !== 'denied') {
            errors.push(`denials[${index}] is invalid`);
          }
        }
      }
      if (exactKeys(bundle.security, [
        'exactPersistedProjection', 'processSeparationValid', 'oneDispatchPerFlow',
        'receiptChainValid', 'commitmentsDistinctAcrossRepetitions',
      ], [], 'security', errors)) {
        for (const field of Object.keys(bundle.security) as Array<keyof typeof bundle.security>) {
          if (bundle.security[field] !== true) errors.push(`security check failed: ${field}`);
        }
      }
      if (exactKeys(bundle.receiptVerifier, ['algorithm', 'publicKey', 'signingKeyId'], [], 'receiptVerifier', errors)) {
        if (
          bundle.receiptVerifier.algorithm !== 'Ed25519' ||
          typeof bundle.receiptVerifier.publicKey !== 'string' ||
          !hash(bundle.receiptVerifier.signingKeyId)
        ) errors.push('invalid receiptVerifier');
      }
    } else if (failedBundle) {
      if (!exactKeys(bundle.failure, ['code'], [], 'failure', errors)) {
        errors.push('failed bundle must contain a failure code');
      } else if (!REPRODUCTION_FAILURE_CODES.includes(bundle.failure.code)) {
        errors.push('failed bundle contains an invalid failure code');
      }
      if (!Array.isArray(bundle.denials) || bundle.denials.length !== 0) {
        errors.push('failed bundle denials must be empty');
      }
      if (!Array.isArray(bundle.receipts) || bundle.receipts.length !== 0) {
        errors.push('failed bundle receipts must be empty');
      }
      if (bundle.receiptVerifier !== null) errors.push('failed bundle receiptVerifier must be null');
      if (exactKeys(bundle.security, [
        'exactPersistedProjection', 'processSeparationValid', 'oneDispatchPerFlow',
        'receiptChainValid', 'commitmentsDistinctAcrossRepetitions',
      ], [], 'security', errors)) {
        for (const field of Object.keys(bundle.security) as Array<keyof typeof bundle.security>) {
          if (bundle.security[field] !== null) errors.push(`failed bundle security.${field} must be null`);
        }
      }
      for (const [field, metric] of Object.entries(bundle.summary)) {
        if (field !== 'durationMs' && metric !== null) {
          errors.push(`failed bundle summary.${field} must be null`);
        }
      }
    }
    if (!stringArray(bundle.limitations, REPRODUCTION_LIMITATIONS)) errors.push('limitations do not match the reviewed boundary');
    if (exactKeys(bundle.integrity, ['algorithm', 'scope', 'checksum', 'authenticated'], [], 'integrity', errors)) {
      if (
        bundle.integrity.algorithm !== 'SHA-256' ||
        bundle.integrity.scope !== 'canonical-bundle-without-integrity' ||
        bundle.integrity.authenticated !== false ||
        !hash(bundle.integrity.checksum)
      ) errors.push('invalid integrity block');
    }
    checks.schema = errors.length === schemaErrors;

    const { integrity, ...unsigned } = bundle;
    checks.checksum = isRecord(integrity) &&
      integrity.checksum === sha256(canonicalJson(unsigned));
    if (!checks.checksum) errors.push('bundle checksum does not match content');

    try {
      checks.runtimeManifest = canonicalJson(bundle.runtime) === canonicalJson(runtimeManifest()) &&
        bundle.package.name === packageIdentity().name &&
        bundle.package.version === packageIdentity().version;
    } catch {
      checks.runtimeManifest = false;
    }
    if (!checks.runtimeManifest) errors.push('runtime manifest does not match this verifier package');

    const receipts = Array.isArray(bundle.receipts) ? bundle.receipts : [];
    if (passedBundle) {
      if (receipts.length !== 30) {
        errors.push('expected exactly 30 receipts before cryptographic verification');
      } else {
        const shapeErrors = errors.length;
        const shaped = receipts.every((receipt, index) => validReceiptShape(receipt, index, errors));
        if (shaped && errors.length === shapeErrors && isRecord(bundle.receiptVerifier)) {
          const verifier = bundle.receiptVerifier as McpOpaqueFlowReceiptVerifier;
          let previousReceiptHash = '0'.repeat(64);
          checks.receiptChain = receipts.every((receipt, index) => {
            const valid = verifyMcpOpaqueFlowReceipt(receipt, verifier) &&
              receipt.sequence === index + 1 &&
              receipt.previousReceiptHash === previousReceiptHash;
            previousReceiptHash = receipt.receiptHash;
            return valid;
          });
        }
        if (!checks.receiptChain) errors.push('receipt signature or chain verification failed');
      }

      checks.reportedResults = repeatedFlowCalls === 30 &&
        bundle.summary.destinationAcceptedCalls === 30 &&
        bundle.summary.bypassAttempts === 8 &&
        bypassesDenied === 8 &&
        bundle.summary.privateValuesScanned === 401 &&
        privateValuesVisible === 0 &&
        bundle.denials.length === 8 &&
        bundle.security.exactPersistedProjection === true &&
        bundle.security.processSeparationValid === true &&
        bundle.security.oneDispatchPerFlow === true &&
        bundle.security.receiptChainValid === true &&
        bundle.security.commitmentsDistinctAcrossRepetitions === true;
      if (!checks.reportedResults) errors.push('reported reproduction checks do not pass');
    }
    return result();
  } catch {
    errors.push('bundle validation raised an internal error');
    return result();
  }
}