import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  MCP_FLOW_TOOL_NAME,
  MCP_QUERY_TOOL_NAME,
  parseMcpOpaqueFlowConfig,
  runMcpGateway,
  verifyMcpOpaqueFlowReceipt,
} from '../../dist/mcp/index.js';
import {
  deterministicArtifactId,
  privateCanaries,
  rawSource,
  rows,
  selected,
  selectedPayload,
  selectedSha256,
  sourceSha256,
} from '../fixtures/opaque_flow_data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = join(root, 'benchmarks', 'fixtures', 'opaque_flow_server.mjs');
const configPath = join(root, 'benchmarks', 'fixtures', 'opaque_flow_config.json');
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'mcp-opaque-flow.first-party-macos-arm64-20260715.json',
);
const flowConfig = parseMcpOpaqueFlowConfig(JSON.parse(readFileSync(configPath, 'utf8')));

function sourceFingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function createResponses(stream, visible) {
  let buffer = '';
  const pending = [];
  const queued = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    visible.push(chunk);
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      const resolve = pending.shift();
      if (resolve) resolve(value);
      else queued.push(value);
    }
  });
  return () => {
    const value = queued.shift();
    if (value) return Promise.resolve(value);
    return new Promise((resolve) => pending.push(resolve));
  };
}

const input = new PassThrough();
const output = new PassThrough();
const error = new PassThrough();
const visible = [];
const next = createResponses(output, visible);
const running = runMcpGateway(process.execPath, [server], {
  input,
  output,
  error,
  minChars: 100_000_000,
  flows: flowConfig.flows,
  exposeQueryTool: flowConfig.exposeQueryTool,
  exposeArtifactResources: flowConfig.exposeArtifactResources,
  opaqueArtifactIds: flowConfig.opaqueArtifactIds,
});
let requestId = 0;
async function request(method, params = {}) {
  const id = ++requestId;
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const response = await next();
  if (response.id !== id) throw new Error(`response id mismatch: expected ${id}, received ${response.id}`);
  return response;
}

const initialized = await request('initialize');
const verifier = initialized.result?._meta?.pinpoint?.opaqueFlow?.receiptVerifier;
const listed = await request('tools/list');
const toolNames = listed.result.tools.map(({ name }) => name);
const sourceResponse = await request('tools/call', {
  name: 'synthetic_accounts_list',
  arguments: {},
});
const sourceText = JSON.stringify(sourceResponse);
const artifactIds = [...new Set(sourceText.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
const artifactId = artifactIds[0];

const deniedCalls = [
  ['tools/call', { name: MCP_QUERY_TOOL_NAME, arguments: { id: artifactId, op: 'slice', limit: 1 } }],
  ['resources/read', { uri: `pinpoint://artifact/${artifactId}` }],
  ['tools/call', {
    name: 'synthetic_projection_validate',
    arguments: { testCase: 'renewal-email-projection', projectedRecords: [] },
  }],
  ['tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: {
      flow: 'validate_renewal_projection',
      id: artifactId,
      op: 'json_select',
      where: { segment: 'renewal' },
      fields: ['privateCode'],
    },
  }],
  ['tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: { flow: 'validate_renewal_projection', id: artifactId, op: 'slice', limit: 1 },
  }],
  ['tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: {
      flow: 'validate_renewal_projection',
      id: `vctx_${'f'.repeat(32)}`,
      op: 'json_select',
      fields: ['email'],
    },
  }],
  ['tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: {
      flow: 'validate_renewal_projection',
      id: artifactId,
      op: 'json_select',
      where: { segment: 'renewal' },
      fields: ['email'],
      destinationArguments: { testCase: 'override' },
    },
  }],
];
const denials = [];
for (const [method, params] of deniedCalls) {
  const response = await request(method, params);
  denials.push(response.error != null || response.result?.isError === true);
}

const receipts = [];
const latenciesMs = [];
const successfulResponses = [];
for (let iteration = 0; iteration < 30; iteration += 1) {
  const started = performance.now();
  const response = await request('tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: {
      flow: 'validate_renewal_projection',
      id: artifactId,
      op: 'json_select',
      where: { segment: 'renewal' },
      fields: ['email'],
    },
  });
  latenciesMs.push(performance.now() - started);
  successfulResponses.push(response);
  const text = response.result?.content?.[0]?.text ?? '{}';
  receipts.push(JSON.parse(text).pinpointFlow);
}

input.end();
const gatewayExitCode = await running;
const clientTranscript = visible.join('');
const leakedCanaries = privateCanaries.filter((canary) => clientTranscript.includes(canary));
const receiptsValid = receipts.every((receipt) => verifyMcpOpaqueFlowReceipt(receipt));
const chainValid = receipts.every((receipt, index) =>
  receipt.sequence === index + 1 &&
  receipt.previousReceiptHash === (index === 0 ? '0'.repeat(64) : receipts[index - 1].receiptHash),
);
const pinnedVerifier = receipts.every((receipt) =>
  receipt.signingKeyId === verifier?.signingKeyId &&
  receipt.verifier.publicKey === verifier?.publicKey,
);
const commitmentsUnlinkable = new Set(receipts.map(({ payloadCommitment }) => payloadCommitment)).size === receipts.length;
const tamperedReceiptRejected = !verifyMcpOpaqueFlowReceipt({
  ...receipts[0],
  payloadBytes: receipts[0].payloadBytes + 1,
});
const destinationAccepted = receipts.every(({ destinationSucceeded, items }) =>
  destinationSucceeded === true && items === selected.length,
);
const noPublicValueHashes =
  !clientTranscript.includes(sourceSha256) && !clientTranscript.includes(selectedSha256);
const strictCapabilities = initialized.result?.capabilities?.resources == null;
const strictTools =
  toolNames.length === 2 &&
  toolNames.includes('synthetic_accounts_list') &&
  toolNames.includes(MCP_FLOW_TOOL_NAME) &&
  !toolNames.includes('synthetic_projection_validate') &&
  !toolNames.includes(MCP_QUERY_TOOL_NAME);
const randomCapability = artifactIds.length === 1 && artifactId !== deterministicArtifactId;
const sourceCapturedDespiteThreshold =
  rawSource.length < 100_000_000 &&
  !sourceText.includes(rows[0].email) &&
  !sourceText.includes('resource_link');

const baselineSource = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: rawSource }] },
});
const baselineDestination = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'synthetic_projection_validate',
    arguments: { testCase: 'renewal-email-projection', projectedRecords: selected },
  },
});
const baselineVisibleBytes = Buffer.byteLength(`${baselineSource}\n${baselineDestination}\n`);
const opaqueVisibleBytes = Buffer.byteLength(
  `${JSON.stringify(sourceResponse)}\n${JSON.stringify(successfulResponses[0])}\n`,
);
const visibleByteReductionPercent = (1 - opaqueVisibleBytes / baselineVisibleBytes) * 100;

const passed =
  gatewayExitCode === 0 &&
  strictCapabilities &&
  strictTools &&
  randomCapability &&
  sourceCapturedDespiteThreshold &&
  denials.every(Boolean) &&
  leakedCanaries.length === 0 &&
  noPublicValueHashes &&
  receiptsValid &&
  chainValid &&
  pinnedVerifier &&
  commitmentsUnlinkable &&
  tamperedReceiptRejected &&
  destinationAccepted;

const result = {
  schemaVersion: 1,
  evidenceLevel: 'protocol-integration',
  kind: 'mcp-value-opaque-flow-gate',
  date: new Date().toISOString().slice(0, 10),
  passed,
  environment: {
    platform: platform(),
    release: release(),
    architecture: arch(),
    node: process.version,
  },
  source: {
    description: 'Production gateway and an unmodified deterministic stdio MCP fixture; no model or provider call.',
    persistedData: 'Synthetic values are not persisted in this receipt. Only counts, byte sizes, source fingerprints, and commitment receipts are retained.',
    fingerprints: Object.fromEntries([
      'src/mcp/flow.ts',
      'src/mcp/gateway.ts',
      'src/virtual-context/store.ts',
      'src/cli/main.ts',
      'benchmarks/v2/mcp_opaque_flow_gate.mjs',
      'benchmarks/fixtures/opaque_flow_server.mjs',
      'benchmarks/fixtures/opaque_flow_config.json',
    ].map((path) => [path, sourceFingerprint(path)])),
  },
  fixture: {
    sourceRecords: rows.length,
    selectedRecords: selected.length,
    sourceBytes: Buffer.byteLength(rawSource),
    selectedBytes: Buffer.byteLength(selectedPayload),
    normalVirtualizationThresholdChars: 100_000_000,
    sourceCapturedBelowThreshold: sourceCapturedDespiteThreshold,
  },
  summary: {
    flowCalls: receipts.length,
    destinationAcceptedCalls: receipts.filter(({ destinationSucceeded }) => destinationSucceeded).length,
    bypassAttempts: denials.length,
    bypassesDenied: denials.filter(Boolean).length,
    privateCanariesScanned: privateCanaries.length,
    privateCanariesLeaked: leakedCanaries.length,
    publicValueHashesLeaked: !noPublicValueHashes,
    baselineVisibleBytes,
    opaqueVisibleBytes,
    visibleByteReductionPercent,
  },
  security: {
    randomCapability,
    artifactResourcesDisabled: strictCapabilities,
    queryToolHidden: !toolNames.includes(MCP_QUERY_TOOL_NAME),
    destinationToolHidden: !toolNames.includes('synthetic_projection_validate'),
    receiptsValid,
    receiptChainValid: chainValid,
    verifierPinnedAtInitialize: pinnedVerifier,
    commitmentsUnlinkableAcrossIdenticalPayloads: commitmentsUnlinkable,
    tamperedReceiptRejected,
    destinationAcceptedExactProjection: destinationAccepted,
    receiptChain: {
      count: receipts.length,
      signingKeyId: verifier?.signingKeyId ?? null,
      firstReceiptHash: receipts[0]?.receiptHash ?? null,
      lastReceiptHash: receipts.at(-1)?.receiptHash ?? null,
    },
  },
  latencyMs: {
    samples: latenciesMs.length,
    p50: percentile(latenciesMs, 0.5),
    p95: percentile(latenciesMs, 0.95),
    p99: percentile(latenciesMs, 0.99),
    max: Math.max(...latenciesMs),
  },
  firstReceipt: receipts[0],
  limitations: [
    'This is a deterministic first-party protocol integration, not a model-quality or production-demand measurement.',
    'The upstream MCP process is trusted with source and destination values; the confidentiality boundary is the client/model-visible MCP transcript.',
    'Counts, byte sizes, field names, tool names, timing, and success status remain observable metadata.',
    'The receipt key is ephemeral and pinned in the initialize transcript; it is not an operator identity certificate or hardware attestation.',
    'The baseline byte count is a constructed direct-MCP transcript for the identical source and destination payload, not a provider token bill.',
  ],
};

if (process.argv.includes('--write')) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 1;