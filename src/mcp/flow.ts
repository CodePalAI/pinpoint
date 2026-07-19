import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as signValue,
  verify as verifyValue,
  type KeyObject,
} from 'node:crypto';

import type { VirtualContextDescriptor, VirtualContextQuery } from '../virtual-context/store.js';
import type { McpCallToolResult } from './gateway.js';
import { isValidMcpCallToolResult } from './tool-result.js';

export const MCP_FLOW_TOOL_NAME = 'pinpoint_flow';

export type McpOpaqueFlowOperation = 'json_select' | 'count' | 'grep' | 'slice';

export interface McpOpaqueFlowPolicy {
  readonly name: string;
  readonly description?: string;
  readonly sourceTool: string;
  readonly sourceKind?: VirtualContextDescriptor['kind'];
  readonly destinationTool: string;
  readonly destinationArgument: string;
  readonly fixedDestinationArguments?: Readonly<Record<string, unknown>>;
  readonly allowedDestinationArguments?: readonly string[];
  readonly allowedOps: readonly McpOpaqueFlowOperation[];
  readonly fixedWhere?: Readonly<Record<string, string | number | boolean | null>>;
  readonly allowedWhereFields?: readonly string[];
  readonly allowedFields?: readonly string[];
  readonly maxItems?: number;
  readonly maxBytes?: number;
  readonly maxDestinationArgumentBytes?: number;
  readonly hideDestinationTool?: boolean;
}

export interface McpOpaqueFlowConfig {
  readonly version: 1;
  readonly exposeQueryTool: boolean;
  readonly exposeArtifactResources: boolean;
  readonly opaqueArtifactIds: boolean;
  readonly flows: readonly McpOpaqueFlowPolicy[];
}

export interface McpArtifactInfo {
  readonly descriptor: VirtualContextDescriptor;
  readonly sourceTool: string;
}

export interface McpFlowArtifactAccess {
  artifactInfo(id: string): McpArtifactInfo | undefined;
  queryArtifact(input: VirtualContextQuery): string;
}

export interface PreparedMcpOpaqueFlow {
  readonly policy: McpOpaqueFlowPolicy;
  readonly artifactId: string;
  readonly query: VirtualContextQuery;
  readonly destinationArguments: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
  readonly items: number;
  readonly payloadBytes: number;
  readonly payloadCanonical: string;
  readonly queryCanonical: string;
}

export interface McpOpaqueFlowReceipt {
  readonly receiptVersion: 1;
  readonly sequence: number;
  readonly flow: string;
  readonly artifactId: string;
  readonly sourceTool: string;
  readonly destinationTool: string;
  readonly destinationServer?: string;
  readonly destinationArgument: string;
  readonly op: McpOpaqueFlowOperation;
  readonly whereFields: readonly string[];
  readonly projectionFields: readonly string[];
  readonly destinationArgumentNames: readonly string[];
  readonly policyShapeSha256: string;
  readonly policyLimits: {
    readonly maxItems: number;
    readonly maxBytes: number;
  };
  readonly items: number;
  readonly payloadBytes: number;
  readonly commitmentAlgorithm: 'HMAC-SHA256';
  readonly payloadCommitment: string;
  readonly queryCommitment: string;
  readonly destinationSucceeded: boolean;
  readonly destinationResultBytes: number;
  readonly destinationResultCommitment: string;
  readonly previousReceiptHash: string;
  readonly signingKeyId: string;
  readonly receiptHash: string;
  readonly verifier: {
    readonly algorithm: 'Ed25519';
    readonly publicKey: string;
    readonly authority?: McpOpaqueFlowAuthorityBinding;
  };
  readonly signature: string;
  readonly disclosure: 'receipt';
}

export interface McpOpaqueFlowReceiptVerifier {
  readonly algorithm: 'Ed25519';
  readonly publicKey: string;
  readonly signingKeyId: string;
  readonly authority?: McpOpaqueFlowAuthorityBinding;
}

export interface McpOpaqueFlowAuthorityVerifier {
  readonly algorithm: 'Ed25519';
  readonly publicKey: string;
  readonly operatorKeyId: string;
}

export interface McpOpaqueFlowAuthorityBinding {
  readonly authorityVersion: 1;
  readonly domain: 'pinpoint.mcp.opaque-flow.session';
  readonly operatorKeyId: string;
  readonly sessionSigningKeyId: string;
  readonly sessionPublicKey: string;
  readonly policyNonce: string;
  readonly policyCommitmentAlgorithm: 'Ed25519-SHA256';
  readonly policyCommitment: string;
  readonly verifier: {
    readonly algorithm: 'Ed25519';
    readonly publicKey: string;
  };
  readonly signature: string;
}

export interface McpOpaqueFlowPolicyOpening {
  readonly policyAuthorizationSignature: string;
}

export interface McpOpaqueFlowAuthorityRecord {
  readonly authority: McpOpaqueFlowAuthorityBinding;
  readonly opening: McpOpaqueFlowPolicyOpening;
  readonly policy: unknown;
}

export interface McpOpaqueFlowAuthorityDestinationIdentity {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly envNames?: readonly string[];
  readonly sharedEnvNames?: readonly string[];
}

export interface McpOpaqueFlowEngineOptions {
  readonly authoritySigningKey?: KeyObject;
  readonly authorityPolicy?: unknown;
  readonly destinationServerId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function policyShape(policy: McpOpaqueFlowPolicy): Record<string, unknown> {
  return {
    name: policy.name,
    sourceTool: policy.sourceTool,
    sourceKind: policy.sourceKind ?? null,
    destinationTool: policy.destinationTool,
    destinationArgument: policy.destinationArgument,
    fixedDestinationArgumentNames: Object.keys(policy.fixedDestinationArguments ?? {}).sort(),
    allowedDestinationArguments: [...(policy.allowedDestinationArguments ?? [])].sort(),
    allowedOps: [...policy.allowedOps].sort(),
    fixedWhereFields: Object.keys(policy.fixedWhere ?? {}).sort(),
    allowedWhereFields: [...(policy.allowedWhereFields ?? [])].sort(),
    allowedFields: [...(policy.allowedFields ?? [])].sort(),
    maxItems: policy.maxItems,
    maxBytes: policy.maxBytes,
    maxDestinationArgumentBytes: policy.maxDestinationArgumentBytes,
    hideDestinationTool: policy.hideDestinationTool,
  };
}

function receiptAttestation(receipt: McpOpaqueFlowReceipt): Omit<
  McpOpaqueFlowReceipt,
  'receiptHash' | 'verifier' | 'signature'
> {
  const { receiptHash: _hash, verifier: _verifier, signature: _signature, ...attestation } = receipt;
  return attestation;
}

function authorityAttestation(binding: McpOpaqueFlowAuthorityBinding): Omit<
  McpOpaqueFlowAuthorityBinding,
  'verifier' | 'signature'
> {
  const { verifier: _verifier, signature: _signature, ...attestation } = binding;
  return attestation;
}

function policyAuthorizationText(policy: unknown, policyNonce: string): string {
  return canonicalJson({ domain: 'pinpoint.mcp.opaque-flow.policy', policyNonce, policy });
}

export function verifyMcpOpaqueFlowAuthorityBinding(
  value: unknown,
  expectedAuthority?: McpOpaqueFlowAuthorityVerifier,
  expectedSession?: Pick<McpOpaqueFlowReceiptVerifier, 'publicKey' | 'signingKeyId'>,
): value is McpOpaqueFlowAuthorityBinding {
  if (!isRecord(value) || !isRecord(value.verifier)) return false;
  try {
    const binding = value as unknown as McpOpaqueFlowAuthorityBinding;
    if (
      binding.authorityVersion !== 1 ||
      binding.domain !== 'pinpoint.mcp.opaque-flow.session' ||
      binding.policyCommitmentAlgorithm !== 'Ed25519-SHA256' ||
      !/^sha256:[a-f0-9]{64}$/.test(binding.policyCommitment) ||
      binding.verifier.algorithm !== 'Ed25519' ||
      typeof binding.verifier.publicKey !== 'string' ||
      typeof binding.operatorKeyId !== 'string' ||
      typeof binding.sessionSigningKeyId !== 'string' ||
      typeof binding.sessionPublicKey !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(binding.policyNonce) ||
      typeof binding.signature !== 'string'
    ) {
      return false;
    }
    const operatorPublicKeyBytes = Buffer.from(binding.verifier.publicKey, 'base64url');
    const operatorKeyId = createHash('sha256').update(operatorPublicKeyBytes).digest('hex');
    const sessionPublicKeyBytes = Buffer.from(binding.sessionPublicKey, 'base64url');
    const sessionKeyId = createHash('sha256').update(sessionPublicKeyBytes).digest('hex');
    if (operatorKeyId !== binding.operatorKeyId || sessionKeyId !== binding.sessionSigningKeyId) return false;
    if (
      expectedAuthority != null &&
      (
        expectedAuthority.algorithm !== 'Ed25519' ||
        expectedAuthority.publicKey !== binding.verifier.publicKey ||
        expectedAuthority.operatorKeyId !== binding.operatorKeyId
      )
    ) {
      return false;
    }
    if (
      expectedSession != null &&
      (
        expectedSession.publicKey !== binding.sessionPublicKey ||
        expectedSession.signingKeyId !== binding.sessionSigningKeyId
      )
    ) {
      return false;
    }
    const operatorPublicKey = createPublicKey({ key: operatorPublicKeyBytes, format: 'der', type: 'spki' });
    return verifyValue(
      null,
      Buffer.from(canonicalJson(authorityAttestation(binding))),
      operatorPublicKey,
      Buffer.from(binding.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function verifyMcpOpaqueFlowPolicyOpening(
  binding: unknown,
  policy: unknown,
  opening: unknown,
): opening is McpOpaqueFlowPolicyOpening {
  if (!verifyMcpOpaqueFlowAuthorityBinding(binding) || !isRecord(opening)) return false;
  try {
    const signature = opening.policyAuthorizationSignature;
    if (typeof signature !== 'string') return false;
    const signatureBytes = Buffer.from(signature, 'base64url');
    if (`sha256:${createHash('sha256').update(signatureBytes).digest('hex')}` !== binding.policyCommitment) {
      return false;
    }
    const publicKeyBytes = Buffer.from(binding.verifier.publicKey, 'base64url');
    const publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' });
    return verifyValue(
      null,
      Buffer.from(policyAuthorizationText(policy, binding.policyNonce)),
      publicKey,
      signatureBytes,
    );
  } catch {
    return false;
  }
}

export function verifyMcpOpaqueFlowReceipt(
  value: unknown,
  expectedVerifier?: McpOpaqueFlowReceiptVerifier,
  expectedAuthority?: McpOpaqueFlowAuthorityVerifier,
): value is McpOpaqueFlowReceipt {
  if (!isRecord(value) || !isRecord(value.verifier)) return false;
  try {
    const receipt = value as unknown as McpOpaqueFlowReceipt;
    if (
      receipt.receiptVersion !== 1 ||
      receipt.verifier.algorithm !== 'Ed25519' ||
      typeof receipt.verifier.publicKey !== 'string' ||
      typeof receipt.signingKeyId !== 'string' ||
      typeof receipt.receiptHash !== 'string' ||
      typeof receipt.signature !== 'string'
    ) {
      return false;
    }
    const publicKeyBytes = Buffer.from(receipt.verifier.publicKey, 'base64url');
    const keyId = createHash('sha256').update(publicKeyBytes).digest('hex');
    if (keyId !== receipt.signingKeyId) return false;
    if (
      receipt.verifier.authority != null &&
      !verifyMcpOpaqueFlowAuthorityBinding(
        receipt.verifier.authority,
        expectedAuthority,
        { publicKey: receipt.verifier.publicKey, signingKeyId: receipt.signingKeyId },
      )
    ) {
      return false;
    }
    if (expectedAuthority != null && receipt.verifier.authority == null) return false;
    if (
      expectedVerifier != null &&
      (
        expectedVerifier.algorithm !== 'Ed25519' ||
        expectedVerifier.publicKey !== receipt.verifier.publicKey ||
        expectedVerifier.signingKeyId !== receipt.signingKeyId ||
        (expectedVerifier.authority == null) !== (receipt.verifier.authority == null) ||
        canonicalJson(expectedVerifier.authority) !== canonicalJson(receipt.verifier.authority)
      )
    ) {
      return false;
    }
    const attestation = canonicalJson(receiptAttestation(receipt));
    if (sha256(attestation) !== receipt.receiptHash) return false;
    const publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' });
    return verifyValue(
      null,
      Buffer.from(attestation),
      publicKey,
      Buffer.from(receipt.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

function boundedStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 256)
  ) {
    throw new TypeError(`${field} must contain at most 32 non-empty strings`);
  }
  return value;
}

function boundedInteger(value: unknown, field: string, max: number): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new TypeError(`${field} must be an integer from 0 to ${max}`);
  }
  return value as number;
}

function validateName(value: string, field: string, pattern: RegExp): void {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`invalid ${field}: ${String(value)}`);
  }
}

function uniqueStrings(values: readonly string[] | undefined, field: string): readonly string[] | undefined {
  if (values == null) return undefined;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > 64 ||
    new Set(values).size !== values.length
  ) {
    throw new TypeError(`${field} must contain 1 to 64 unique values`);
  }
  for (const value of values) validateName(value, field, /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);
  return [...values];
}

function normalizePolicy(policy: McpOpaqueFlowPolicy): McpOpaqueFlowPolicy {
  if (!isRecord(policy)) throw new TypeError('each opaque flow policy must be an object');
  const allowedKeys = new Set([
    'name',
    'description',
    'sourceTool',
    'sourceKind',
    'destinationTool',
    'destinationArgument',
    'fixedDestinationArguments',
    'allowedDestinationArguments',
    'allowedOps',
    'fixedWhere',
    'allowedWhereFields',
    'allowedFields',
    'maxItems',
    'maxBytes',
    'maxDestinationArgumentBytes',
    'hideDestinationTool',
  ]);
  const unknownKeys = Object.keys(policy).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`unknown opaque flow policy field: ${unknownKeys.join(', ')}`);
  }
  if (policy.description != null && (typeof policy.description !== 'string' || policy.description.length > 512)) {
    throw new TypeError(`flow ${String(policy.name)} description must be at most 512 characters`);
  }
  validateName(policy.name, 'flow name', /^[a-z][a-z0-9_-]{0,63}$/);
  validateName(policy.sourceTool, 'source tool', /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);
  validateName(policy.destinationTool, 'destination tool', /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/);
  validateName(policy.destinationArgument, 'destination argument', /^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
  if (policy.sourceKind != null && !['json-array', 'json-object', 'lines'].includes(policy.sourceKind)) {
    throw new TypeError(`unsupported source kind: ${String(policy.sourceKind)}`);
  }
  if (policy.sourceTool === MCP_FLOW_TOOL_NAME || policy.destinationTool === MCP_FLOW_TOOL_NAME) {
    throw new TypeError(`${MCP_FLOW_TOOL_NAME} cannot be a flow source or destination`);
  }
  if (policy.sourceTool === policy.destinationTool) {
    throw new TypeError(`flow ${policy.name} source and destination tools must differ`);
  }
  if (
    !Array.isArray(policy.allowedOps) ||
    policy.allowedOps.length === 0 ||
    new Set(policy.allowedOps).size !== policy.allowedOps.length
  ) {
    throw new TypeError(`flow ${policy.name} must declare unique allowed operations`);
  }
  for (const op of policy.allowedOps) {
    if (!['json_select', 'count', 'grep', 'slice'].includes(op)) {
      throw new TypeError(`unsupported flow operation: ${op}`);
    }
  }
  const maxItems = policy.maxItems ?? 100;
  const maxBytes = policy.maxBytes ?? 64 * 1024;
  const maxDestinationArgumentBytes = policy.maxDestinationArgumentBytes ?? 16 * 1024;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) {
    throw new TypeError(`flow ${policy.name} maxItems must be from 1 to 100`);
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 10 * 1024 * 1024) {
    throw new TypeError(`flow ${policy.name} maxBytes must be from 1 to 10485760`);
  }
  if (
    !Number.isInteger(maxDestinationArgumentBytes) ||
    maxDestinationArgumentBytes < 1 ||
    maxDestinationArgumentBytes > 1024 * 1024
  ) {
    throw new TypeError(`flow ${policy.name} maxDestinationArgumentBytes must be from 1 to 1048576`);
  }
  if (policy.hideDestinationTool != null && typeof policy.hideDestinationTool !== 'boolean') {
    throw new TypeError(`flow ${policy.name} hideDestinationTool must be a boolean`);
  }
  const allowedDestinationArguments = uniqueStrings(
    policy.allowedDestinationArguments,
    'allowedDestinationArguments',
  );
  const allowedWhereFields = uniqueStrings(policy.allowedWhereFields, 'allowedWhereFields');
  const allowedFields = uniqueStrings(policy.allowedFields, 'allowedFields');
  const fixedWhere = policy.fixedWhere == null
    ? undefined
    : JSON.parse(canonicalJson(policy.fixedWhere)) as Record<string, unknown>;
  if (
    fixedWhere != null &&
    (
      !isRecord(fixedWhere) ||
      Object.keys(fixedWhere).length === 0 ||
      Object.keys(fixedWhere).length > 16 ||
      Object.keys(fixedWhere).some((field) => !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field)) ||
      Object.values(fixedWhere).some((value) => !isJsonPrimitive(value))
    )
  ) {
    throw new TypeError(`flow ${policy.name} fixedWhere must contain 1 to 16 exact JSON primitive fields`);
  }
  const whereOverlap = allowedWhereFields?.filter((field) => Object.hasOwn(fixedWhere ?? {}, field)) ?? [];
  if (whereOverlap.length > 0) {
    throw new TypeError(`flow ${policy.name} fixed and dynamic where fields overlap: ${whereOverlap.join(', ')}`);
  }
  if (policy.allowedOps.includes('json_select') && allowedFields == null) {
    throw new TypeError(`flow ${policy.name} must allowlist fields for json_select`);
  }
  const fixedDestinationArguments = policy.fixedDestinationArguments == null
    ? undefined
    : JSON.parse(canonicalJson(policy.fixedDestinationArguments)) as Record<string, unknown>;
  if (fixedDestinationArguments != null && !isRecord(fixedDestinationArguments)) {
    throw new TypeError(`flow ${policy.name} fixedDestinationArguments must be an object`);
  }
  const reservedDestinationArguments = new Set([
    policy.destinationArgument,
    ...Object.keys(fixedDestinationArguments ?? {}),
  ]);
  const overlap = allowedDestinationArguments?.filter((name) => reservedDestinationArguments.has(name)) ?? [];
  if (overlap.length > 0 || Object.hasOwn(fixedDestinationArguments ?? {}, policy.destinationArgument)) {
    throw new TypeError(`flow ${policy.name} destination argument policy overlaps a fixed or payload argument`);
  }
  return {
    ...policy,
    allowedOps: [...policy.allowedOps],
    ...(allowedWhereFields ? { allowedWhereFields } : {}),
    ...(fixedWhere ? { fixedWhere: fixedWhere as McpOpaqueFlowPolicy['fixedWhere'] } : {}),
    ...(allowedFields ? { allowedFields } : {}),
    ...(fixedDestinationArguments ? { fixedDestinationArguments } : {}),
    ...(allowedDestinationArguments ? { allowedDestinationArguments } : {}),
    maxItems,
    maxBytes,
    maxDestinationArgumentBytes,
    hideDestinationTool: policy.hideDestinationTool ?? true,
  };
}

export function parseMcpOpaqueFlowConfig(value: unknown): McpOpaqueFlowConfig {
  if (!isRecord(value)) throw new TypeError('opaque flow config must be a JSON object');
  const allowedKeys = new Set([
    'version',
    'exposeQueryTool',
    'exposeArtifactResources',
    'opaqueArtifactIds',
    'flows',
  ]);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`unknown opaque flow config field: ${unknownKeys.join(', ')}`);
  }
  if (value.version !== 1) throw new TypeError('opaque flow config version must be 1');
  if (!Array.isArray(value.flows) || value.flows.length === 0 || value.flows.length > 64) {
    throw new TypeError('opaque flow config must contain 1 to 64 flows');
  }
  for (const field of ['exposeQueryTool', 'exposeArtifactResources', 'opaqueArtifactIds'] as const) {
    if (value[field] != null && typeof value[field] !== 'boolean') {
      throw new TypeError(`${field} must be a boolean`);
    }
  }
  const flows = value.flows.map((policy) => normalizePolicy(policy as McpOpaqueFlowPolicy));
  if (new Set(flows.map(({ name }) => name)).size !== flows.length) {
    throw new TypeError('opaque flow names must be unique');
  }
  return {
    version: 1,
    exposeQueryTool: value.exposeQueryTool === true,
    exposeArtifactResources: value.exposeArtifactResources === true,
    opaqueArtifactIds: value.opaqueArtifactIds !== false,
    flows,
  };
}

export function createMcpOpaqueFlowAuthorityPolicy(
  config: McpOpaqueFlowConfig,
  destination?: McpOpaqueFlowAuthorityDestinationIdentity,
): Record<string, unknown> {
  const normalized = parseMcpOpaqueFlowConfig(config);
  return {
    ...normalized,
    ...(destination ? {
      destination: {
        id: destination.id,
        command: destination.command,
        args: [...(destination.args ?? [])],
        cwd: destination.cwd ?? null,
        envNames: [...(destination.envNames ?? [])].sort(),
        sharedEnvNames: [...(destination.sharedEnvNames ?? [])].sort(),
      },
    } : {}),
  };
}

function ensureSubset(requested: readonly string[], allowed: readonly string[] | undefined, field: string): void {
  if (allowed == null) return;
  const allow = new Set(allowed);
  const denied = requested.filter((value) => !allow.has(value));
  if (denied.length > 0) throw new TypeError(`${field} not allowed by flow policy: ${denied.join(', ')}`);
}

function queryPayload(op: McpOpaqueFlowOperation, parsed: Record<string, unknown>): unknown {
  switch (op) {
    case 'json_select':
    case 'grep':
      if (!Array.isArray(parsed.matches)) throw new TypeError(`${op} did not return matches`);
      return parsed.matches;
    case 'slice':
      if (!Array.isArray(parsed.items)) throw new TypeError('slice did not return items');
      return parsed.items;
    case 'count':
      if (typeof parsed.count !== 'number') throw new TypeError('count did not return a number');
      return parsed.count;
  }
}

function payloadItems(payload: unknown): number {
  return Array.isArray(payload) ? payload.length : 1;
}

function flowError(message: string): McpCallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export class McpOpaqueFlowEngine {
  private readonly policies = new Map<string, McpOpaqueFlowPolicy>();
  private readonly commitmentKey = randomBytes(32);
  private readonly signingKey: KeyObject;
  private readonly publicKey: string;
  private readonly signingKeyId: string;
  private readonly authorityBinding?: McpOpaqueFlowAuthorityBinding;
  private readonly policyOpening?: McpOpaqueFlowPolicyOpening;
  private readonly authorityPolicy?: unknown;
  private readonly destinationServerId?: string;
  private sequence = 0;
  private previousReceiptHash = '0'.repeat(64);

  constructor(
    private readonly artifacts: McpFlowArtifactAccess,
    policies: readonly McpOpaqueFlowPolicy[],
    options: McpOpaqueFlowEngineOptions = {},
  ) {
    if (
      options.destinationServerId != null &&
      !/^[a-z][a-z0-9_-]{0,63}$/.test(options.destinationServerId)
    ) {
      throw new TypeError(`invalid opaque-flow destination server id: ${options.destinationServerId}`);
    }
    this.destinationServerId = options.destinationServerId;
    const pair = generateKeyPairSync('ed25519');
    this.signingKey = pair.privateKey;
    const publicKeyBytes = pair.publicKey.export({ type: 'spki', format: 'der' });
    this.publicKey = publicKeyBytes.toString('base64url');
    this.signingKeyId = createHash('sha256').update(publicKeyBytes).digest('hex');
    for (const raw of policies) {
      const policy = normalizePolicy(raw);
      if (this.policies.has(policy.name)) throw new TypeError(`duplicate flow name: ${policy.name}`);
      this.policies.set(policy.name, policy);
    }
    if (this.policies.size === 0) throw new TypeError('at least one opaque flow policy is required');
    if (options.authoritySigningKey != null) {
      if (options.authoritySigningKey.type !== 'private' || options.authoritySigningKey.asymmetricKeyType !== 'ed25519') {
        throw new TypeError('opaque-flow authority key must be an Ed25519 private key');
      }
      const authorityPublicKey = createPublicKey(options.authoritySigningKey);
      const authorityPublicKeyBytes = authorityPublicKey.export({ type: 'spki', format: 'der' });
      const operatorPublicKey = authorityPublicKeyBytes.toString('base64url');
      const operatorKeyId = createHash('sha256').update(authorityPublicKeyBytes).digest('hex');
      const authorityPolicy = JSON.parse(canonicalJson(
        options.authorityPolicy ?? { flows: [...this.policies.values()] },
      )) as unknown;
      this.authorityPolicy = authorityPolicy;
      const policyNonce = randomBytes(32).toString('base64url');
      const policyAuthorizationSignature = signValue(
        null,
        Buffer.from(policyAuthorizationText(authorityPolicy, policyNonce)),
        options.authoritySigningKey,
      ).toString('base64url');
      const bindingAttestation: Omit<McpOpaqueFlowAuthorityBinding, 'verifier' | 'signature'> = {
        authorityVersion: 1,
        domain: 'pinpoint.mcp.opaque-flow.session',
        operatorKeyId,
        sessionSigningKeyId: this.signingKeyId,
        sessionPublicKey: this.publicKey,
        policyNonce,
        policyCommitmentAlgorithm: 'Ed25519-SHA256',
        policyCommitment: `sha256:${createHash('sha256')
          .update(Buffer.from(policyAuthorizationSignature, 'base64url'))
          .digest('hex')}`,
      };
      this.authorityBinding = {
        ...bindingAttestation,
        verifier: { algorithm: 'Ed25519', publicKey: operatorPublicKey },
        signature: signValue(
          null,
          Buffer.from(canonicalJson(bindingAttestation)),
          options.authoritySigningKey,
        ).toString('base64url'),
      };
      this.policyOpening = { policyAuthorizationSignature };
    }
  }

  private commitment(domain: string, sequence: number, value: string): string {
    const digest = createHmac('sha256', this.commitmentKey)
      .update(domain)
      .update('\0')
      .update(String(sequence))
      .update('\0')
      .update(value)
      .digest('hex');
    return `hmac-sha256:${digest}`;
  }

  get receiptVerifier(): McpOpaqueFlowReceiptVerifier {
    return {
      algorithm: 'Ed25519',
      publicKey: this.publicKey,
      signingKeyId: this.signingKeyId,
      ...(this.authorityBinding ? { authority: this.authorityBinding } : {}),
    };
  }

  get authorityVerifier(): McpOpaqueFlowAuthorityVerifier | undefined {
    const binding = this.authorityBinding;
    return binding == null ? undefined : {
      algorithm: 'Ed25519',
      publicKey: binding.verifier.publicKey,
      operatorKeyId: binding.operatorKeyId,
    };
  }

  get authorityPolicyOpening(): McpOpaqueFlowPolicyOpening | undefined {
    return this.policyOpening;
  }

  get authorityRecord(): McpOpaqueFlowAuthorityRecord | undefined {
    return this.authorityBinding && this.policyOpening && this.authorityPolicy
      ? {
          authority: this.authorityBinding,
          opening: this.policyOpening,
          policy: this.authorityPolicy,
        }
      : undefined;
  }

  get hiddenDestinationTools(): ReadonlySet<string> {
    return new Set(
      [...this.policies.values()]
        .filter(({ hideDestinationTool }) => hideDestinationTool === true)
        .map(({ destinationTool }) => destinationTool),
    );
  }

  validateSourceToolCatalog(toolNames: ReadonlySet<string>): void {
    const missing = [...this.policies.values()]
      .map(({ sourceTool }) => sourceTool)
      .filter((name, index, names) => !toolNames.has(name) && names.indexOf(name) === index);
    if (missing.length > 0) {
      throw new TypeError(`opaque flow policy references missing source tools: ${missing.join(', ')}`);
    }
  }

  validateDestinationToolCatalog(toolNames: ReadonlySet<string>): void {
    const missing = [...this.policies.values()]
      .map(({ destinationTool }) => destinationTool)
      .filter((name, index, names) => !toolNames.has(name) && names.indexOf(name) === index);
    if (missing.length > 0) {
      throw new TypeError(`opaque flow policy references missing destination tools: ${missing.join(', ')}`);
    }
  }

  validateToolCatalog(toolNames: ReadonlySet<string>): void {
    this.validateSourceToolCatalog(toolNames);
    this.validateDestinationToolCatalog(toolNames);
  }

  get tool(): Record<string, unknown> {
    const flows = [...this.policies.values()];
    const descriptions = flows
      .map((policy) => {
        const where = policy.allowedWhereFields?.join(',') || 'none';
        const fixedWhere = Object.keys(policy.fixedWhere ?? {}).join(',') || 'none';
        const fields = policy.allowedFields?.join(',') || 'not applicable';
        const destinationArgs = policy.allowedDestinationArguments?.join(',') || 'none';
        return (
          `${policy.name}: ${policy.sourceTool} -> ${policy.destinationTool}.${policy.destinationArgument}; ` +
          `ops=${policy.allowedOps.join(',')}; fixedWhere=${fixedWhere}; dynamicWhere=${where}; ` +
          `fields=${fields}; destinationArgs=${destinationArgs}`
        );
      })
      .join('; ');
    const operations = [...new Set(flows.flatMap(({ allowedOps }) => allowedOps))];
    const whereFields = [...new Set(flows.flatMap(({ allowedWhereFields }) => allowedWhereFields ?? []))];
    const projectionFields = [...new Set(flows.flatMap(({ allowedFields }) => allowedFields ?? []))];
    const destinationArgumentNames = [
      ...new Set(flows.flatMap(({ allowedDestinationArguments }) => allowedDestinationArguments ?? [])),
    ];
    const primitiveSchema = {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
    };
    return {
      name: MCP_FLOW_TOOL_NAME,
      description:
        'Execute a configured opaque dataflow. Pinpoint queries an exact local artifact and passes the ' +
        'selected value into an allowlisted upstream destination tool without exposing that value to the model. ' +
        `The result is a value-free cryptographic receipt. Configured flows: ${descriptions}`,
      inputSchema: {
        type: 'object',
        properties: {
          flow: { type: 'string', enum: flows.map(({ name }) => name) },
          id: { type: 'string', pattern: '^vctx_[a-f0-9]{32,64}$' },
          op: { type: 'string', enum: operations },
          where: {
            type: 'object',
            properties: Object.fromEntries(whereFields.map((field) => [field, primitiveSchema])),
            additionalProperties: false,
          },
          fields: {
            type: 'array',
            items: { type: 'string', ...(projectionFields.length > 0 ? { enum: projectionFields } : {}) },
            maxItems: 32,
          },
          query: { type: 'string', minLength: 1, maxLength: 512 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 0, maximum: 100 },
          destinationArguments: {
            type: 'object',
            description: 'Non-payload arguments for the configured destination tool.',
            properties: Object.fromEntries(destinationArgumentNames.map((name) => [name, {}])),
            additionalProperties: false,
          },
        },
        required: ['flow', 'id', 'op'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    };
  }

  prepare(args: Record<string, unknown>): PreparedMcpOpaqueFlow {
    const flowName = args.flow;
    if (typeof flowName !== 'string') throw new TypeError('flow is required');
    const policy = this.policies.get(flowName);
    if (!policy) throw new TypeError(`unknown opaque flow: ${flowName}`);
    const id = args.id;
    if (typeof id !== 'string' || !/^vctx_[a-f0-9]{32,64}$/.test(id)) {
      throw new TypeError('id must be a Pinpoint artifact id');
    }
    const artifact = this.artifacts.artifactInfo(id);
    if (!artifact) throw new TypeError(`artifact not found: ${id}`);
    if (artifact.sourceTool !== policy.sourceTool) {
      throw new TypeError(`flow ${policy.name} requires an artifact from ${policy.sourceTool}`);
    }
    if (policy.sourceKind != null && artifact.descriptor.kind !== policy.sourceKind) {
      throw new TypeError(`flow ${policy.name} requires a ${policy.sourceKind} artifact`);
    }
    const op = args.op;
    if (typeof op !== 'string' || !policy.allowedOps.includes(op as McpOpaqueFlowOperation)) {
      throw new TypeError(`operation not allowed by flow ${policy.name}: ${String(op)}`);
    }
    const where = args.where;
    if (
      where != null &&
      (!isRecord(where) || Object.keys(where).length > 16 || Object.values(where).some((value) => !isJsonPrimitive(value)))
    ) {
      throw new TypeError('where must contain at most 16 exact JSON primitive values');
    }
    const whereFields = isRecord(where) ? Object.keys(where) : [];
    ensureSubset(whereFields, policy.allowedWhereFields ?? [], 'where field');
    if (whereFields.length > 0 && !['json_select', 'count'].includes(op)) {
      throw new TypeError(`where is not valid for ${op}`);
    }
    const fields = boundedStringList(args.fields, 'fields');
    ensureSubset(fields ?? [], policy.allowedFields, 'projection field');
    if (op === 'json_select' && policy.allowedFields != null && !fields?.length) {
      throw new TypeError(`flow ${policy.name} requires an explicit field projection`);
    }
    if (op !== 'json_select' && fields != null) {
      throw new TypeError(`fields are not valid for ${op}`);
    }
    const literalQuery = args.query;
    if (
      literalQuery != null &&
      (typeof literalQuery !== 'string' || literalQuery.length === 0 || literalQuery.length > 512)
    ) {
      throw new TypeError('query must be a non-empty string of at most 512 characters');
    }
    if (literalQuery != null && !['grep', 'count'].includes(op)) {
      throw new TypeError(`query is not valid for ${op}`);
    }
    if (op === 'grep' && literalQuery == null) throw new TypeError('grep requires query');
    if (args.offset != null && op !== 'slice') throw new TypeError(`offset is not valid for ${op}`);
    if (args.limit != null && !['json_select', 'grep', 'slice'].includes(op)) {
      throw new TypeError(`limit is not valid for ${op}`);
    }
    const defaultLimit = ['json_select', 'grep', 'slice'].includes(op)
      ? policy.maxItems
      : undefined;
    const limit = args.limit != null
      ? boundedInteger(args.limit, 'limit', 100)
      : defaultLimit;
    const effectiveWhere: Record<string, string | number | boolean | null> = {
      ...(policy.fixedWhere ?? {}),
      ...(isRecord(where) ? where : {}),
    } as Record<string, string | number | boolean | null>;
    const query: VirtualContextQuery = {
      id,
      op: op as McpOpaqueFlowOperation,
      ...(Object.keys(effectiveWhere).length > 0 ? { where: effectiveWhere } : {}),
      ...(fields ? { fields } : {}),
      ...(typeof literalQuery === 'string' ? { query: literalQuery } : {}),
      ...(args.offset != null ? { offset: boundedInteger(args.offset, 'offset', 100_000_000) } : {}),
      ...(limit != null ? { limit } : {}),
    };
    const rawResult = this.artifacts.queryArtifact(query);
    const parsed = JSON.parse(rawResult) as unknown;
    if (!isRecord(parsed)) throw new TypeError('artifact query did not return an object');
    if (typeof parsed.error === 'string') throw new TypeError(parsed.error);
    const payload = queryPayload(op as McpOpaqueFlowOperation, parsed);
    const items = payloadItems(payload);
    if (items > (policy.maxItems ?? 100)) {
      throw new TypeError(`flow payload has ${items} items; limit is ${policy.maxItems}`);
    }
    const payloadText = canonicalJson(payload);
    const payloadBytes = Buffer.byteLength(payloadText);
    if (payloadBytes > (policy.maxBytes ?? 64 * 1024)) {
      throw new TypeError(`flow payload has ${payloadBytes} bytes; limit is ${policy.maxBytes}`);
    }
    const destinationInput = args.destinationArguments ?? {};
    if (!isRecord(destinationInput)) throw new TypeError('destinationArguments must be an object');
    const dynamicKeys = Object.keys(destinationInput);
    ensureSubset(dynamicKeys, policy.allowedDestinationArguments ?? [], 'destination argument');
    const destinationArguments = Object.fromEntries([
      ...Object.entries(policy.fixedDestinationArguments ?? {}),
      ...Object.entries(destinationInput),
    ]) as Record<string, unknown>;
    const destinationText = canonicalJson(destinationArguments);
    if (Buffer.byteLength(destinationText) > (policy.maxDestinationArgumentBytes ?? 16 * 1024)) {
      throw new TypeError('destinationArguments exceed the configured byte limit');
    }
    Object.defineProperty(destinationArguments, policy.destinationArgument, {
      value: payload,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const queryProof = {
      id,
      op,
      ...(Object.keys(effectiveWhere).length > 0 ? { where: effectiveWhere } : {}),
      ...(fields ? { fields } : {}),
      ...(typeof literalQuery === 'string' ? { query: literalQuery } : {}),
      ...(query.offset != null ? { offset: query.offset } : {}),
      ...(query.limit != null ? { limit: query.limit } : {}),
    };
    return {
      policy,
      artifactId: id,
      query,
      destinationArguments,
      payload,
      items,
      payloadBytes,
      payloadCanonical: payloadText,
      queryCanonical: canonicalJson(queryProof),
    };
  }

  complete(plan: PreparedMcpOpaqueFlow, result: McpCallToolResult): McpCallToolResult {
    if (!isValidMcpCallToolResult(result)) {
      throw new TypeError('destination returned an invalid MCP tool result');
    }
    const resultText = canonicalJson(result);
    const sequence = ++this.sequence;
    const attestation: Omit<McpOpaqueFlowReceipt, 'receiptHash' | 'verifier' | 'signature'> = {
      receiptVersion: 1,
      sequence,
      flow: plan.policy.name,
      artifactId: plan.artifactId,
      sourceTool: plan.policy.sourceTool,
      destinationTool: plan.policy.destinationTool,
      ...(this.destinationServerId ? { destinationServer: this.destinationServerId } : {}),
      destinationArgument: plan.policy.destinationArgument,
      op: plan.query.op as McpOpaqueFlowOperation,
      whereFields: Object.keys(plan.query.where ?? {}).sort(),
      projectionFields: [...(plan.query.fields ?? [])].sort(),
      destinationArgumentNames: Object.keys(plan.destinationArguments)
        .filter((name) => name !== plan.policy.destinationArgument)
        .sort(),
      policyShapeSha256: sha256(canonicalJson(policyShape(plan.policy))),
      policyLimits: {
        maxItems: plan.policy.maxItems ?? 100,
        maxBytes: plan.policy.maxBytes ?? 64 * 1024,
      },
      items: plan.items,
      payloadBytes: plan.payloadBytes,
      commitmentAlgorithm: 'HMAC-SHA256',
      payloadCommitment: this.commitment('payload', sequence, plan.payloadCanonical),
      queryCommitment: this.commitment('query', sequence, plan.queryCanonical),
      destinationSucceeded: result.isError !== true,
      destinationResultBytes: Buffer.byteLength(resultText),
      destinationResultCommitment: this.commitment('destination-result', sequence, resultText),
      previousReceiptHash: this.previousReceiptHash,
      signingKeyId: this.signingKeyId,
      disclosure: 'receipt',
    };
    const attestationText = canonicalJson(attestation);
    const receiptHash = sha256(attestationText);
    const receipt: McpOpaqueFlowReceipt = {
      ...attestation,
      receiptHash,
      verifier: {
        algorithm: 'Ed25519',
        publicKey: this.publicKey,
        ...(this.authorityBinding ? { authority: this.authorityBinding } : {}),
      },
      signature: signValue(null, Buffer.from(attestationText), this.signingKey).toString('base64url'),
    };
    this.previousReceiptHash = receiptHash;
    const structuredContent = { pinpointFlow: receipt };
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      ...(result.isError === true ? { isError: true } : {}),
    };
  }

  error(error: unknown): McpCallToolResult {
    return flowError(error instanceof Error ? error.message : String(error));
  }
}