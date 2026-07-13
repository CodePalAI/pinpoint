// Arm F — PROSE region: does PIXROOM_SEMANTIC_PROSE recover savings the other
// configs leave on the table, without harming the tool_result/optical regions?
//
// Follows the same route as proof.mjs (headroom's benchmarking discipline):
// named realistic scenarios, INPUT-TOKEN savings from before/after, one consistent
// basis across all configs (gpt-tokenizer for text + Anthropic's exact image
// formula for optical), summed counts (never averaged %), signed and honest.
//
// The region under test is a large PLAIN-PROSE block in a USER message — the
// classic RAG / pasted-context pattern. pxpipe images only the system slab and
// the tool_result stage only touches tool_result blocks, so every config EXCEPT
// the prose path passes that block through raw. The prose path routes it to
// headroom's Kompress (ModernBERT prose token-drop), reversibly via CCR.
//
// Requires the headroom sidecar to have the Kompress tokenizer available
// (`pip install transformers` — the lightweight ONNX path, no torch). Without it
// headroom no-ops prose and the +prose rows tie their baselines (reported as-is).

import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createPixroom } from '../dist/index.js';
import {
  countTokens,
  effectiveTokens,
  makeSystemSlab,
  makeJsonToolResult,
  makeProseContext,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const HEADROOM_PORT = 8787;
const sidecarUrl = `http://127.0.0.1:${HEADROOM_PORT}`;
const MODEL = 'claude-fable-5'; // pxpipe-supported so optical engages on the slab

function isExec(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function locateHeadroom() {
  return (
    [
      process.env.PIXROOM_HEADROOM_BIN,
      join(homedir(), 'repos-pixroom', '.headroom-venv', 'bin', 'headroom'),
    ]
      .filter(Boolean)
      .find(isExec) || 'headroom'
  );
}
function waitHealth(url, ms = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = async () => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return resolve(true);
      } catch {
        /* not up */
      }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}

// ── scenarios ────────────────────────────────────────────────────────────────
function buildScenarios() {
  const bigSlab = makeSystemSlab();
  const tinySlab = 'You are a concise assistant that answers questions from the provided context.';
  return [
    {
      name: 'rag-doc',
      category: 'prose',
      slab: tinySlab,
      prose: makeProseContext(9000, 7),
      tools: [],
      note: 'retrieved doc prose in a user block, tiny slab (only the prose path helps)',
    },
    {
      name: 'rag-large',
      category: 'prose',
      slab: tinySlab,
      prose: makeProseContext(16000, 11),
      tools: [],
      note: 'large retrieved context (~16k chars) in a user block',
    },
    {
      name: 'mixed-all',
      category: 'mixed',
      slab: bigSlab,
      prose: makeProseContext(9000, 3),
      tools: [makeJsonToolResult(150)],
      note: 'big slab + JSON tool_result + user prose (all three regions → additivity)',
    },
    {
      name: 'control-tools',
      category: 'control',
      slab: bigSlab,
      prose: '',
      tools: [makeJsonToolResult(150)],
      note: 'no prose → the prose path MUST equal its baseline (proves no harm)',
    },
  ];
}

function buildBody(sc) {
  const content = [
    { type: 'text', text: 'Using the context below, summarize the rollout strategy and failure modes.' },
  ];
  if (sc.prose) content.push({ type: 'text', text: sc.prose });
  sc.tools.forEach((t, i) => content.push({ type: 'tool_result', tool_use_id: `t${i}`, content: t }));
  return {
    model: MODEL,
    system: [{ type: 'text', text: sc.slab, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  };
}

// protect_recent:0 matches headroom's eval convention; proseMinChars:400 so the
// short question stays untouched while the large prose block is eligible.
const SEM = (includeUserProse) => ({
  enabled: true,
  sidecarUrl,
  autoSpawn: false,
  protectRecent: 0,
  includeUserProse,
  proseMinChars: 400,
});
const CONFIGS = {
  'pxpipe-only': { optical: { enabled: true }, semantic: { enabled: false } },
  'headroom-tools': { optical: { enabled: false }, semantic: SEM(false) },
  'headroom+prose': { optical: { enabled: false }, semantic: SEM(true) },
  'pixroom-default': { optical: { enabled: true }, semantic: SEM(false) },
  'pixroom+prose': { optical: { enabled: true }, semantic: SEM(true) },
};

async function measure(cfgOverrides, body) {
  const px = createPixroom({ ...cfgOverrides, logLevel: 'silent' });
  const routed = await px.route('anthropic', MODEL, structuredClone(body), 'payg');
  const tokens = effectiveTokens(routed.body, routed.report);
  const reversible = routed.reversible.length;
  await px.shutdown();
  return { tokens, reversible };
}

async function main() {
  const child = spawn(locateHeadroom(), ['proxy', '--port', String(HEADROOM_PORT)], {
    cwd: repoRoot,
    env: { ...process.env, HEADROOM_MODE: 'cache' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const ok = await waitHealth(sidecarUrl);
  if (!ok) console.error('WARNING: headroom sidecar not healthy — prose/tool rows will degrade.');

  const scenarios = buildScenarios();
  const results = { model: MODEL, sidecar: ok, generatedAt: new Date().toISOString(), scenarios: [] };

  for (const sc of scenarios) {
    const body = buildBody(sc);
    const raw = countTokens(JSON.stringify(body));
    const cfgOut = {};
    for (const [name, cfg] of Object.entries(CONFIGS)) {
      cfgOut[name] = await measure(cfg, body);
    }
    const proseGainHeadroom = cfgOut['headroom-tools'].tokens - cfgOut['headroom+prose'].tokens;
    const proseGainPixroom = cfgOut['pixroom-default'].tokens - cfgOut['pixroom+prose'].tokens;
    const best = Math.min(...Object.values(cfgOut).map((v) => v.tokens));
    const entry = {
      name: sc.name,
      category: sc.category,
      note: sc.note,
      raw,
      configs: cfgOut,
      proseGainHeadroom,
      proseGainPixroom,
      fullStackIsBest: cfgOut['pixroom+prose'].tokens <= best + 2,
    };
    results.scenarios.push(entry);
    const s = (n) => `${(((raw - n) / raw) * 100).toFixed(0)}%`;
    console.log(
      `${sc.name.padEnd(14)} raw=${raw}\n` +
        `   pxpipe=${cfgOut['pxpipe-only'].tokens}(${s(cfgOut['pxpipe-only'].tokens)})  ` +
        `hr-tools=${cfgOut['headroom-tools'].tokens}(${s(cfgOut['headroom-tools'].tokens)})  ` +
        `hr+prose=${cfgOut['headroom+prose'].tokens}(${s(cfgOut['headroom+prose'].tokens)})\n` +
        `   pixroom=${cfgOut['pixroom-default'].tokens}(${s(cfgOut['pixroom-default'].tokens)})  ` +
        `pixroom+prose=${cfgOut['pixroom+prose'].tokens}(${s(cfgOut['pixroom+prose'].tokens)})  ` +
        `[prose Δ: hr=${proseGainHeadroom}t px=${proseGainPixroom}t]`,
    );
  }

  const proseScenarios = results.scenarios.filter((e) => e.category === 'prose');
  const proseHelps = proseScenarios.every((e) => e.proseGainPixroom > 2);
  const fullStackBestOnMixed = results.scenarios
    .filter((e) => e.category === 'mixed')
    .every((e) => e.fullStackIsBest);
  const control = results.scenarios.find((e) => e.category === 'control');
  const noHarm = control ? Math.abs(control.proseGainPixroom) <= 2 : true;
  results.verdict = { proseHelps, fullStackBestOnMixed, noHarm, kompress: ok };
  console.log(
    `\nVERDICT: prose-helps=${proseHelps}  full-stack-best-on-mixed=${fullStackBestOnMixed}  no-harm-on-control=${noHarm}`,
  );

  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', 'prose.json'), JSON.stringify(results, null, 2));

  if (!child.killed) child.kill('SIGKILL');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 300));
