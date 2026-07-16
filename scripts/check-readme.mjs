import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const receipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'evidence-gate.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const gatewayReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-gateway-agent.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const crossHostReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-gateway-cross-host.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const opaqueFlowReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-opaque-flow.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const opaqueFlowCrossHostReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const opaqueFlowModelReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'opaque-flow-model-check.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const ossFilesystemReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-oss-filesystem.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const ossCrossServerReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-oss-cross-server.first-party-macos-arm64-20260716.json',
    ),
    'utf8',
  ),
);
const commonWorkflowsReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-common-workflows.first-party-macos-arm64-20260716.json',
    ),
    'utf8',
  ),
);
const hcpComparisonReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'hcp-comparison.first-party-macos-arm64-20260716.json',
    ),
    'utf8',
  ),
);
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const commonComparisonPages = [
  ['comparisons/customer-record-lookup.md', 'filesystem-exact-record-lookup'],
  ['comparisons/active-account-count.md', 'filesystem-filtered-count'],
  ['comparisons/incident-log-triage.md', 'filesystem-incident-log-triage'],
  ['comparisons/web-research.md', 'fetch-web-research'],
  ['comparisons/database-query.md', 'database-large-query-result'],
  ['comparisons/knowledge-graph-lookup.md', 'memory-knowledge-graph-lookup'],
  ['comparisons/native-filter-passthrough.md', 'memory-native-node-lookup-control'],
  ['comparisons/large-commit-triage.md', 'git-large-commit-triage'],
  ['comparisons/browser-snapshot.md', 'playwright-browser-snapshot'],
  ['comparisons/timezone-conversion.md', 'time-zone-conversion-control'],
];
const proofAssetPath = join(root, 'assets', 'qcv-evidence-gate.svg');
const proofAsset = readFileSync(proofAssetPath, 'utf8');
const failures = [];

const fail = (message) => failures.push(message);
const integer = new Intl.NumberFormat('en-US');
const percentage = (value) => `${(value * 100).toFixed(1)}%`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown) {
  const counts = new Map();
  const slugs = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = githubSlug(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return slugs;
}

function localTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1]);
  for (const match of markdown.matchAll(/\b(?:href|src)="([^"]+)"/g)) targets.push(match[1]);
  return targets;
}

function isPackaged(relativePath) {
  return packageJson.files.some((entry) => {
    if (entry.startsWith('!')) return false;
    const normalized = entry.replace(/\/$/, '');
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

const slugs = headingSlugs(readme);
const codeFenceCount = [...readme.matchAll(/^```/gm)].length;
if (codeFenceCount % 2 !== 0) fail(`README has an unbalanced fenced code block count: ${codeFenceCount}`);
const detailsOpenCount = [...readme.matchAll(/<details>/g)].length;
const detailsCloseCount = [...readme.matchAll(/<\/details>/g)].length;
if (detailsOpenCount !== detailsCloseCount) {
  fail(`README has unbalanced details blocks: ${detailsOpenCount} open, ${detailsCloseCount} closed`);
}
if (readme.split('\n').some((line) => (line.match(/```/g)?.length ?? 0) > 1)) {
  fail('README contains multiple fenced-code markers on one line');
}
for (const target of localTargets(readme)) {
  if (target.startsWith('#')) {
    const anchor = decodeURIComponent(target.slice(1));
    if (!slugs.has(anchor)) fail(`README anchor does not exist: ${target}`);
    continue;
  }
  if (/^(?:https?:|mailto:)/.test(target)) continue;
  const [relative] = decodeURIComponent(target).split('#');
  if (!relative) continue;
  const absolute = resolve(dirname(readmePath), relative);
  const relativeToRoot = relativePath(root, absolute);
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) {
    fail(`README local target escapes the repository: ${target}`);
  } else if (!existsSync(absolute)) {
    fail(`README local target does not exist: ${target}`);
  } else {
    const packagePath = relativeToRoot.split(sep).join('/');
    if (packagePath && !isPackaged(packagePath)) {
      fail(`README local target is omitted from package.json files: ${target}`);
    }
  }
}

const { methodology } = receipt;
const headroom = receipt.summary.arms.headroom;
const qcv = receipt.summary.arms.qcv;
const comparison = receipt.summary.comparisons.qcvVsHeadroom;
const evidenceStrings = [
  integer.format(headroom.inputTokens),
  integer.format(qcv.inputTokens),
  percentage(comparison.costReduction),
  `${headroom.correct}/${headroom.observations}`,
  `${qcv.correct}/${qcv.observations}`,
  `${(comparison.harmRateOneSided95Upper * 100).toFixed(2)}%`,
];
for (const value of evidenceStrings) {
  if (!readme.includes(value)) fail(`README is missing paid-receipt value: ${value}`);
  if (!proofAsset.includes(value)) fail(`proof asset is missing paid-receipt value: ${value}`);
}

for (const value of [
  `$${receipt.summary.arms.raw.costUSD.toFixed(6)}`,
  `$${headroom.costUSD.toFixed(6)}`,
  `$${qcv.costUSD.toFixed(6)}`,
  percentage(receipt.summary.comparisons.qcvVsRaw.costReduction),
  percentage(comparison.inputReduction),
]) {
  if (!readme.includes(value)) fail(`README is missing provider-wire receipt value: ${value}`);
}

for (const value of [
  integer.format(gatewayReceipt.result.upstreamStructuredChars),
  integer.format(gatewayReceipt.result.largestModelVisibleToolResultChars),
  percentage(gatewayReceipt.result.modelVisibleCharacterReduction),
  gatewayReceipt.result.expected,
  `$${gatewayReceipt.result.observedCostUSD.toFixed(6)}`,
]) {
  if (!readme.includes(value)) fail(`README is missing MCP gateway receipt value: ${value}`);
}
for (const [sourcePath, expectedHash] of Object.entries(gatewayReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`MCP gateway receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) {
    fail(`MCP gateway receipt fingerprint is stale: ${sourcePath}`);
  }
}
for (const [sourcePath, expectedHash] of Object.entries(crossHostReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`cross-host receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) {
    fail(`cross-host receipt fingerprint is stale: ${sourcePath}`);
  }
}
for (const evidence of [opaqueFlowReceipt, opaqueFlowCrossHostReceipt]) {
  for (const [sourcePath, expectedHash] of Object.entries(evidence.source.fingerprints)) {
    const absolute = join(root, sourcePath);
    if (!existsSync(absolute)) {
      fail(`opaque-flow receipt source does not exist: ${sourcePath}`);
      continue;
    }
    const actualHash = sha256(readFileSync(absolute));
    if (actualHash !== expectedHash) {
      fail(`opaque-flow receipt fingerprint is stale: ${sourcePath}`);
    }
  }
}
for (const [sourcePath, expectedHash] of Object.entries(opaqueFlowModelReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`opaque-flow model source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) {
    fail(`opaque-flow model receipt fingerprint is stale: ${sourcePath}`);
  }
}
for (const [sourcePath, expectedHash] of Object.entries(ossFilesystemReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`OSS filesystem receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) fail(`OSS filesystem receipt fingerprint is stale: ${sourcePath}`);
}
for (const [sourcePath, expectedHash] of Object.entries(ossCrossServerReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`OSS cross-server receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) fail(`OSS cross-server receipt fingerprint is stale: ${sourcePath}`);
}
for (const [sourcePath, expectedHash] of Object.entries(commonWorkflowsReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`common-workflows receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) fail(`common-workflows receipt fingerprint is stale: ${sourcePath}`);
}
for (const value of [
  `${commonWorkflowsReceipt.summary.workflowsPassed}/${commonWorkflowsReceipt.summary.workflows} exact`,
  percentage(commonWorkflowsReceipt.summary.aggregateVisibleByteReduction),
  integer.format(commonWorkflowsReceipt.summary.unrelatedCanariesAvoided),
  integer.format(commonWorkflowsReceipt.summary.directVisibleBytes),
  integer.format(commonWorkflowsReceipt.summary.pinpointVisibleBytes),
]) {
  if (!readme.includes(value)) fail(`README is missing common-workflow result: ${value}`);
}
const commonWorkflowsById = new Map(
  commonWorkflowsReceipt.workflows.map((workflow) => [workflow.id, workflow]),
);
for (const [pagePath, workflowId] of commonComparisonPages) {
  const workflow = commonWorkflowsById.get(workflowId);
  if (!workflow) {
    fail(`common-workflows receipt is missing comparison case: ${workflowId}`);
    continue;
  }
  const absolute = join(root, pagePath);
  if (!existsSync(absolute)) {
    fail(`common-workflow comparison page does not exist: ${pagePath}`);
    continue;
  }
  const page = readFileSync(absolute, 'utf8');
  const expectedValues = [
    `Benchmark case: \`${workflowId}\``,
    `**${integer.format(workflow.direct.visibleBytes)} bytes**`,
    `**${integer.format(workflow.pinpoint.visibleBytes)} bytes**`,
    `**${integer.format(workflow.direct.unrelatedCanariesVisible)}**`,
    `**${integer.format(workflow.pinpoint.unrelatedCanariesVisible)}**`,
  ];
  if (workflow.comparison.visibleByteReduction > 0) {
    expectedValues.push(`**${percentage(workflow.comparison.visibleByteReduction)} less**`);
  }
  if (workflow.direct.sourceMetrics?.externalizedBytes != null) {
    expectedValues.push(
      `**${integer.format(workflow.direct.sourceMetrics.externalizedBytes)} bytes**`,
      `**${integer.format(workflow.direct.sourceMetrics.unrelatedMarkers)}**`,
    );
  }
  for (const value of expectedValues) {
    if (!page.includes(value)) fail(`${pagePath} is missing receipt value: ${value}`);
  }
  for (const target of localTargets(page)) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const [relative] = decodeURIComponent(target).split('#');
    if (!relative) continue;
    const targetPath = resolve(dirname(absolute), relative);
    if (!existsSync(targetPath)) fail(`${pagePath} has a missing local target: ${target}`);
  }
  for (const value of [
    integer.format(workflow.direct.visibleBytes),
    integer.format(workflow.pinpoint.visibleBytes),
  ]) {
    if (!readme.includes(value)) fail(`README is missing ${workflowId} result: ${value}`);
  }
  if (workflow.comparison.visibleByteReduction > 0) {
    const reduction = percentage(workflow.comparison.visibleByteReduction);
    if (!readme.includes(reduction)) fail(`README is missing ${workflowId} result: ${reduction}`);
  } else if (!readme.includes('Byte-identical')) {
    fail(`README is missing ${workflowId} passthrough result: Byte-identical`);
  }
}
const comparisonIndexPath = join(root, 'comparisons', 'README.md');
const comparisonIndex = readFileSync(comparisonIndexPath, 'utf8');
for (const target of localTargets(comparisonIndex)) {
  if (/^(?:https?:|mailto:|#)/.test(target)) continue;
  const [relative] = decodeURIComponent(target).split('#');
  if (!relative) continue;
  const targetPath = resolve(dirname(comparisonIndexPath), relative);
  if (!existsSync(targetPath)) fail(`comparisons/README.md has a missing local target: ${target}`);
}
for (const source of commonWorkflowsReceipt.research.primarySources) {
  if (!comparisonIndex.includes(source)) fail(`comparison research index is missing source: ${source}`);
}
for (const value of Object.values(commonWorkflowsReceipt.research.adoptionSignals)) {
  if (!comparisonIndex.includes(integer.format(value))) {
    fail(`comparison research index is missing adoption signal: ${integer.format(value)}`);
  }
}
for (const sourcePath of [
  'benchmarks/competitors/hcp_same_workflow_adapter.mjs',
  'benchmarks/v2/hcp_comparison_gate.mjs',
  'benchmarks/v2/mcp_oss_cross_server_gate.mjs',
]) {
  const expectedHash = hcpComparisonReceipt.source.fingerprints[sourcePath];
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`HCP comparison source does not exist: ${sourcePath}`);
    continue;
  }
  if (sha256(readFileSync(absolute)) !== expectedHash) {
    fail(`HCP comparison receipt fingerprint is stale: ${sourcePath}`);
  }
}
for (const value of [
  `${crossHostReceipt.summary.hostsPassed}/${crossHostReceipt.summary.hostsExecuted}`,
  integer.format(crossHostReceipt.hosts[1].largestToolCompletionEventChars),
  crossHostReceipt.hosts[0].clientVersion,
  crossHostReceipt.hosts[1].clientVersion,
  crossHostReceipt.hosts[1].model,
]) {
  if (!readme.includes(value)) fail(`README is missing cross-host receipt value: ${value}`);
}
for (const value of [
  `${opaqueFlowReceipt.summary.destinationAcceptedCalls}/${opaqueFlowReceipt.summary.flowCalls}`,
  `${opaqueFlowReceipt.summary.bypassesDenied}/${opaqueFlowReceipt.summary.bypassAttempts}`,
  `${opaqueFlowReceipt.summary.privateCanariesScanned}/${opaqueFlowReceipt.summary.privateCanariesScanned}`,
  integer.format(opaqueFlowReceipt.summary.baselineVisibleBytes),
  integer.format(opaqueFlowReceipt.summary.opaqueVisibleBytes),
  `${opaqueFlowReceipt.summary.visibleByteReductionPercent.toFixed(1)}%`,
  `${opaqueFlowReceipt.latencyMs.p95.toFixed(2)} ms`,
]) {
  if (!readme.includes(value)) fail(`README is missing opaque-flow protocol value: ${value}`);
}
for (const value of [
  `${opaqueFlowCrossHostReceipt.summary.hostsPassed}/${opaqueFlowCrossHostReceipt.summary.hostsExecuted}`,
  integer.format(
    opaqueFlowCrossHostReceipt.summary.privateCanariesScannedPerHost *
      opaqueFlowCrossHostReceipt.summary.hostsExecuted,
  ),
  `$${opaqueFlowCrossHostReceipt.hosts[0].observedCostUSD.toFixed(6)}`,
  opaqueFlowCrossHostReceipt.fixture.finalAnswer,
  opaqueFlowCrossHostReceipt.hosts[0].clientVersion.match(/\d+(?:\.\d+)+(?:-\d+)?/)?.[0],
  opaqueFlowCrossHostReceipt.hosts[1].clientVersion.match(/\d+(?:\.\d+)+(?:-\d+)?/)?.[0],
]) {
  if (!readme.includes(value)) fail(`README is missing opaque-flow cross-host value: ${value}`);
}
for (const value of [
  integer.format(opaqueFlowModelReceipt.model.statesStored),
  integer.format(opaqueFlowModelReceipt.model.transitions),
  `${opaqueFlowModelReceipt.model.assertionViolations} violations`,
]) {
  if (!readme.includes(value)) fail(`README is missing opaque-flow model-check value: ${value}`);
}
for (const value of [
  ossFilesystemReceipt.upstream.package,
  ossFilesystemReceipt.upstream.version,
  `${ossFilesystemReceipt.summary.exactAnswer ? 1 : 0}/1`,
]) {
  if (!readme.includes(value)) fail(`README is missing OSS filesystem receipt value: ${value}`);
}
for (const value of [
  ossCrossServerReceipt.sourceServer.package,
  ossCrossServerReceipt.sourceServer.version,
  ossCrossServerReceipt.destinationServer.package,
  ossCrossServerReceipt.destinationServer.version,
  `${ossCrossServerReceipt.summary.persistedEntities}/${ossCrossServerReceipt.fixture.selectedRecords}`,
  `${ossCrossServerReceipt.summary.privateCanariesLeaked}/${ossCrossServerReceipt.summary.privateCanariesScanned}`,
]) {
  if (!readme.includes(value)) fail(`README is missing OSS cross-server receipt value: ${value}`);
}
for (const value of [
  hcpComparisonReceipt.pins.hcpCommit,
  `${hcpComparisonReceipt.repositoryValidation.hcp.passed}/${hcpComparisonReceipt.repositoryValidation.hcp.tests}`,
  `${hcpComparisonReceipt.commonOutcome.hcp.exactRuns}/${hcpComparisonReceipt.commonOutcome.hcp.repetitions}`,
  hcpComparisonReceipt.commonOutcome.pinpoint.bypassesDenied,
  hcpComparisonReceipt.commonOutcome.hcp.bypassesDenied,
  hcpComparisonReceipt.commonOutcome.pinpoint.canariesLeaked,
  'No scalar winner',
]) {
  if (!readme.includes(value)) fail(`README is missing HCP comparison value: ${value}`);
}

if (!readme.includes('./assets/qcv-evidence-gate.svg')) fail('README does not render the proof asset');
if (!existsSync(join(root, 'llms.txt'))) fail('llms.txt is missing');
if (!readme.includes('./llms.txt')) fail('README does not link llms.txt');
const endUserSignals = [
  'Let AI agents use private tool data without showing it to the model.',
  '## Ten everyday MCP jobs. Ten exact answers.',
  'Pinpoint sits between your AI agent and an MCP server.',
  'The lossless MCP result firewall for AI agents',
  '### A concrete example',
  '**Without Pinpoint**',
  '**With Pinpoint**',
  '## Install',
  '### Fastest working demo',
  'npm run bench:mcp-oss-cross-server',
  '## Pick your mode',
  '### Mode 1: result firewall',
  '### Mode 2: value-opaque flow',
  '## Where it fits',
  '## When Pinpoint is a bad fit',
  '## Evidence',
  '## Security boundary',
  'npm run verify',
  'RELEASING.md',
  'Bounded reference model',
  '## Works with your stack',
  'Subscription-compatible',
  'experimental and available today for controlled local or VPC-side evaluation',
  'pinpoint mcp gateway --',
  '--flow-config',
  '--destination-config',
  'sharedEnvAllowlist',
  'pinpoint_flow',
  'verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier)',
  'Pinpoint returns the receipt through MCP but does not persist it.',
];
for (const signal of endUserSignals) {
  if (!readme.includes(signal)) fail(`README is missing end-user onboarding signal: ${signal}`);
}
if (/[]/.test(readme)) fail('README contains control characters');
if (/[—–“”]/.test(readme)) fail('README contains non-ASCII dash or quote punctuation');

const visibleReadme = readme.replace(/<!--[^]*?-->/g, '');
const npmStatusMatches = [...readme.matchAll(/<!-- PINPOINT_NPM_STATUS: (unpublished|candidate|published) -->/g)];
if (npmStatusMatches.length !== 1) fail('README must declare exactly one PINPOINT_NPM_STATUS marker');
const waitingForNpm = npmStatusMatches[0]?.[1] === 'unpublished';
if (waitingForNpm) {
  if (!visibleReadme.includes('git clone https://github.com/CodePalAI/pinpoint.git')) {
    fail('pre-npm README is missing the verified public clone command');
  }
  if (!visibleReadme.includes('npm ci && npm link')) {
    fail('pre-npm README is missing the verified checkout CLI setup');
  }
  if (!visibleReadme.includes('npm install /path/to/pinpoint')) {
    fail('pre-npm README is missing the local-directory SDK install');
  }
  for (const unavailable of [
    'npm install -g @codepal/pinpoint',
    'npm install @codepal/pinpoint',
    'npx @codepal/pinpoint demo',
  ]) {
    if (visibleReadme.includes(unavailable)) fail(`README advertises unpublished npm path: ${unavailable}`);
  }
  if (visibleReadme.includes('git+https://github.com/CodePalAI/pinpoint.git')) {
    fail('README advertises the unreliable npm Git-dependency path');
  }
} else {
  for (const required of [
    'npm install -g @codepal/pinpoint',
    'npm install @codepal/pinpoint',
    'npx @codepal/pinpoint demo',
  ]) {
    if (!visibleReadme.includes(required)) fail(`release README is missing npm path: ${required}`);
  }
  if (visibleReadme.includes('git+https://github.com/CodePalAI/pinpoint.git')) {
    fail('release README still advertises Git installation');
  }
}

if (failures.length > 0) {
  console.error(`README check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `README check: ok (${slugs.size} headings, ${localTargets(readme).length} links/assets, receipt synchronized)`,
);