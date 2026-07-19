#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import {
  createMcpOpaqueFlowAuthorityPolicy,
  parseMcpOpaqueFlowConfig,
} from '../dist/mcp/flow.js';
import { parseMcpOpaqueFlowDestinationConfig } from '../dist/mcp/destination.js';

const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_OPENING_BYTES = 4 * 1024 * 1024;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJsonFile(path, limit, label) {
  if (typeof path !== 'string' || path.length === 0) throw new Error(`${label} path is required`);
  const nonblock = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;
  const nofollow = process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number'
    ? 0
    : constants.O_NOFOLLOW;
  const descriptor = openSync(path, constants.O_RDONLY | nonblock | nofollow);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
    if (metadata.size > limit) throw new Error(`${label} exceeds ${limit} bytes`);
    const chunks = [];
    let bytes = 0;
    while (bytes <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - bytes));
      const count = readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      bytes += count;
    }
    if (bytes > limit) throw new Error(`${label} exceeds ${limit} bytes`);
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } finally {
    closeSync(descriptor);
  }
}

function verifyAuthority(binding, receiptPublicKey, receiptKeyId, expectedOperatorKeyId) {
  if (binding == null || typeof binding !== 'object' || Array.isArray(binding)) return expectedOperatorKeyId == null;
  const { verifier, signature, ...attestation } = binding;
  if (
    binding.authorityVersion !== 1 ||
    binding.domain !== 'pinpoint.mcp.opaque-flow.session' ||
    binding.policyCommitmentAlgorithm !== 'Ed25519-SHA256' ||
    !/^sha256:[a-f0-9]{64}$/.test(binding.policyCommitment) ||
    !/^[A-Za-z0-9_-]{43}$/.test(binding.policyNonce) ||
    verifier?.algorithm !== 'Ed25519' ||
    typeof verifier.publicKey !== 'string' ||
    typeof signature !== 'string'
  ) return false;
  const operatorPublicKeyBytes = Buffer.from(verifier.publicKey, 'base64url');
  const operatorKeyId = createHash('sha256').update(operatorPublicKeyBytes).digest('hex');
  const sessionPublicKeyBytes = Buffer.from(binding.sessionPublicKey, 'base64url');
  const sessionKeyId = createHash('sha256').update(sessionPublicKeyBytes).digest('hex');
  if (
    operatorKeyId !== binding.operatorKeyId ||
    sessionKeyId !== binding.sessionSigningKeyId ||
    binding.sessionPublicKey !== receiptPublicKey ||
    binding.sessionSigningKeyId !== receiptKeyId ||
    (expectedOperatorKeyId != null && expectedOperatorKeyId !== operatorKeyId)
  ) return false;
  const operatorPublicKey = createPublicKey({ key: operatorPublicKeyBytes, format: 'der', type: 'spki' });
  return verify(null, Buffer.from(canonicalJson(attestation)), operatorPublicKey, Buffer.from(signature, 'base64url'));
}

function verifyPolicyOpening(authority, policyPath, openingPath, destinationPath) {
  if (policyPath == null && openingPath == null && destinationPath == null) return true;
  if (policyPath == null || openingPath == null || authority == null) return false;
  const record = readJsonFile(openingPath, MAX_OPENING_BYTES, 'authority opening');
  if (canonicalJson(record.authority) !== canonicalJson(authority)) return false;
  const signature = record.opening?.policyAuthorizationSignature;
  if (typeof signature !== 'string') return false;
  const signatureBytes = Buffer.from(signature, 'base64url');
  if (`sha256:${createHash('sha256').update(signatureBytes).digest('hex')}` !== authority.policyCommitment) return false;
  const config = parseMcpOpaqueFlowConfig(readJsonFile(policyPath, MAX_POLICY_BYTES, 'flow policy'));
  const destination = destinationPath == null
    ? undefined
    : parseMcpOpaqueFlowDestinationConfig(
        readJsonFile(destinationPath, MAX_POLICY_BYTES, 'destination config'),
        {},
      );
  const expectedPolicy = createMcpOpaqueFlowAuthorityPolicy(config, destination == null ? undefined : {
    id: destination.id,
    command: destination.command,
    args: destination.args,
    cwd: destination.cwd,
    envNames: destination.declaredEnvNames,
    sharedEnvNames: destination.sharedEnvNames,
  });
  const publicKeyBytes = Buffer.from(authority.verifier.publicKey, 'base64url');
  const publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' });
  const message = canonicalJson({
    domain: 'pinpoint.mcp.opaque-flow.policy',
    policyNonce: authority.policyNonce,
    policy: expectedPolicy,
  });
  return verify(null, Buffer.from(message), publicKey, signatureBytes);
}

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: pinpoint-verify-receipt <receipt.json> [--path firstReceipt] [--signing-key-id HEX] [--operator-key-id HEX] [--policy FILE --authority-opening FILE [--destination-config FILE]]');
  process.exit(2);
}

try {
  let receipt = readJsonFile(file, MAX_RECEIPT_BYTES, 'receipt');
  const path = argument('--path');
  if (path) {
    for (const segment of path.split('.').filter(Boolean)) receipt = receipt?.[segment];
  }
  if (receipt == null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('receipt path does not resolve to an object');
  }
  const expectedKeyId = argument('--signing-key-id');
  const expectedOperatorKeyId = argument('--operator-key-id');
  const { receiptHash, verifier: verifierBlock, signature, ...attestation } = receipt;
  if (
    receipt.receiptVersion !== 1 ||
    verifierBlock?.algorithm !== 'Ed25519' ||
    typeof verifierBlock.publicKey !== 'string' ||
    typeof receipt.signingKeyId !== 'string' ||
    typeof receiptHash !== 'string' ||
    typeof signature !== 'string'
  ) {
    throw new Error('receipt fields are invalid');
  }
  const publicKeyBytes = Buffer.from(verifierBlock.publicKey, 'base64url');
  const keyId = createHash('sha256').update(publicKeyBytes).digest('hex');
  const attestationText = canonicalJson(attestation);
  const computedHash = createHash('sha256').update(attestationText).digest('hex');
  const publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' });
  const signatureValid = verify(
    null,
    Buffer.from(attestationText),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
  const authority = verifierBlock.authority;
  const authorityValid = verifyAuthority(
    authority,
    verifierBlock.publicKey,
    receipt.signingKeyId,
    expectedOperatorKeyId,
  );
  const policyOpeningValid = verifyPolicyOpening(
    authority,
    argument('--policy'),
    argument('--authority-opening'),
    argument('--destination-config'),
  );
  const valid =
    keyId === receipt.signingKeyId &&
    computedHash === receiptHash &&
    signatureValid &&
    authorityValid &&
    policyOpeningValid &&
    (expectedKeyId == null || expectedKeyId === receipt.signingKeyId);
  console.log(JSON.stringify({
    valid,
    receiptHash,
    signingKeyId: receipt.signingKeyId,
    operatorKeyId: authority?.operatorKeyId ?? null,
    policyCommitment: authority?.policyCommitment ?? null,
    sequence: receipt.sequence,
    flow: receipt.flow,
  }, null, 2));
  if (!valid) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ valid: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}