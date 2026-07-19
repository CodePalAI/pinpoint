import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  createMcpOpaqueFlowAuthorityPolicy,
  MCP_FLOW_TOOL_NAME,
  parseMcpOpaqueFlowConfig,
  runMcpGateway,
  verifyMcpOpaqueFlowAuthorityBinding,
  verifyMcpOpaqueFlowPolicyOpening,
  verifyMcpOpaqueFlowReceipt,
} from '../../dist/mcp/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'mcp-oss-cross-server.first-party-macos-arm64-20260716.json',
);
const sourcePackage = '@modelcontextprotocol/server-filesystem';
const sourceVersion = '2026.7.10';
const destinationPackage = '@modelcontextprotocol/server-memory';
const destinationVersion = '2026.7.4';
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-oss-cross-server-'));
const sourceHome = join(temporary, 'source-home');
const destinationHome = join(temporary, 'destination-home');
const sourceCache = join(temporary, 'source-npm-cache');
const destinationCache = join(temporary, 'destination-npm-cache');
const fixturePath = join(temporary, 'entities.json');
const memoryPath = join(temporary, 'memory.jsonl');
for (const directory of [sourceHome, destinationHome, sourceCache, destinationCache]) mkdirSync(directory);

const rows = Array.from({ length: 200 }, (_, id) => ({
  id,
  eligible: id % 5 === 0,
  name: `oss-private-entity-${id}`,
  entityType: 'synthetic_account',
  observations: [`oss-private-observation-${id}`],
  sourceOnly: `oss-source-only-${id}`,
}));
const selected = rows
  .filter(({ eligible }) => eligible)
  .map(({ name, entityType, observations }) => ({ name, entityType, observations }));
const privateCanaries = rows.flatMap(({ name, observations, sourceOnly }) => [name, ...observations, sourceOnly]);
const fixtureText = JSON.stringify(rows);
const selectedText = JSON.stringify(selected);
const fixtureSha256 = createHash('sha256').update(fixtureText).digest('hex');
const selectedSha256 = createHash('sha256').update(selectedText).digest('hex');
writeFileSync(fixturePath, fixtureText);

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function npmEnvironment(home, cache, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    npm_config_cache: cache,
    npm_config_userconfig: '/dev/null',
    npm_config_yes: 'true',
    ...extra,
  };
}

function responses(stream, visible) {
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
const diagnostics = [];
error.on('data', (chunk) => diagnostics.push(String(chunk)));
const next = responses(output, visible);
const operator = generateKeyPairSync('ed25519');
const operatorPublicKeyBytes = createPublicKey(operator.privateKey).export({ type: 'spki', format: 'der' });
const operatorVerifier = {
  algorithm: 'Ed25519',
  publicKey: operatorPublicKeyBytes.toString('base64url'),
  operatorKeyId: createHash('sha256').update(operatorPublicKeyBytes).digest('hex'),
};
const flowPolicy = {
  name: 'persist_eligible_entities',
  sourceTool: 'read_text_file',
  sourceKind: 'json-array',
  destinationTool: 'create_entities',
  destinationArgument: 'entities',
  allowedOps: ['json_select'],
  fixedWhere: { eligible: true },
  allowedFields: ['name', 'entityType', 'observations'],
  maxItems: 50,
  maxBytes: 16_384,
  hideDestinationTool: true,
};
const destination = {
  id: 'memory-domain',
  command: 'npx',
  args: ['-y', `${destinationPackage}@${destinationVersion}`],
  env: npmEnvironment(destinationHome, destinationCache, { MEMORY_FILE_PATH: memoryPath }),
  declaredEnvNames: ['PATH', 'HOME', 'npm_config_cache', 'npm_config_userconfig', 'npm_config_yes', 'MEMORY_FILE_PATH'],
  sharedEnvNames: ['PATH', 'HOME', 'npm_config_cache', 'npm_config_userconfig', 'npm_config_yes'],
  initializeTimeoutMs: 60_000,
  requestTimeoutMs: 30_000,
  shutdownGraceMs: 2_000,
};
let authorityRecord;
const started = performance.now();
const running = runMcpGateway(
  'npx',
  ['-y', `${sourcePackage}@${sourceVersion}`, temporary],
  {
    input,
    output,
    error,
    env: npmEnvironment(sourceHome, sourceCache),
    minChars: 100_000_000,
    flows: [flowPolicy],
    flowAuthoritySigningKey: operator.privateKey,
    onFlowAuthorityReady: (record) => { authorityRecord = record; },
    destination,
  },
);

let requestId = 0;
async function request(method, params = {}) {
  const id = ++requestId;
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const response = await next();
  if (response.id !== id) throw new Error(`response id mismatch: expected ${id}, received ${response.id}`);
  return response;
}

try {
  const initialized = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pinpoint-oss-cross-server-gate', version: '1.0.0' },
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const verifier = initialized.result?._meta?.pinpoint?.opaqueFlow?.receiptVerifier;
  const listed = await request('tools/list');
  const toolNames = listed.result.tools.map(({ name }) => name);
  const source = await request('tools/call', {
    name: 'read_text_file',
    arguments: { path: fixturePath },
  });
  const sourceText = JSON.stringify(source);
  const artifactIds = [...new Set(sourceText.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
  const artifactId = artifactIds[0];
  const deniedResponses = [
    await request('tools/call', {
      name: 'create_entities',
      arguments: { entities: [] },
    }),
    await request('tools/call', {
      name: MCP_FLOW_TOOL_NAME,
      arguments: {
        flow: flowPolicy.name,
        id: `vctx_${'f'.repeat(32)}`,
        op: 'json_select',
        fields: ['name', 'entityType', 'observations'],
      },
    }),
    await request('tools/call', {
      name: MCP_FLOW_TOOL_NAME,
      arguments: {
        flow: flowPolicy.name,
        id: artifactId,
        op: 'json_select',
        where: { eligible: false },
        fields: ['name', 'entityType', 'observations'],
      },
    }),
    await request('tools/call', {
      name: MCP_FLOW_TOOL_NAME,
      arguments: {
        flow: flowPolicy.name,
        id: artifactId,
        op: 'json_select',
        fields: ['sourceOnly'],
      },
    }),
  ];
  const bypassesDenied = deniedResponses.filter((response) => response.result?.isError === true).length;
  const flowed = await request('tools/call', {
    name: MCP_FLOW_TOOL_NAME,
    arguments: {
      flow: flowPolicy.name,
      id: artifactId,
      op: 'json_select',
      fields: ['name', 'entityType', 'observations'],
    },
  });
  const receiptText = flowed.result?.content?.[0]?.text ?? '{}';
  const receipt = JSON.parse(receiptText).pinpointFlow;
  input.end();
  const gatewayExitCode = await running;
  const elapsedMs = performance.now() - started;
  const transcript = visible.join('');
  const leakedCanaries = privateCanaries.filter((canary) => transcript.includes(canary));
  const memoryLines = readFileSync(memoryPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const persisted = memoryLines
    .filter(({ type }) => type === 'entity')
    .map(({ name, entityType, observations }) => ({ name, entityType, observations }));
  const exactPersistedProjection = JSON.stringify(persisted) === JSON.stringify(selected);
  const authorityBindingValid = verifyMcpOpaqueFlowAuthorityBinding(
    verifier?.authority,
    operatorVerifier,
    verifier,
  );
  const authorityPolicy = createMcpOpaqueFlowAuthorityPolicy(parseMcpOpaqueFlowConfig({
    version: 1,
    exposeQueryTool: false,
    exposeArtifactResources: false,
    opaqueArtifactIds: true,
    flows: [flowPolicy],
  }), {
    id: destination.id,
    command: destination.command,
    args: destination.args,
    envNames: destination.declaredEnvNames,
    sharedEnvNames: destination.sharedEnvNames,
  });
  const exactPolicyOpeningValid = verifyMcpOpaqueFlowPolicyOpening(
    verifier?.authority,
    authorityPolicy,
    authorityRecord?.opening,
  );
  const receiptValid = verifyMcpOpaqueFlowReceipt(receipt, verifier, operatorVerifier);
  const passed =
    gatewayExitCode === 0 &&
    initialized.result?.serverInfo?.name?.startsWith('pinpoint-gateway/') &&
    toolNames.includes('read_text_file') &&
    toolNames.includes(MCP_FLOW_TOOL_NAME) &&
    !toolNames.includes('create_entities') &&
    bypassesDenied === deniedResponses.length &&
    artifactIds.length === 1 &&
    receiptValid &&
    authorityBindingValid &&
    exactPolicyOpeningValid &&
    receipt.destinationServer === destination.id &&
    receipt.destinationTool === 'create_entities' &&
    receipt.destinationSucceeded === true &&
    receipt.items === selected.length &&
    exactPersistedProjection &&
    leakedCanaries.length === 0;
  const result = {
    schemaVersion: 1,
    evidenceLevel: 'oss-cross-server-integration',
    kind: 'mcp-value-opaque-oss-cross-server-gate',
    date: new Date().toISOString().slice(0, 10),
    passed,
    environment: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      node: process.version,
    },
    sourceServer: {
      package: sourcePackage,
      version: sourceVersion,
      modification: 'none',
      transport: 'stdio',
      tool: 'read_text_file',
    },
    destinationServer: {
      package: destinationPackage,
      version: destinationVersion,
      modification: 'none',
      transport: 'stdio',
      tool: 'create_entities',
      persistentSideEffect: 'disposable JSONL knowledge graph',
    },
    fixture: {
      sourceRecords: rows.length,
      selectedRecords: selected.length,
      sourceBytes: Buffer.byteLength(fixtureText),
      privateCanaries: privateCanaries.length,
      sourceSha256: fixtureSha256,
      selectedSha256,
    },
    summary: {
      gatewayExitCode,
      sourceToolPresent: toolNames.includes('read_text_file'),
      flowToolPresent: toolNames.includes(MCP_FLOW_TOOL_NAME),
      destinationToolHidden: !toolNames.includes('create_entities'),
      bypassAttempts: deniedResponses.length,
      bypassesDenied,
      artifactCapabilities: artifactIds.length,
      exactPersistedProjection,
      persistedEntities: persisted.length,
      privateCanariesScanned: privateCanaries.length,
      privateCanariesLeaked: leakedCanaries.length,
      elapsedMs,
    },
    security: {
      separateProcesses: true,
      separateDisposableHomes: sourceHome !== destinationHome,
      inheritedCredentialVariables: 0,
      receiptValid,
      operatorAuthorityBindingValid: authorityBindingValid,
      exactPolicyOpeningValid,
      destinationServerBoundInReceipt: receipt.destinationServer === destination.id,
      operatorKeyId: operatorVerifier.operatorKeyId,
      policyCommitment: verifier?.authority?.policyCommitment ?? null,
      receiptHash: receipt.receiptHash,
    },
    source: {
      fingerprints: Object.fromEntries([
        'src/mcp/destination.ts',
        'src/mcp/flow.ts',
        'src/mcp/gateway.ts',
        'src/virtual-context/store.ts',
        'benchmarks/v2/mcp_oss_cross_server_gate.mjs',
      ].map((path) => [path, fingerprint(path)])),
    },
    limitations: [
      'This is a first-party synthetic integration using two pinned published MCP packages, not an independent review or customer workflow.',
      'The gateway still sees plaintext selected values and both processes share the local operating-system trust boundary.',
      'Separate process environments prove the gateway did not copy inherited credentials; they do not prove OS-level credential isolation or executable identity.',
      'The local JSONL side effect proves this destination call completed for the fixture, not exactly-once behavior under crashes or timeouts.',
      'The operator key is generated for this run and proves the mechanism, not externally attested organizational identity or transparency inclusion.',
    ],
  };
  if (process.argv.includes('--write')) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!passed) {
    const diagnostic = diagnostics.join('').slice(-2_000);
    if (diagnostic) console.error(diagnostic);
    process.exitCode = 1;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}