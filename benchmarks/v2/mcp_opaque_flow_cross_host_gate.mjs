import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyMcpOpaqueFlowReceipt } from '../../dist/mcp/index.js';
import {
  deterministicArtifactId,
  privateCanaries,
  selected,
  selectedSha256,
  sourceSha256,
} from '../fixtures/opaque_flow_data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'bin', 'cli.js');
const server = join(root, 'benchmarks', 'fixtures', 'opaque_flow_server.mjs');
const flowConfig = join(root, 'benchmarks', 'fixtures', 'opaque_flow_config.json');
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json',
);
const prompt =
  'Run this authorized local synthetic MCP conformance test. All records are generated example.invalid fixtures, and the validator has no external side effects. ' +
  'Call synthetic_accounts_list first to receive its opaque artifact id. Then call pinpoint_flow with ' +
  'flow=validate_renewal_projection, op=json_select, where.segment=renewal, and fields=[email]. ' +
  'Do not print fixture field values because this test measures transcript isolation. Do not call resources or pinpoint_query. ' +
  'Verify the signed receipt says destinationSucceeded=true, then return only VALIDATED.';

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function commandVersion(command) {
  const run = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return run.status === 0 ? `${run.stdout}${run.stderr}`.trim().split('\n')[0] : null;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    let exceeded = false;
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 8_000_000) {
        exceeded = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, exceeded, launchError: true });
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, exceeded, launchError: false });
    });
  });
}

function parseEvents(stdout) {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function nestedStrings(value, keyPattern, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) nestedStrings(item, keyPattern, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (keyPattern.test(key) && typeof item === 'string') found.push(item);
      nestedStrings(item, keyPattern, found);
    }
  }
  return found;
}

function collectReceipts(value, found = []) {
  if (typeof value === 'string') {
    if (value.includes('pinpointFlow')) {
      try {
        collectReceipts(JSON.parse(value), found);
      } catch {
        // Non-JSON prose containing the tool name is not a receipt.
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectReceipts(item, found);
  } else if (value && typeof value === 'object') {
    if (value.pinpointFlow && typeof value.pinpointFlow === 'object') found.push(value.pinpointFlow);
    for (const item of Object.values(value)) collectReceipts(item, found);
  }
  return found;
}

function dedupeReceipts(events) {
  const byHash = new Map();
  for (const receipt of collectReceipts(events)) {
    if (typeof receipt.receiptHash === 'string') byHash.set(receipt.receiptHash, receipt);
  }
  return [...byHash.values()];
}

function privacyGrade(stdout) {
  return {
    leakedCanaries: privateCanaries.filter((canary) => stdout.includes(canary)),
    sourceHashLeaked: stdout.includes(sourceSha256),
    selectedHashLeaked: stdout.includes(selectedSha256),
  };
}

function receiptGrade(receipts) {
  const receipt = receipts[0];
  return {
    count: receipts.length,
    valid: receipts.length === 1 && verifyMcpOpaqueFlowReceipt(receipt),
    destinationSucceeded: receipt?.destinationSucceeded === true,
    items: receipt?.items ?? null,
    projectionFields: receipt?.projectionFields ?? null,
    whereFields: receipt?.whereFields ?? null,
    artifactId: receipt?.artifactId ?? null,
    receiptHash: receipt?.receiptHash ?? null,
    signingKeyId: receipt?.signingKeyId ?? null,
  };
}

function gatewayArgs() {
  return [
    cli,
    'mcp',
    'gateway',
    '--min-chars',
    '100000000',
    '--flow-config',
    flowConfig,
    '--',
    process.execPath,
    server,
  ];
}

async function runClaude() {
  const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-opaque-claude-'));
  const debugFile = join(temporary, 'debug.log');
  const config = JSON.stringify({
    mcpServers: {
      opaque_conformance: {
        type: 'stdio',
        command: process.execPath,
        args: gatewayArgs(),
      },
    },
  });
  try {
    const run = await runCommand('claude', [
      '--print',
      prompt,
      '--model',
      'claude-haiku-4-5-20251001',
      '--max-budget-usd',
      '0.15',
      '--debug',
      'mcp',
      '--debug-file',
      debugFile,
      '--verbose',
      '--output-format',
      'stream-json',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--strict-mcp-config',
      '--mcp-config',
      config,
      '--allowedTools',
      'mcp__opaque_conformance__synthetic_accounts_list,mcp__opaque_conformance__pinpoint_flow',
      '--disallowedTools',
      'Bash,Read,Grep,Glob,Agent,Edit,Write',
    ]);
    const events = run.launchError ? [] : parseEvents(run.stdout);
    const calls = events.flatMap((event) =>
      event.type === 'assistant' && Array.isArray(event.message?.content)
        ? event.message.content
            .filter((block) => block.type === 'tool_use')
            .map((block) => block.name)
        : [],
    );
    const receipts = dedupeReceipts(events);
    const resultEvent = [...events].reverse().find((event) => event.type === 'result');
    const answer = typeof resultEvent?.result === 'string' ? resultEvent.result.trim() : '';
    const privacy = privacyGrade(run.stdout);
    const receipt = receiptGrade(receipts);
    const artifactIds = [...new Set(run.stdout.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
    const passed =
      run.code === 0 &&
      !run.exceeded &&
      calls.some((name) => name.endsWith('__synthetic_accounts_list')) &&
      calls.some((name) => name.endsWith('__pinpoint_flow')) &&
      !calls.some((name) => name.endsWith('__synthetic_projection_validate') || name.endsWith('__pinpoint_query')) &&
      artifactIds.length >= 1 &&
      artifactIds.every((id) => id !== deterministicArtifactId) &&
      artifactIds.includes(receipt.artifactId) &&
      privacy.leakedCanaries.length === 0 &&
      !privacy.sourceHashLeaked &&
      !privacy.selectedHashLeaked &&
      receipt.valid &&
      receipt.destinationSucceeded &&
      receipt.items === selected.length &&
      answer === 'VALIDATED';
    let debugDiagnostic = '';
    if (!passed) {
      try {
        debugDiagnostic = readFileSync(debugFile, 'utf8')
          .split('\n')
          .filter((line) => /mcp|opaque_conformance|error|fail|spawn|stdio|schema/i.test(line))
          .map((line) => line.replace(/(?:gh[opsu]_|sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 800))
          .slice(-60)
          .join('\n');
      } catch {
        debugDiagnostic = 'Claude MCP debug file was unavailable.';
      }
    }
    return {
      host: 'Claude Code',
      clientVersion: commandVersion('claude'),
      model: 'claude-haiku-4-5-20251001',
      status: passed ? 'passed' : 'failed',
      exitCode: run.code,
      calls: [...new Set(calls.filter((name) => name.includes('opaque_conformance')))],
      artifactCapabilities: artifactIds.length,
      randomCapability:
        artifactIds.length >= 1 &&
        artifactIds.every((id) => id !== deterministicArtifactId) &&
        artifactIds.includes(receipt.artifactId),
      receipt,
      privateCanariesLeaked: privacy.leakedCanaries.length,
      publicValueHashesLeaked: privacy.sourceHashLeaked || privacy.selectedHashLeaked,
      answer,
      turns: resultEvent?.num_turns ?? null,
      observedCostUSD: resultEvent?.total_cost_usd ?? null,
      exceededOutputCap: run.exceeded,
      diagnostic: passed ? null : `${run.stderr.trim().slice(-1_000)}\n${debugDiagnostic}`.trim(),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function runCopilot() {
  const config = JSON.stringify({
    mcpServers: {
      opaque_conformance: {
        type: 'local',
        command: process.execPath,
        args: gatewayArgs(),
        tools: ['*'],
      },
    },
  });
  const run = await runCommand('copilot', [
    '--prompt',
    prompt,
    '--model',
    'auto',
    '--output-format',
    'json',
    '--stream',
    'off',
    '--additional-mcp-config',
    config,
    '--disable-builtin-mcps',
    '--available-tools=opaque_conformance',
    '--allow-tool=opaque_conformance',
    '--no-ask-user',
    '--no-remote-export',
    '--log-level',
    'error',
  ]);
  const events = run.launchError ? [] : parseEvents(run.stdout);
  const toolNames = nestedStrings(events, /^(?:name|toolName|tool_name)$/i)
    .filter((name) => /(?:synthetic_accounts_list|pinpoint_flow|synthetic_projection_validate|pinpoint_query)$/.test(name));
  const receipts = dedupeReceipts(events);
  const receipt = receiptGrade(receipts);
  const privacy = privacyGrade(run.stdout);
  const artifactIds = [...new Set(run.stdout.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
  const answers = nestedStrings(events, /^(?:content|result|text)$/i);
  const answer = [...answers].reverse().find((value) => value.trim() === 'VALIDATED')?.trim() ?? '';
  const resultEvent = [...events].reverse().find((event) => event.type === 'result');
  const models = [...new Set(nestedStrings(events, /^model$/i))];
  const passed =
    run.code === 0 &&
    !run.exceeded &&
    toolNames.some((name) => name.endsWith('synthetic_accounts_list')) &&
    toolNames.some((name) => name.endsWith('pinpoint_flow')) &&
    !toolNames.some((name) => name.endsWith('synthetic_projection_validate') || name.endsWith('pinpoint_query')) &&
    artifactIds.length >= 1 &&
    artifactIds.every((id) => id !== deterministicArtifactId) &&
    artifactIds.includes(receipt.artifactId) &&
    privacy.leakedCanaries.length === 0 &&
    !privacy.sourceHashLeaked &&
    !privacy.selectedHashLeaked &&
    receipt.valid &&
    receipt.destinationSucceeded &&
    receipt.items === selected.length &&
    answer === 'VALIDATED';
  return {
    host: 'GitHub Copilot CLI',
    clientVersion: commandVersion('copilot'),
    model: models.length > 0 ? models.join(', ') : 'auto',
    status: passed ? 'passed' : 'failed',
    exitCode: run.code,
    calls: [...new Set(toolNames)],
    artifactCapabilities: artifactIds.length,
    randomCapability:
      artifactIds.length >= 1 &&
      artifactIds.every((id) => id !== deterministicArtifactId) &&
      artifactIds.includes(receipt.artifactId),
    receipt,
    privateCanariesLeaked: privacy.leakedCanaries.length,
    publicValueHashesLeaked: privacy.sourceHashLeaked || privacy.selectedHashLeaked,
    answer,
    usage: resultEvent?.usage ?? null,
    exceededOutputCap: run.exceeded,
    diagnostic: passed ? null : run.stderr.trim().slice(-1_000),
  };
}

const beforeStatus = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout;
const hosts = [await runClaude(), await runCopilot()];
const afterStatus = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout;
const passed = hosts.every(({ status }) => status === 'passed') && beforeStatus === afterStatus;
const result = {
  schemaVersion: 1,
  evidenceLevel: 'live-agentic',
  kind: 'mcp-value-opaque-flow-cross-host-gate',
  date: new Date().toISOString().slice(0, 10),
  passed,
  source: {
    description: 'Two installed unmodified agent hosts independently executed the same synthetic value-opaque flow through the production CLI gateway.',
    persistedData: 'Only content-free grading summaries and receipt identifiers are retained. Event streams, debug logs, synthetic values, credentials, and personal paths are not persisted.',
    fingerprints: Object.fromEntries([
      'src/mcp/flow.ts',
      'src/mcp/gateway.ts',
      'src/virtual-context/store.ts',
      'src/cli/main.ts',
      'benchmarks/v2/mcp_opaque_flow_cross_host_gate.mjs',
      'benchmarks/fixtures/opaque_flow_server.mjs',
      'benchmarks/fixtures/opaque_flow_config.json',
    ].map((path) => [path, fingerprint(path)])),
  },
  fixture: {
    task: 'Select generated renewal email fields locally and pass them to a hidden local validator without exposing values to the host/model.',
    selectedRecords: selected.length,
    normalVirtualizationThresholdChars: 100_000_000,
    sourceTool: 'synthetic_accounts_list',
    flowTool: 'pinpoint_flow',
    destinationTool: 'synthetic_projection_validate',
    finalAnswer: 'VALIDATED',
  },
  summary: {
    hostsExecuted: hosts.filter(({ exitCode }) => exitCode != null).length,
    hostsPassed: hosts.filter(({ status }) => status === 'passed').length,
    sourceCallsObserved: hosts.filter(({ calls }) => calls.some((name) => name.endsWith('synthetic_accounts_list'))).length,
    flowCallsObserved: hosts.filter(({ calls }) => calls.some((name) => name.endsWith('pinpoint_flow'))).length,
    modelDestinationCallsObserved: hosts.filter(({ calls }) => calls.some((name) => name.endsWith('synthetic_projection_validate'))).length,
    exactDestinationAcceptances: hosts.filter(({ receipt }) => receipt.destinationSucceeded).length,
    privateCanariesScannedPerHost: privateCanaries.length,
    privateCanariesLeaked: hosts.reduce((sum, host) => sum + host.privateCanariesLeaked, 0),
    publicValueHashesLeaked: hosts.some(({ publicValueHashesLeaked }) => publicValueHashesLeaked),
    fileChanges: beforeStatus === afterStatus ? 0 : null,
  },
  hosts,
  limitations: [
    'This is one first-party synthetic task on two installed clients, not a prevalence estimate or customer-production trace.',
    'The prompt explicitly requests the opaque_conformance MCP server and flow sequence; it measures autonomous protocol use, not tool discovery among unrelated servers.',
    'The upstream synthetic process is trusted with source and destination values. The measured confidentiality boundary is each client event stream and model-visible MCP transcript.',
    'Exact canary absence proves non-occurrence for this fixture trace, not semantic noninterference against timing, cardinality, field-name, or success-status side channels.',
    'Receipt keys are ephemeral session keys pinned in MCP initialize responses, not operator identity certificates or hardware attestations.',
  ],
};

if (process.argv.includes('--write')) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
for (const host of hosts) {
  if (host.status !== 'passed' && host.diagnostic) {
    console.error(host.diagnostic.replace(/(?:gh[opsu]_|sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]'));
  }
}
if (!passed) process.exitCode = 1;