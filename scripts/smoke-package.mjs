import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('package smoke must run through npm so npm_execpath is available');
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-package-smoke-'));
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const runNpm = (args, cwd = temporary) => run(process.execPath, [npmCli, ...args], cwd);

function parseTrailingJsonArray(output, label) {
  const lines = output.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== '[') continue;
    try {
      const value = JSON.parse(lines.slice(index).join('\n'));
      if (Array.isArray(value)) return value;
    } catch {
      // npm lifecycle output may precede the final --json document.
    }
  }
  throw new Error(`${label} did not end with a JSON array`);
}

const publicEntries = [
  '@codepalaiorg/pinpoint',
  '@codepalaiorg/pinpoint/anthropic',
  '@codepalaiorg/pinpoint/openai',
  '@codepalaiorg/pinpoint/sdk',
  '@codepalaiorg/pinpoint/proxy',
  '@codepalaiorg/pinpoint/router',
  '@codepalaiorg/pinpoint/kernel',
  '@codepalaiorg/pinpoint/protocols',
  '@codepalaiorg/pinpoint/output',
  '@codepalaiorg/pinpoint/agents',
  '@codepalaiorg/pinpoint/virtual-context',
  '@codepalaiorg/pinpoint/capture',
  '@codepalaiorg/pinpoint/telemetry',
  '@codepalaiorg/pinpoint/mcp',
  '@codepalaiorg/pinpoint/dashboard',
];
const packageBudget = {
  maxFiles: 210,
  maxPackedBytes: 450_000,
  maxUnpackedBytes: 1_325_000,
};

try {
  const packed = parseTrailingJsonArray(
    runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root),
    'npm pack',
  );
  const artifact = packed[0];
  if (!artifact || artifact.name !== '@codepalaiorg/pinpoint') {
    throw new Error('npm pack returned the wrong package identity');
  }
  const packedBytes = readFileSync(join(temporary, artifact.filename));
  const packedIntegrity = `sha512-${createHash('sha512').update(packedBytes).digest('base64')}`;
  if (artifact.integrity !== packedIntegrity) {
    throw new Error('npm pack integrity does not match the generated tarball bytes');
  }
  const fileCount = artifact.files?.length ?? 0;
  if (fileCount > packageBudget.maxFiles) {
    throw new Error(`packed artifact has ${fileCount} files; budget is ${packageBudget.maxFiles}`);
  }
  if (artifact.size > packageBudget.maxPackedBytes) {
    throw new Error(`packed artifact is ${artifact.size} bytes; budget is ${packageBudget.maxPackedBytes}`);
  }
  if (artifact.unpackedSize > packageBudget.maxUnpackedBytes) {
    throw new Error(
      `unpacked artifact is ${artifact.unpackedSize} bytes; budget is ${packageBudget.maxUnpackedBytes}`,
    );
  }
  const paths = new Set((artifact.files ?? []).map((file) => file.path));
  for (const path of paths) {
    if (
      path.endsWith('.map') ||
      path.endsWith('.log') ||
      path.endsWith('.tgz') ||
      /(?:^|\/)(?:\.env|\.git|node_modules|coverage)(?:\/|$)/.test(path) ||
      /\.(?:pem|key|p12|pfx)$/.test(path)
    ) {
      throw new Error(`packed artifact contains a forbidden path: ${path}`);
    }
  }
  for (const required of [
    'README.md',
    'RELEASING.md',
    'CODE_OF_CONDUCT.md',
    'MAINTAINERS.md',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'bin/cli.js',
    'bin/verify-receipt.js',
    'examples/mcp-opaque-flow.json',
    'examples/mcp-opaque-flow.schema.json',
    'examples/mcp-opaque-destination.json',
    'examples/mcp-opaque-destination.schema.json',
    'planning/value_opaque_mcp_dataflow.md',
    'planning/opaque_flow_formal_properties.md',
    'planning/breakthrough_scorecard.md',
    'planning/common_mcp_workflow_evaluation.md',
    'comparisons/customer-record-lookup.md',
    'comparisons/active-account-count.md',
    'comparisons/incident-log-triage.md',
    'comparisons/web-research.md',
    'comparisons/database-query.md',
    'comparisons/knowledge-graph-lookup.md',
    'comparisons/native-filter-passthrough.md',
    'comparisons/large-commit-triage.md',
    'comparisons/browser-snapshot.md',
    'comparisons/timezone-conversion.md',
    'comparisons/README.md',
    'formal/opaque_flow.pml',
    'benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json',
    'benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json',
    'benchmarks/results/opaque-flow-model-check.first-party-macos-arm64-20260715.json',
    'benchmarks/results/mcp-oss-filesystem.first-party-macos-arm64-20260715.json',
    'benchmarks/results/mcp-oss-cross-server.first-party-macos-arm64-20260716.json',
    'benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json',
    'benchmarks/results/hcp-comparison.first-party-macos-arm64-20260716.json',
    'benchmarks/competitors/hcp_same_workflow_adapter.mjs',
    'benchmarks/v2/hcp_comparison_gate.mjs',
    'dist/dashboard/index.js',
    'dist/dashboard/index.d.ts',
    'dist/dashboard/ui/index.html',
    'dist/dashboard/ui/assets/dashboard.js',
    'dist/dashboard/ui/assets/dashboard.css',
    'dist/dashboard/ui/assets/instrument-sans-latin.woff2',
  ]) {
    if (!paths.has(required)) throw new Error(`packed artifact is missing ${required}`);
  }

  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  runNpm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    join(temporary, artifact.filename),
  ]);

  const runtimeScript = [
    `const entries = ${JSON.stringify(publicEntries)};`,
    'for (const entry of entries) await import(entry);',
    "const { McpResultFirewall, MCP_FLOW_TOOL_NAME, MCP_QUERY_TOOL_NAME, parseMcpOpaqueFlowConfig, parseMcpOpaqueFlowDestinationConfig, verifyMcpOpaqueFlowReceipt } = await import('@codepalaiorg/pinpoint/mcp');",
    'const firewall = new McpResultFirewall({ minChars: 10 });',
    "const transformed = firewall.transformResult('smoke', { content: [{ type: 'text', text: JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id, value: `exact-smoke-value-${id}` }))) }] });",
    "if (!transformed.virtualized) throw new Error('public MCP firewall did not virtualize');",
    "const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, { id: transformed.descriptor.id, op: 'json_select', where: { id: 73 }, fields: ['value'] });",
    "if (!queried.content[0].text.includes('exact-smoke-value-73')) throw new Error('public MCP query did not recover exact value');",
    "const flowConfig = parseMcpOpaqueFlowConfig({ version: 1, flows: [{ name: 'smoke_flow', sourceTool: 'source', sourceKind: 'json-array', destinationTool: 'destination', destinationArgument: 'records', allowedOps: ['json_select'], allowedFields: ['value'] }] });",
    "if (MCP_FLOW_TOOL_NAME !== 'pinpoint_flow' || flowConfig.exposeQueryTool || !flowConfig.opaqueArtifactIds) throw new Error('public opaque-flow config defaults are invalid');",
    "const destination = parseMcpOpaqueFlowDestinationConfig({ version: 1, id: 'smoke-domain', command: 'smoke-destination', envAllowlist: ['PATH', 'DESTINATION_TOKEN'], sharedEnvAllowlist: ['PATH'] }, { PATH: '/usr/bin', DESTINATION_TOKEN: 'destination-only', SOURCE_TOKEN: 'source-only' });",
    "if (destination.env.DESTINATION_TOKEN !== 'destination-only' || destination.env.SOURCE_TOKEN != null || destination.sharedEnvNames.join(',') !== 'PATH') throw new Error('public destination config isolation is invalid');",
    "if (verifyMcpOpaqueFlowReceipt({})) throw new Error('public receipt verifier accepted an invalid receipt');",
    "const { createDashboardGroupId, normalizeDashboardEvent } = await import('@codepalaiorg/pinpoint/dashboard');",
    "if (!/^dash_[a-f0-9]{32}$/.test(createDashboardGroupId())) throw new Error('public dashboard group id is invalid');",
    "const dashboardMetric = (value) => ({ value, unit: 'tokens', source: 'pinpoint', basis: 'estimate', scope: 'request' });",
    "const dashboardEvent = normalizeDashboardEvent({ schemaVersion: 1, type: 'provider.route', source: 'pinpoint', occurredAt: new Date(0).toISOString(), provider: 'openai', model: 'smoke', authMode: 'payg', mode: 'optimize', durationMs: 1, tokensText: dashboardMetric(10), tokensCompressed: dashboardMetric(4), tokensSaved: dashboardMetric(6), reversibleCount: 0, stages: [{ stage: 'virtual', applied: true, reason: 'applied', tokensText: 10, tokensCompressed: 4, tokensSaved: 6, basis: 'estimate' }] });",
    "if (dashboardEvent.tokensSaved.value !== 6) throw new Error('public dashboard event contract is invalid');",
    'console.log(`imported ${entries.length} public entry points`);',
  ].join('\n');
  run(process.execPath, ['--input-type=module', '--eval', runtimeScript]);

  const bindings = publicEntries.map((entry, index) => `import * as entry${index} from '${entry}';`);
  bindings.push(`void [${publicEntries.map((_, index) => `entry${index}`).join(', ')}];`);
  writeFileSync(join(temporary, 'smoke.mts'), `${bindings.join('\n')}\n`);
  run(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--strict',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'smoke.mts',
  ]);

  const cli = join(temporary, 'node_modules', '@codepalaiorg', 'pinpoint', 'bin', 'cli.js');
  const receiptVerifier = join(temporary, 'node_modules', '@codepalaiorg', 'pinpoint', 'bin', 'verify-receipt.js');
  if (run(process.execPath, [cli, '--version']).trim() !== artifact.version) {
    throw new Error('installed CLI version does not match the packed version');
  }
  run(process.execPath, [cli, '--help']);
  const authorityKey = join(temporary, 'operator-authority.pem');
  const authority = JSON.parse(run(process.execPath, [
    cli,
    'mcp',
    'authority',
    'init',
    '--out',
    authorityKey,
  ]));
  if (!/^[a-f0-9]{64}$/.test(authority.operatorKeyId)) {
    throw new Error('installed authority initializer returned an invalid operator key id');
  }
  if (process.platform !== 'win32' && (statSync(authorityKey).mode & 0o777) !== 0o600) {
    throw new Error('installed authority initializer did not create a mode-0600 key');
  }
  const demo = run(process.execPath, [cli, 'demo']);
  for (const expected of [
    'destination: 40/40 exact recipients persisted',
    'bypass attempts denied: 4/4',
    'private values in client transcript: 0/401',
    'destination dispatches: 1 authorized; 0 bypass side effects',
    'signed receipt: valid against initialized verifier; wrong verifier rejected',
    'processes: source and destination PIDs are separate from the CLI',
    'transport: local stdio only; external services configured: none',
    'passed: true',
  ]) {
    if (!demo.includes(expected)) throw new Error(`installed demo is missing: ${expected}`);
  }
  const doctor = run(process.execPath, [cli, 'doctor']);
  for (const expected of [
    'doctor: mcp',
    'core gateway self-test: PASS',
    'ready: pinpoint mcp gateway -- <your-server> [args...]',
  ]) {
    if (!doctor.includes(expected)) throw new Error(`installed doctor is missing: ${expected}`);
  }
  const stdoutReproduction = JSON.parse(run(process.execPath, [
    cli,
    'evidence',
    'reproduce',
    '--relationship',
    'maintainer',
  ]));
  if (
    stdoutReproduction.passed !== true ||
    stdoutReproduction.summary?.repeatedFlowCalls !== 30 ||
    stdoutReproduction.denials?.length !== 8
  ) {
    throw new Error('installed evidence command did not emit valid stdout JSON');
  }
  const reproductionPath = join(temporary, 'opaque-flow-reproduction.json');
  run(process.execPath, [
    cli,
    'evidence',
    'reproduce',
    '--relationship',
    'maintainer',
    '--out',
    reproductionPath,
  ]);
  if (process.platform !== 'win32' && (statSync(reproductionPath).mode & 0o777) !== 0o600) {
    throw new Error('installed evidence command did not create a mode-0600 bundle');
  }
  const reproductionVerification = JSON.parse(run(process.execPath, [
    cli,
    'evidence',
    'verify',
    reproductionPath,
  ]));
  if (
    reproductionVerification.valid !== true ||
    reproductionVerification.repeatedFlowCalls !== 30 ||
    reproductionVerification.bypassesDenied !== 8 ||
    reproductionVerification.privateValuesVisible !== 0 ||
    reproductionVerification.checks?.schema !== true ||
    reproductionVerification.checks?.checksum !== true ||
    reproductionVerification.checks?.receiptChain !== true ||
    reproductionVerification.checks?.reportedResults !== true ||
    reproductionVerification.checks?.runtimeManifest !== true ||
    reproductionVerification.checks?.relationshipDeclared !== true ||
    reproductionVerification.checks?.operatorAuthenticated !== false
  ) {
    throw new Error('installed evidence reproduction did not verify');
  }
  const originalReproduction = readFileSync(reproductionPath);
  let overwriteRejected = false;
  try {
    run(process.execPath, [
      cli,
      'evidence',
      'reproduce',
      '--relationship',
      'maintainer',
      '--out',
      reproductionPath,
    ]);
  } catch (cause) {
    const stderr = cause != null && typeof cause === 'object' && 'stderr' in cause
      ? String(cause.stderr)
      : '';
    overwriteRejected = /output already exists/.test(stderr);
  }
  if (!overwriteRejected) throw new Error('installed evidence command did not reject existing output');
  if (!readFileSync(reproductionPath).equals(originalReproduction)) {
    throw new Error('installed evidence command changed an existing bundle');
  }
  const malformedBundle = join(temporary, 'malformed-reproduction.json');
  writeFileSync(malformedBundle, '{', 'utf8');
  let malformedRejected = false;
  try {
    run(process.execPath, [cli, 'evidence', 'verify', malformedBundle]);
  } catch (cause) {
    const stderr = cause != null && typeof cause === 'object' && 'stderr' in cause
      ? String(cause.stderr)
      : '';
    malformedRejected = /could not verify evidence bundle/.test(stderr);
  }
  if (!malformedRejected) throw new Error('installed evidence verifier accepted malformed JSON');
  const oversizedBundle = join(temporary, 'oversized-reproduction.json');
  writeFileSync(oversizedBundle, Buffer.alloc(256 * 1024 + 1));
  let oversizedRejected = false;
  try {
    run(process.execPath, [cli, 'evidence', 'verify', oversizedBundle]);
  } catch (cause) {
    const stderr = cause != null && typeof cause === 'object' && 'stderr' in cause
      ? String(cause.stderr)
      : '';
    oversizedRejected = /bundle exceeds 262144 bytes/.test(stderr);
  }
  if (!oversizedRejected) throw new Error('installed evidence verifier accepted an oversized bundle');
  let nonRegularRejected = false;
  try {
    run(process.execPath, [cli, 'evidence', 'verify', temporary]);
  } catch (cause) {
    const stderr = cause != null && typeof cause === 'object' && 'stderr' in cause
      ? String(cause.stderr)
      : '';
    nonRegularRejected = /bundle must be a regular file/.test(stderr);
  }
  if (!nonRegularRejected) throw new Error('installed evidence verifier accepted a non-regular file');
  const installedReadme = join(
    temporary,
    'node_modules',
    '@codepalaiorg',
    'pinpoint',
    'README.md',
  );
  const sourceReadmeText = readFileSync(join(root, 'README.md'), 'utf8');
  const installedPackageJson = JSON.parse(readFileSync(join(
    temporary,
    'node_modules',
    '@codepalaiorg',
    'pinpoint',
    'package.json',
  ), 'utf8'));
  if (
    installedPackageJson.name !== artifact.name ||
    installedPackageJson.version !== artifact.version ||
    installedPackageJson.types !== './dist/index.d.ts' ||
    installedPackageJson.sideEffects !== false
  ) {
    throw new Error('installed package metadata does not match the reviewed contract');
  }
  const installedReadmeText = readFileSync(installedReadme, 'utf8');
  if (installedReadmeText !== sourceReadmeText) {
    throw new Error('installed README does not exactly match the reviewed source README');
  }
  const installedReceipt = join(
    temporary,
    'node_modules',
    '@codepalaiorg',
    'pinpoint',
    'benchmarks',
    'results',
    'mcp-opaque-flow.first-party-macos-arm64-20260715.json',
  );
  const verification = JSON.parse(run(process.execPath, [
    receiptVerifier,
    installedReceipt,
    '--path',
    'firstReceipt',
  ]));
  if (verification.valid !== true) throw new Error('installed standalone receipt verifier failed');

  console.log(
    `package smoke: ok (${artifact.name}@${artifact.version}, ${publicEntries.length} exports, ` +
      `${paths.size}/${packageBudget.maxFiles} files, ${artifact.size}/${packageBudget.maxPackedBytes} bytes)`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
