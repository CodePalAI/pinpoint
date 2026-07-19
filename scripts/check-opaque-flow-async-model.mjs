import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = 'formal/opaque_flow_async.pml';
const checkerPath = 'scripts/check-opaque-flow-async-model.mjs';
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'opaque-flow-async-model-check.first-party-macos-arm64-20260719.json',
);
const source = readFileSync(join(root, modelPath), 'utf8');

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function runModel(model, name) {
  const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-spin-async-'));
  const path = join(temporary, name);
  try {
    writeFileSync(path, model);
    return spawnSync('spin', ['-run', '-m1000000', path], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function number(output, pattern, label) {
  const match = output.match(pattern);
  if (!match?.[1]) throw new Error(`Spin output is missing ${label}`);
  return Number(match[1]);
}

const versionRun = spawnSync('spin', ['-V'], { cwd: root, encoding: 'utf8' });
if (versionRun.status !== 0) {
  console.error('Spin is required. Install Spin 6.5.2 or newer, then rerun npm run formal:opaque-flow:async.');
  process.exit(1);
}

const baseRun = runModel(source, 'opaque_flow_async.pml');
const baseOutput = `${baseRun.stdout ?? ''}${baseRun.stderr ?? ''}`;
const errors = number(baseOutput, /errors:\s*(\d+)/, 'error count');
const statesStored = number(baseOutput, /(\d+) states, stored/, 'stored-state count');
const statesMatched = number(baseOutput, /(\d+) states, matched/, 'matched-state count');
const transitions = number(baseOutput, /(\d+) transitions/, 'transition count');
const depthReached = number(baseOutput, /depth reached\s+(\d+)/, 'search depth');
const unreached = number(baseOutput, /\((\d+) of \d+ states\)/, 'unreached-state count');

const mutations = [
  {
    name: 'duplicate outstanding flow id dispatches twice',
    oldBlock: `:: pending -> duplicate_denied = true`,
    mutatedBlock: `:: pending ->
              dispatches++;
              dispatched = true`,
  },
  {
    name: 'malformed destination status is signed as success',
    oldBlock: `terminal_failure = true;
              emit_terminal(false)`,
    mutatedBlock: `terminal_failure = true;
              emit_terminal(true)`,
  },
  {
    name: 'post-dispatch process loss omits terminal receipt',
    oldBlock: `:: action = CompleteProcessLoss;
           if
           :: pending ->
              terminal_failure = true;
              emit_terminal(false)`,
    mutatedBlock: `:: action = CompleteProcessLoss;
           if
           :: pending ->
              pending = false`,
  },
  {
    name: 'pre-aborted startup spawns the wrapped process',
    oldBlock: `startup_decided = true;
              pre_aborted = true`,
    mutatedBlock: `startup_decided = true;
              pre_aborted = true;
              started = true`,
  },
];

const mutationResults = mutations.map((mutation, index) => {
  if (!source.includes(mutation.oldBlock)) {
    throw new Error(`async model mutation anchor changed: ${mutation.name}`);
  }
  const run = runModel(
    source.replace(mutation.oldBlock, mutation.mutatedBlock),
    `opaque_flow_async_mutation_${index}.pml`,
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const assertionViolations = Number(output.match(/errors:\s*(\d+)/)?.[1] ?? 0);
  if (assertionViolations < 1 || !/assertion violated/.test(output)) {
    console.error(output);
    throw new Error(`Spin did not detect the deliberate mutation: ${mutation.name}`);
  }
  return {
    mutation: mutation.name,
    expected: 'at least one assertion violation',
    assertionViolations,
  };
});

const result = {
  schemaVersion: 1,
  evidenceLevel: 'bounded-model-check',
  kind: 'mcp-value-opaque-flow-async-reference-model',
  date: new Date().toISOString().slice(0, 10),
  passed: baseRun.status === 0 && errors === 0 && unreached === 0,
  environment: {
    platform: platform(),
    release: release(),
    architecture: arch(),
    node: process.version,
    spin: `${versionRun.stdout}${versionRun.stderr}`.trim(),
  },
  model: {
    path: modelPath,
    maxStepsPerTrace: 8,
    depthReached,
    statesStored,
    statesMatched,
    transitions,
    unreachedControlStates: unreached,
    assertionViolations: errors,
  },
  mutationSensitivity: {
    passed: true,
    mutations: mutationResults,
    assertionViolations: mutationResults.reduce(
      (sum, mutation) => sum + mutation.assertionViolations,
      0,
    ),
  },
  checkedProperties: [
    'A pre-aborted startup never starts the wrapped process.',
    'At most one destination dispatch is outstanding.',
    'A duplicate outstanding flow id does not dispatch again.',
    'Catalog-invalid state cannot dispatch.',
    'Every modeled terminal completion emits exactly one chain-linked receipt.',
    'Malformed status and process loss emit failure, never success.',
  ],
  source: {
    fingerprints: {
      [modelPath]: fingerprint(modelPath),
      [checkerPath]: fingerprint(checkerPath),
    },
  },
  limitations: [
    'This model covers asynchronous lifecycle accounting, not payload values or policy predicates.',
    'The search is bounded to eight actions over one outstanding-flow slot.',
    'A trace may end with one pending dispatch; eventual completion requires runtime/process assumptions.',
    'Whole-gateway crash, OS isolation, cryptography, JSON parsing, and exactly-once side effects are abstracted.',
  ],
};

if (process.argv.includes('--write')) {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;