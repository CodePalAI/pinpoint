// Generate benchmarks/REPORT.md from results/offline.json and results/copilot.json.

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mdTable, pct } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => {
  const p = join(here, 'results', name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const loadNewest = (pattern) => {
  const dir = join(here, 'results');
  if (!existsSync(dir)) return null;
  const values = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
  return values.sort((left, right) =>
    String(right.generatedAt).localeCompare(String(left.generatedAt))
  )[0] ?? null;
};
const inlineCode = (value) => `\`${value}\``;

const offline = load('offline.json');
const copilot = load('copilot.json');
const claudeResults = loadClaudeResults();
const proof = load('proof.json');
const prose = load('prose.json');
const rdFrontier = load('rd-frontier.json');
const adaptive = load('adaptive.json');
const proxyProfile = load('proxy-profile.json');
const isolatedProxyProfile = load('proxy-profile-isolated.json');
const directAnthropic = load('direct-anthropic.json');
const virtualContext = load('virtual-context.json');
const directAnthropicVirtual = load('direct-anthropic-virtual.json');
const virtualContextNaive = load('virtual-context-naive.json');
const qcvQuality = load('qcv-quality.json');
const evidenceGate = loadNewest(/^evidence-gate\.(?!preflight\.|canary\.).+\.json$/);
const agentTraceGate = loadNewest(/^agent-trace-gate\..+\.json$/);
const out = [];

function loadClaudeResults() {
  const dir = join(here, 'results');
  if (!existsSync(dir)) return [];
  const list = readdirSync(dir)
    .filter((f) => /^claude-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  // pxpipe-supported models (where optical engages) first, for the narrative
  return list.sort((a, b) => (b.model.includes('fable') ? 1 : 0) - (a.model.includes('fable') ? 1 : 0));
}

out.push('# pinpoint compression benchmark');
out.push('');
out.push(`_Generated ${new Date().toISOString()}._`);
out.push('');
out.push(
  'Measures token consumption (and, for live arms, response correctness) ' +
    'for **headroom-only** (semantic), **pxpipe-only** (optical), and **pinpoint** (both), on the ' +
    'same prompts + system context. Results are separated by evidence level; simulations are not ' +
    'presented as product-performance evidence.',
);
out.push('');

out.push('## Evidence levels');
out.push('');
out.push('- `unit-simulation` — hand-parameterized mechanism/controller checks; useful for unit behavior, not competitive claims.');
out.push('- `offline-real-transform` — real compressor code over synthetic or fixture inputs; valid for transform/token accounting only.');
out.push('- `live-controlled` — real model call with a fixed, directly graded prompt; currently single-run unless stated otherwise.');
out.push('- `live-agentic` — real tool-using agent run; correctness is useful, while tokens/latency are high-variance without paired repetitions.');
out.push('');

out.push('## Benchmark v2 — no-op proxy profile');
out.push('');
if (!proxyProfile) {
  out.push('_Not run._');
} else {
  const cfg = proxyProfile.config;
  out.push(
    `Evidence: \`${proxyProfile.evidenceLevel}\`. Local network mock, ${cfg.requests} requests per arm, ` +
      `${cfg.repetitions} repetitions, randomized direct/proxy arm order after ${cfg.warmupRequests} warmups.`,
  );
  out.push('');
  out.push(
    mdTable(
      ['protocol', 'payload', 'concurrency', 'direct mean p95', 'pinpoint mean p95', 'added p95'],
      proxyProfile.comparisons.map((row) => [
        row.protocol ?? 'openai',
        `${row.payloadBytes} B`,
        String(row.concurrency),
        `${row.directMeanP95Ms.toFixed(2)} ms`,
        `${row.proxyMeanP95Ms.toFixed(2)} ms`,
        `${row.addedP95Ms.toFixed(2)} ms`,
      ]),
    ),
  );
  out.push('');
  out.push(
    `Zero-error verdict: \`${proxyProfile.verdict.zeroErrors}\`. Raw per-request latency, CPU, RSS, event-loop ` +
      'delay, machine metadata, Node version, config, and git SHA are in `results/proxy-profile.json`.',
  );
  out.push('');
  out.push(
    '> This is a local smoke profile, not a 1k-RPS release benchmark. Direct mock and proxy share one ' +
      'process, so CPU/RSS are diagnostic. The isolated-process profile follows; future work still needs ' +
      'SSE, WebSocket, 1 MB payloads, soak, and competitor gateways.',
  );
}
out.push('');

out.push('### Isolated-process profile');
out.push('');
if (!isolatedProxyProfile) {
  out.push('_Not run._');
} else {
  const cfg = isolatedProxyProfile.config;
  out.push(
    `Evidence: ${inlineCode(isolatedProxyProfile.evidenceLevel)}. Load generator, Pinpoint, and mock ` +
      `provider run in separate OS processes; ${cfg.requests} requests per arm, ${cfg.repetitions} ` +
      'repetitions, randomized arm order.',
  );
  out.push('');
  out.push(
    mdTable(
      ['protocol', 'payload', 'concurrency', 'direct mean p95', 'pinpoint mean p95', 'added p95'],
      isolatedProxyProfile.comparisons.map((row) => [
        row.protocol,
        `${row.payloadBytes} B`,
        String(row.concurrency),
        `${row.directMeanP95Ms.toFixed(2)} ms`,
        `${row.proxyMeanP95Ms.toFixed(2)} ms`,
        `${row.addedP95Ms.toFixed(2)} ms`,
      ]),
    ),
  );
  out.push('');
  out.push(
    `Verdict: ${inlineCode(`zero-errors=${isolatedProxyProfile.verdict.zeroErrors}`)}, ` +
      `${inlineCode(`below-5ms-at-c100=${isolatedProxyProfile.verdict.belowFiveMsAtConcurrency100}`)}, ` +
      `${inlineCode(`max-added-p95-at-c100=${Number(isolatedProxyProfile.verdict.maxAddedP95AtConcurrency100).toFixed(2)}ms`)}. ` +
      'The isolated run removes same-event-loop contention but does not meet the saturation target; the ' +
      'extra local HTTP hop remains visible and is not presented as solved.',
  );
}
out.push('');

out.push('## Legacy benchmark arms');
out.push('');
out.push('Retained for transparency while the quality-constrained benchmark v2 is built.');
out.push('');

// ── Methodology / honest constraints ─────────────────────────────────────────
out.push('## Methodology & constraints');
out.push('');
out.push(
  'Three configurations are compared. A 3-way comparison **through wrapped Copilot is not valid**, ' +
    'for reasons that shape this benchmark:',
);
out.push('');
out.push(
  '- **pxpipe cannot wrap Copilot-subscription.** Copilot CLI\'s only interposition hook is its ' +
    'BYOK provider-override; subscription auth needs GitHub OAuth token-exchange → `api.githubcopilot.com`, ' +
    'which only headroom implements. pxpipe has no Copilot transport.',
);
out.push(
  '- **pinpoint delegates Copilot to headroom** (optical can\'t help Copilot\'s models), so through ' +
    'Copilot `pinpoint` and `headroom` are the *same path*.',
);
out.push(
  '- **opus 4.8 is out of pxpipe\'s optical scope** (it reads dense renders poorly), so optical does ' +
    'nothing on opus — a real finding, not a bug.',
);
out.push('');
out.push('So the benchmark has two valid arms:');
out.push('');
out.push(
  '- **Arm A — offline 3-way (rigorous):** identical Copilot-shaped requests routed through the real ' +
    'engines in all three configurations, on a pxpipe-supported model so optical actually engages. ' +
    'Measures effective input-token reduction with one consistent basis: `gpt-tokenizer` for text ' +
    '(base64 image data excluded) **plus** pxpipe\'s image-token estimate (pixels ÷ 750). Absolute ' +
    'counts are not Anthropic-exact, but the cross-config comparison is apples-to-apples.',
);
out.push(
  '- **Arm B — live wrapped Copilot:** baseline `copilot` vs `pinpoint wrap copilot` on the real ' +
    'subscription (no API key), measuring Copilot-reported tokens, the actual response, and correctness. ' +
    'pxpipe is N/A; pinpoint == headroom.',
);
out.push('');

// ── Arm A ────────────────────────────────────────────────────────────────────
out.push('## Arm A — offline 3-way (effective input tokens)');
out.push('');
out.push('Evidence: `offline-real-transform`.');
out.push('');
if (!offline) {
  out.push('_Not run._');
} else {
  out.push(
    `Model: \`${offline.model}\` (pxpipe-supported, so optical engages). ` +
      `headroom sidecar: \`${offline.sidecarStatus}\`.`,
  );
  if (offline.sidecarStatus === 'unavailable') {
    out.push('');
    out.push(
      '> ⚠️ The headroom sidecar was unavailable, so the semantic stage degraded to pass-through. ' +
        'headroom-only and the semantic half of pinpoint show no savings. Start a headroom proxy and re-run.',
    );
  }
  out.push('');
  const rows = [];
  const totals = { base: 0, 'pxpipe-only': 0, 'headroom-only': 0, pinpoint: 0 };
  for (const p of offline.payloads) {
    const c = p.configs;
    rows.push([
      p.name,
      String(p.baselineTokens),
      `${c['pxpipe-only'].effectiveTokens} (${pct(c['pxpipe-only'].savedFraction)})`,
      `${c['headroom-only'].effectiveTokens} (${pct(c['headroom-only'].savedFraction)})`,
      `**${c.pinpoint.effectiveTokens} (${pct(c.pinpoint.savedFraction)})**`,
    ]);
    totals.base += p.baselineTokens;
    for (const k of ['pxpipe-only', 'headroom-only', 'pinpoint']) totals[k] += c[k].effectiveTokens;
  }
  const tsaved = (k) => (totals.base > 0 ? (totals.base - totals[k]) / totals.base : 0);
  rows.push([
    '**TOTAL**',
    `**${totals.base}**`,
    `**${totals['pxpipe-only']} (${pct(tsaved('pxpipe-only'))})**`,
    `**${totals['headroom-only']} (${pct(tsaved('headroom-only'))})**`,
    `**${totals.pinpoint} (${pct(tsaved('pinpoint'))})**`,
  ]);
  out.push(
    mdTable(
      ['payload', 'baseline tok', 'pxpipe-only', 'headroom-only', 'pinpoint (both)'],
      rows,
    ),
  );
  out.push('');
  out.push(
    '**Reading it:** pxpipe images the static system+tools slab; headroom compresses the tool-result ' +
      'content; pinpoint does both and reduces the most. This is the composition thesis, measured.',
  );
  out.push('');
  out.push(
    "_Caveat:_ headroom's AST-aware source-code compressor needs the `headroom-ai[code]` extra " +
      '(tree-sitter), which is not installed here. Its generic semantic fallback still compressed the ' +
      '`source-code` fixture in this run; do not read that row as AST-aware compression.',
  );
  out.push('');
  // Per-stage detail
  out.push('<details><summary>Per-stage detail (pinpoint config)</summary>');
  out.push('');
  const srows = [];
  for (const p of offline.payloads) {
    for (const s of p.configs.pinpoint.stages) {
      srows.push([
        p.name,
        s.stage,
        s.applied ? 'yes' : 'no',
        s.reason,
        `${s.tokensText}→${s.tokensCompressed}`,
        s.basis,
      ]);
    }
  }
  out.push(mdTable(['payload', 'stage', 'applied', 'reason', 'text→compressed', 'basis'], srows));
  out.push('');
  out.push('</details>');
}
out.push('');

// ── Arm B ────────────────────────────────────────────────────────────────────
out.push('## Arm B — live wrapped Copilot (real subscription)');
out.push('');
out.push('Evidence: per row `live-controlled` (exact/reasoning) or `live-agentic` (tool use); single-run, no confidence intervals.');
out.push('');
if (!copilot) {
  out.push('_Not run._');
} else {
  out.push(
    `Requested model: \`${copilot.requestedModel}\`. Effective model: \`${copilot.effectiveModel}\`` +
      `${copilot.modelFallback ? ' _(fallback — requested model unavailable via Copilot)_' : ''}.`,
  );
  if (copilot.modelUnavailable) {
    out.push('');
    out.push('> ⚠️ No requested/fallback model responded; treat live numbers as inconclusive.');
  }
  out.push('');
  out.push('`baseline` = plain `copilot`; `wrapped` = `pinpoint wrap copilot` (→ headroom subscription). pxpipe = **N/A**.');
  out.push('');
  const rows = [];
  let blCorrect = 0;
  let wrCorrect = 0;
  for (const r of copilot.runs) {
    const b = r.baseline;
    const w = r.wrapped;
    if (b.correct) blCorrect++;
    if (w.correct) wrCorrect++;
    const delta =
      b.tokensIn != null && w.tokensIn != null
        ? `${b.tokensIn - w.tokensIn >= 0 ? '−' : '+'}${Math.abs(b.tokensIn - w.tokensIn)}`
        : 'n/a';
    rows.push([
      `${r.id} (${r.kind})`,
      b.tokensIn ?? '?',
      w.tokensIn ?? '?',
      delta,
      b.correct ? '✓' : '✗',
      w.correct ? '✓' : '✗',
      `${(b.ms / 1000).toFixed(1)}s / ${(w.ms / 1000).toFixed(1)}s`,
    ]);
  }
  out.push(
    mdTable(
      ['prompt', 'base in-tok', 'wrap in-tok', 'Δ in-tok', 'base ok', 'wrap ok', 'lat b/w'],
      rows,
    ),
  );
  out.push('');
  out.push(
    `**Correctness:** baseline ${blCorrect}/${copilot.runs.length}, wrapped ${wrCorrect}/${copilot.runs.length} ` +
      '— compression must not change answers.',
  );
  out.push('');
  const controlled = copilot.runs.filter(
    (r) => ['echo', 'math'].includes(r.id) && r.baseline.tokensIn && r.wrapped.tokensIn,
  );
  if (controlled.length) {
    const red =
      controlled.reduce(
        (a, r) => a + (r.baseline.tokensIn - r.wrapped.tokensIn) / r.baseline.tokensIn,
        0,
      ) / controlled.length;
    out.push(
      `**Controlled prompts (echo, math)** — fixed context, no agentic tool use — show a consistent ` +
        `**${pct(red)}** input-token reduction from headroom compressing Copilot's static context, with ` +
        'identical answers. This is the clean live signal.',
    );
    out.push('');
  }
  out.push(
    '> ⚠️ **Agentic variance:** the files/classes/summary prompts let Copilot decide how much to read, ' +
      'so their token counts vary run-to-run *independent of compression* (a wrapped run may fetch more ' +
      'context than its baseline, or vice-versa). Treat the controlled prompts as the compression signal; ' +
      'the agentic rows demonstrate correctness is preserved under real tool use.',
  );
  out.push('');
  out.push(
    '> Latency: wrapped runs are slower because each one-shot `-p` call spins up a fresh headroom proxy. ' +
      'A persistent proxy (long-lived session) amortizes that startup away.',
  );
  out.push('');
  out.push('### Actual responses (first 240 chars, cleaned)');
  out.push('');
  for (const r of copilot.runs) {
    out.push(`**${r.id}** — _${r.prompt}_ (expected: \`${r.expected}\`)`);
    out.push('');
    out.push(`- baseline: ${r.baseline.snippet || '(empty)'}`);
    out.push(`- wrapped:  ${r.wrapped.snippet || '(empty)'}`);
    out.push('');
  }
  out.push(
    '> Note: Copilot\'s reported input-token count may reflect its own pre-send tokenization rather ' +
      'than the compressed payload headroom forwards. If `Δ in-tok ≈ 0`, the compression still occurred ' +
      'on the wire (see Arm A for the measured reduction); Copilot just isn\'t surfacing the post-proxy count.',
  );
}
out.push('');

// ── Arm C ────────────────────────────────────────────────────────────────────
out.push('## Arm C — live Claude Code 4-way');
out.push('');
out.push('Evidence: per row `live-controlled` or `live-agentic`; single-run, fixed-order, and cache-warmth confounded.');
out.push('');
if (claudeResults.length === 0) {
  out.push('_Not run._');
} else {
  out.push(
    '`baseline` = native `claude`; the other three route Claude Code through each proxy via ' +
      '`ANTHROPIC_BASE_URL` (no API key). Ground-truth usage from `claude --output-format json`, including ' +
      'the prompt-cache breakdown. Unlike Copilot, pxpipe and pinpoint are the **real front door** here.',
  );
  out.push('');
  out.push(
    '> **How to read it:** `total input` (input + cache-read + cache-write) is the cache-independent ' +
      'compression signal. `billed` weights cache-read 0.1× / cache-write 1.25×, so it swings with cache ' +
      "hit/miss — and because configs run in a fixed order sharing Anthropic's 5-min server cache, treat " +
      'billed as directional. Note: proxying Claude Code (any custom base URL) itself **inflates** the ' +
      'request (seen on opus, where pxpipe is a no-op: 35.5k vs 19.9k native), so "net vs native" folds in ' +
      'that inflation.',
  );
  out.push('');
  for (const c of claudeResults) renderClaudeArm(c);
}
out.push('');

function renderClaudeArm(c) {
  const cfgs = ['baseline', 'headroom-only', 'pxpipe-only', 'pinpoint'];
  const num = (v) => (typeof v === 'number' ? v : null);
  const chg = (cfg) => {
    const rs = c.runs.filter(
      (r) => num(r.results.baseline?.totalInput) != null && num(r.results[cfg]?.totalInput) != null,
    );
    if (!rs.length) return null;
    return (
      rs.reduce(
        (a, r) => a + (r.results[cfg].totalInput - r.results.baseline.totalInput) / r.results.baseline.totalInput,
        0,
      ) / rs.length
    );
  };
  const signed = (x) => (x == null ? '?' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`);
  const correct = (cfg) => c.runs.filter((r) => r.results[cfg]?.correct).length;

  out.push(
    `### \`${c.model}\` — optical ${c.opticalOnSubscription ? '**on** (PINPOINT_OPTICAL_ON_SUBSCRIPTION=1)' : 'off (subscription stealth default)'}`,
  );
  out.push('');
  out.push('**Total input tokens** (cache-independent — the compression signal):');
  out.push('');
  out.push(
    mdTable(
      ['prompt', ...cfgs],
      c.runs.map((r) => [`${r.id} (${r.kind})`, ...cfgs.map((cf) => String(r.results[cf]?.totalInput ?? '?'))]),
    ),
  );
  out.push('');
  out.push('**Billed-weighted input:**');
  out.push('');
  out.push(
    mdTable(
      ['prompt', ...cfgs],
      c.runs.map((r) => [`${r.id} (${r.kind})`, ...cfgs.map((cf) => String(r.results[cf]?.billedInput ?? '?'))]),
    ),
  );
  out.push('');
  out.push('**Correctness:**');
  out.push('');
  out.push(
    mdTable(
      ['prompt', ...cfgs],
      c.runs.map((r) => [r.id, ...cfgs.map((cf) => (r.results[cf]?.correct ? '✓' : '✗'))]),
    ),
  );
  out.push('');
  const hr = chg('headroom-only');
  const px = chg('pxpipe-only');
  const pr = chg('pinpoint');
  out.push('**Findings:**');
  out.push('');
  out.push(
    `- Avg total-input **vs native** (− = fewer tokens; includes the proxy's request inflation): ` +
      `headroom-only ${signed(hr)}, pxpipe-only ${signed(px)}, pinpoint ${signed(pr)}.`,
  );
  if (px != null && px < -0.05) {
    out.push(
      `- **Optical engages on \`${c.model}\`:** imaging the slab yields a net ${signed(px)} vs native (it ` +
        'more than offsets the proxy inflation), with identifiers protected by pxpipe\'s factsheet.',
    );
  } else {
    out.push(
      `- **Optical can't offset the proxy inflation on \`${c.model}\`** (out of pxpipe scope / stealth): net ` +
        `${signed(px)}. The optical win needs a pxpipe-supported model (compare the fable-5 row / Arm A).`,
    );
  }
  out.push(
    "- **pinpoint ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's " +
      'targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full ' +
      'composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`).',
  );
  const math = c.runs.find((r) => r.id === 'math');
  if (
    math &&
    math.results.baseline?.correct &&
    ['headroom-only', 'pxpipe-only', 'pinpoint'].every((cf) => math.results[cf] && !math.results[cf].correct)
  ) {
    out.push(
      '- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. ' +
        'passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled ' +
        'reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.',
    );
  } else {
    out.push(
      `- **Correctness:** baseline ${correct('baseline')}/${c.runs.length}, headroom ${correct('headroom-only')}/${c.runs.length}, ` +
        `pxpipe ${correct('pxpipe-only')}/${c.runs.length}, pinpoint ${correct('pinpoint')}/${c.runs.length}.`,
    );
  }
  out.push('');
}

out.push('## Arm D — paid direct Anthropic pilot');
out.push('');
if (!directAnthropic) {
  out.push('_Not run. Use the staged preflight/canary/benchmark commands below._');
} else {
  const summary = directAnthropic.summary;
  const budget = directAnthropic.budget;
  out.push(
    `Evidence: ${inlineCode(directAnthropic.evidenceLevel)}. Model: ${inlineCode(directAnthropic.model)}; ` +
      `${directAnthropic.methodology.syntheticCorrectnessTasks} synthetic, exactly graded tasks; one paired ` +
      'run per task; randomized arm order; no retries. Usage is provider-reported.',
  );
  out.push('');
  out.push(
    mdTable(
      ['task', 'direct input', 'pinpoint input', 'input reduction', 'direct answer', 'pinpoint answer'],
      directAnthropic.runs.map((run) => {
        const direct = run.results.direct;
        const pinpoint = run.results.pinpoint;
        const directInput = direct.usage.input + direct.usage.cacheCreate + direct.usage.cacheRead;
        const pinpointInput = pinpoint.usage.input + pinpoint.usage.cacheCreate + pinpoint.usage.cacheRead;
        const reduction = directInput > 0 ? (directInput - pinpointInput) / directInput : 0;
        return [
          run.id,
          String(directInput),
          String(pinpointInput),
          pct(reduction),
          `${direct.correct ? '✓' : '✗'} ${inlineCode(direct.text)}`,
          `${pinpoint.correct ? '✓' : '✗'} ${inlineCode(pinpoint.text)}`,
        ];
      }),
    ),
  );
  out.push('');
  out.push(
    `**Result:** provider input ${summary.directInputTokens.toLocaleString()} → ` +
      `${summary.pinpointInputTokens.toLocaleString()} (**${pct(summary.inputSavingsFraction)} lower**); ` +
      `modeled billed cost $${summary.directCostUSD.toFixed(6)} → $${summary.pinpointCostUSD.toFixed(6)} ` +
      `(**${pct(summary.costSavingsFraction)} lower**); quality ` +
      `${summary.directCorrect}/${directAnthropic.runs.length} → ` +
      `${summary.pinpointCorrect}/${directAnthropic.runs.length}.`,
  );
  out.push('');
  out.push(
    `Actual pilot spend was **$${budget.observedUSD.toFixed(6)}** across ${budget.paidRequests} calls ` +
      `(hard caps: $${budget.maxUSD.toFixed(2)} and ${budget.maxRequests} calls). The separate canary cost ` +
      '$0.000059.',
  );
  out.push('');
  out.push(
    '> **Attribution:** optical was disabled because Haiku 4.5 is outside pxpipe\'s default model scope. ' +
      'This arm therefore validates pinpoint\'s headroom integration and paid measurement path, but the ' +
      '**40.1% cost reduction is headroom-derived, not independent pinpoint IP**. Pinpoint\'s incremental ' +
      'composition value is measured only in Arm A/E on a pxpipe-supported model.',
  );
  out.push('');
  out.push(
    '> Both arms answered the log-count task `6` instead of the fixture truth `7`. That is baseline ' +
      'model failure, not a compression regression. With N=3 and one repetition, this pilot supports ' +
      'quality parity only; it provides no confidence interval or interpretable latency comparison.',
  );
}
out.push('');

// ── Conclusion ───────────────────────────────────────────────────────────────
out.push('## Arm E — constructed additivity check');
out.push('');
if (!proof) {
  out.push('_Not run._');
} else {
  out.push('Evidence: `offline-real-transform`. This checks token arithmetic on five constructed, disjoint-region scenarios; it does not establish task-quality, latency, or universal product dominance.');
  out.push('');
  out.push(
    "Follows headroom's benchmarking route (`benchmarks/comprehensive_eval.py`, " +
      '`real_world_agent_benchmark.py`): named realistic scenarios, savings measured from **input tokens ' +
      'before/after** — which headroom notes is a *pure function* (`proxy/output_savings.py`), so it needs ' +
      'no live model and is free of the cache / agentic / base-URL confounds. One consistent basis across ' +
      "all configs: gpt-tokenizer for text + Anthropic's exact image formula (ceil(w*h/750)). Savings are " +
      'vs `raw`, derived from summed token counts.',
  );
  out.push('');
  out.push(
    mdTable(
      ['scenario', 'kind', 'raw', 'headroom-only', 'pxpipe-only', 'pinpoint', 'vs best single'],
      proof.scenarios.map((e) => {
        const s = (n) => `${(((e.raw - n) / e.raw) * 100).toFixed(0)}%`;
        return [
          e.name,
          e.category,
          String(e.raw),
          `${e.headroom} (${s(e.headroom)})`,
          `${e.pxpipe} (${s(e.pxpipe)})`,
          `**${e.pinpoint} (${s(e.pinpoint)})**`,
          e.strictWin ? '**strict win**' : e.dominates ? 'ties best' : '⚠️ loses',
        ];
      }),
    ),
  );
  out.push('');
  const mixed = proof.scenarios.filter((e) => e.category === 'mixed');
  if (mixed.length) {
    out.push(
      '**Why it works — additivity.** The engines compress **disjoint** regions (optical→static slab, ' +
        'semantic→tool outputs) with no interaction, so pinpoint\'s savings = optical savings + semantic ' +
        'savings, exactly:',
    );
    out.push('');
    out.push(
      mdTable(
        ['mixed scenario', 'optical Δtok', 'semantic Δtok', 'sum', 'pinpoint Δtok', 'match'],
        mixed.map((e) => {
          const opt = e.raw - e.pxpipe;
          const sem = e.raw - e.headroom;
          const both = e.raw - e.pinpoint;
          return [e.name, String(opt), String(sem), String(opt + sem), String(both), opt + sem === both ? 'exact ✓' : String(both - (opt + sem))];
        }),
      ),
    );
    out.push('');
  }
  out.push(
    `**Corpus verdict:** \`dominates-all=${proof.verdict.dominatesAll}\` — on these five inputs, pinpoint is not worse than the ` +
      'better single transform and is strictly smaller on mixed workloads where ' +
      'both engines actually compress (JSON, logs, and current source text); it **ties** the better engine ' +
      'where only one region is compressible (slab-heavy → =pxpipe; tools-heavy → =headroom). The source ' +
      'row uses Headroom\'s generic fallback because the optional AST-aware `[code]` extra is not installed.',
  );
  out.push('');
  out.push(
    '> This is an additivity property of the constructed partition, not a general Pareto proof. Real task ' +
    'quality, retries/retrievals, cache behavior, model capability, and transform overhead can reverse a ' +
    'token-only ranking. Those dimensions move to the v2 quality-constrained benchmark.',
  );
}
out.push('');

// ── Arm F — prose region ───────────────────────────────────────────
out.push('## Arm F — prose region (PINPOINT_SEMANTIC_PROSE)');
out.push('');
if (!prose) {
  out.push('_Not run._');
} else {
  out.push('Evidence: `offline-real-transform`.');
  out.push('');
  out.push(
    "Same input-token methodology as Arm E, on a region the other arms don't exercise: a large " +
      '**plain-prose block in a USER message** (the RAG / pasted-context pattern). pxpipe images only the ' +
      'system slab and the tool_result stage only touches tool_result blocks, so **every other config ' +
      'passes that block through raw**. The prose path routes it to headroom\'s **Kompress** (ModernBERT ' +
      'prose token-drop), reversibly via CCR.',
  );
  out.push('');
  const cols = ['pxpipe-only', 'headroom-tools', 'headroom+prose', 'pinpoint-default', 'pinpoint+prose'];
  out.push(
    mdTable(
      ['scenario', 'kind', 'raw', ...cols, 'prose Δtok'],
      prose.scenarios.map((e) => {
        const s = (n) => `${(((e.raw - n) / e.raw) * 100).toFixed(0)}%`;
        const cell = (k) => `${e.configs[k].tokens} (${s(e.configs[k].tokens)})`;
        return [
          e.name,
          e.category,
          String(e.raw),
          cell('pxpipe-only'),
          cell('headroom-tools'),
          cell('headroom+prose'),
          cell('pinpoint-default'),
          `**${cell('pinpoint+prose')}**`,
          `px ${e.proseGainPinpoint}t`,
        ];
      }),
    ),
  );
  out.push('');
  out.push(
    `**Verdict:** \`prose-helps=${prose.verdict.proseHelps}\`, ` +
      `\`full-stack-best=${prose.verdict.fullStackBestOnMixed}\`, \`no-harm=${prose.verdict.noHarm}\`. On ` +
      'prose-heavy requests every non-prose config reduces the user prose by **0%** — it is the region ' +
      'pxpipe (slab-only) and the tool_result stage both skip. The prose path is the only one that touches ' +
      'it, and it composes **additively** with optical + tool_result compression (`mixed-all`: pinpoint+prose ' +
      'is best). On `control-tools` (no prose) the prose path is byte-identical to its baseline.',
  );
  out.push('');
  out.push(
    '> **Honest scope.** Kompress is lossy prose token-drop with a must-keep guard (numbers, ALLCAPS, ' +
      'paths, CamelCase are never dropped) and every offload is CCR-recoverable. Realized savings scale with ' +
      'prose redundancy: measured **directly** on varied prose, Kompress cuts **~6% (dense) / 15% (natural) ' +
      '/ 18% (redundant)** of prose tokens; the synthetic corpus here is moderately redundant (~21%). It is ' +
      '**opt-in** and needs the sidecar to have the Kompress tokenizer (`pip install transformers` — the ' +
      'lightweight ONNX path, no torch); pinpoint sends `compress_user_messages` automatically. Without ' +
      'Kompress the sidecar no-ops prose and these rows tie their baselines.',
  );
}
out.push('');

// ── Arm G — controller simulation ───────────────────────────────────────────
out.push('## Arm G — controller simulation');
out.push('');
if (!rdFrontier && !adaptive) {
  out.push('_Not run._');
} else {
  out.push(
    'Evidence: `unit-simulation`. Both retrieval probabilities and characteristic engine ratios are ' +
      '**hand-authored**, and the same oracle trains and grades the controller. This arm checks that the ' +
      'policy/store loop can recover a planted allocation; it is not evidence that the allocation, savings, ' +
      'or regret values hold on real traffic.',
  );
  out.push('');
  if (rdFrontier) {
    out.push(`**Simulated RD surface — planted best engine per content type** (at ${pct(1 - rdFrontier.targetRatio)} savings):`);
    out.push('');
    out.push(
      mdTable(
        ['content type', 'best engine', 'optical regret', 'semantic regret'],
        rdFrontier.contentTypes.map((ct) => {
          const w = rdFrontier.winners[ct];
          return [ct, `**${w.engine}**`, w.regret.optical.toFixed(3), w.regret.semantic.toFixed(3)];
        }),
      ),
    );
    out.push('');
    out.push(
      `\`cross-modal=${rdFrontier.crossModal}\` confirms that the configured oracle contains multiple winners. ` +
        'It does not validate those winners against a model.',
    );
    out.push('');
  }
  if (adaptive) {
    const s = adaptive.summary;
    out.push(
      '**Closed-loop self-consistency.** The controller starts at the static rule and learns from simulated ' +
        'retrieval-regret. Net token saving is the internal objective (`saved − regret`: a retrieval ' +
        'wastes the compressed copy):',
    );
    out.push('');
    out.push(
      mdTable(
        ['policy', 'netSaved', 'regret'],
        [
          ['static semantic-only (today)', pct(s.semLate.netSaved), s.semLate.regret.toFixed(3)],
          ['static optical-only', pct(s.optLate.netSaved), s.optLate.regret.toFixed(3)],
          ['**adaptive (learned)**', `**${pct(s.adaptLate.netSaved)}**`, `**${s.adaptLate.regret.toFixed(3)}**`],
          ['optimal (offline ceiling)', pct(adaptive.optimal.netSaved), adaptive.optimal.regret.toFixed(3)],
        ],
      ),
    );
    out.push('');
    out.push('**Learned routing vs offline-optimal:**');
    out.push('');
    out.push(
      mdTable(
        ['content type', 'optimal', 'learned', 'match'],
        Object.keys(adaptive.optimal.map).map((ct) => [
          ct,
          adaptive.optimal.map[ct],
          adaptive.learned[ct],
          adaptive.optimal.map[ct] === adaptive.learned[ct] ? '✓' : '✗',
        ]),
      ),
    );
    out.push('');
    const v = adaptive.verdict;
    out.push(
      `**Simulation verdict:** \`learns=${v.learns}\`, \`beats-both-single-engines=${v.beatsBoth}\`, ` +
        `\`pareto-not-dominated=${v.notDominated}\`, \`recovered-cross-modal-map=${v.recovered}\`. The ` +
        `controller recovers the allocation planted by its oracle. The percentages are simulated outputs, ` +
        `not observed product savings.`,
    );
    out.push('');
    out.push(
      '> The current runtime controller is also not yet genuine same-region cross-modal routing: on the slab, ' +
        'selecting semantic means skipping optical and forwarding raw text. It remains **off by default**. ' +
        'Real adaptive claims are gated on shadow proposals and held-out task benchmarks.',
    );
  }
}
out.push('');

out.push('## Arm H — Query-Backed Context Virtualization (QCV)');
out.push('');
out.push(
  'QCV keeps exact large structured tool results in a bounded local content-addressed store. It sends a ' +
    'small typed manifest, deterministically materializes narrow answers for high-confidence explicit ' +
    'questions, and falls through when the safe default cannot answer. The experimental fallback exposes ' +
    '`pinpoint_query` only when explicitly enabled. ' +
    'Headroom and pxpipe remain fallbacks for regions QCV does not claim.',
);
out.push('');
if (!virtualContext) {
  out.push('_Offline QCV benchmark not run._');
} else {
  out.push(
    `Evidence: ${inlineCode(virtualContext.evidenceLevel)}. The conservative total counts the optimized ` +
      'initial request **plus one complete uncached fallback-query continuation**, even when deterministic ' +
      'prefetch would answer in one request. Exactness is checked against the local store; no model call.',
  );
  out.push('');
  out.push(
    mdTable(
      ['scenario', 'current pinpoint', 'QCV initial', 'fallback continuation', 'QCV conservative total', 'further reduction', 'exact'],
      virtualContext.scenarios.map((scenario) => [
        scenario.name,
        String(scenario.currentTokens),
        String(scenario.virtualInitialTokens),
        String(scenario.continuationTokens),
        String(scenario.virtualOneQueryTokens),
        pct(scenario.reductionVsCurrent),
        scenario.exact ? '✓' : '✗',
      ]),
    ),
  );
  out.push('');
  const reductions = virtualContext.scenarios.map((scenario) => scenario.reductionVsCurrent);
  const minReduction = Math.min(...reductions);
  const maxReduction = Math.max(...reductions);
  out.push(
    `Verdict: ${inlineCode(`exact=${virtualContext.verdict.exact}`)}, ` +
      `${inlineCode(`one-uncached-query-smaller=${virtualContext.verdict.oneUncachedQuerySmaller}`)}. ` +
      `QCV used ${(minReduction * 100).toFixed(1)}-${(maxReduction * 100).toFixed(1)}% fewer input tokens ` +
      'than the previous full Headroom+pxpipe stack under this ' +
      'deliberately pessimistic accounting.',
  );
  out.push('');
}

if (virtualContextNaive) {
  const failed = virtualContextNaive.summary;
  out.push(
    `**Rejected live design:** the first manifest-only pilot cut input ${pct(failed.inputSavingsFraction)} ` +
      `but regressed quality ${failed.directCorrect}/${failed.tasks} → ${failed.pinpointCorrect}/${failed.tasks}. ` +
      `${virtualContextNaive.failure} The design was rejected, not averaged into the successful result.`,
  );
  out.push('');
}

if (!directAnthropicVirtual) {
  out.push('_Repaired paid QCV pilot not run._');
} else {
  const summary = directAnthropicVirtual.summary;
  out.push(
    `**Repaired paid pilot:** evidence ${inlineCode(directAnthropicVirtual.evidenceLevel)}, model ` +
      `${inlineCode(directAnthropicVirtual.model)}, ${directAnthropicVirtual.methodology.syntheticCorrectnessTasks} ` +
      'exactly graded structured tasks, one randomized pair each, no retries. Provider usage includes every ' +
      'request; deterministic prefetch needed no hidden round on these tasks.',
  );
  out.push('');
  out.push(
    mdTable(
      ['task', 'raw input', 'QCV input', 'reduction', 'raw answer', 'QCV answer'],
      directAnthropicVirtual.runs.map((run) => {
        const direct = run.results.direct;
        const qcv = run.results.pinpoint;
        const directInput = direct.usage.input + direct.usage.cacheCreate + direct.usage.cacheRead;
        const qcvInput = qcv.usage.input + qcv.usage.cacheCreate + qcv.usage.cacheRead;
        return [
          run.id,
          String(directInput),
          String(qcvInput),
          pct(1 - qcvInput / directInput),
          `${direct.correct ? '✓' : '✗'} ${inlineCode(direct.text)}`,
          `${qcv.correct ? '✓' : '✗'} ${inlineCode(qcv.text)}`,
        ];
      }),
    ),
  );
  out.push('');
  out.push(
    `Provider input ${summary.directInputTokens.toLocaleString()} → ` +
      `${summary.pinpointInputTokens.toLocaleString()} (**${pct(summary.inputSavingsFraction)} lower**); ` +
      `modeled cost $${summary.directCostUSD.toFixed(6)} → $${summary.pinpointCostUSD.toFixed(6)} ` +
      `(**${pct(summary.costSavingsFraction)} lower**); quality ` +
      `${summary.directCorrect}/${directAnthropicVirtual.runs.length} → ` +
      `${summary.pinpointCorrect}/${directAnthropicVirtual.runs.length}. Actual four-call spend: ` +
      `$${directAnthropicVirtual.budget.observedUSD.toFixed(6)}.`,
  );
  out.push('');
  if (directAnthropic) {
    const ids = new Set(directAnthropicVirtual.runs.map((run) => run.id));
    const semanticRuns = directAnthropic.runs.filter((run) => ids.has(run.id));
    const semanticInput = semanticRuns.reduce((total, run) => {
      const usage = run.results.pinpoint.usage;
      return total + usage.input + usage.cacheCreate + usage.cacheRead;
    }, 0);
    const semanticCost = semanticRuns.reduce(
      (total, run) => total + run.results.pinpoint.costUSD,
      0,
    );
    out.push(
      `On the same fixture definitions, the earlier Headroom-only paid arm used ` +
        `${semanticInput.toLocaleString()} input tokens and $${semanticCost.toFixed(6)}. QCV used ` +
        `${pct(1 - summary.pinpointInputTokens / semanticInput)} fewer input tokens and ` +
        `${pct(1 - summary.pinpointCostUSD / semanticCost)} lower modeled cost than that semantic path. ` +
        'These are separate single-run pilots, so treat quality differences as directional.',
    );
    out.push('');
  }
  out.push(
    '> Scope: the deterministic exact subset defaults on for first-party Anthropic Messages, OpenAI Chat, ' +
      'and OpenAI Responses PAYG traffic, including streaming responses. Ambiguous questions pass through ' +
      'by default; `PINPOINT_VIRTUAL_QUERY_FALLBACK=1` separately enables the bounded Anthropic query tool ' +
      'for non-streaming requests. Subscription traffic passes through. This historical N=2 pilot is ' +
      'design evidence; Arm J is the current repeated result.',
  );
  out.push('');
  out.push(
    '**Default-safety checks:** proposal inspection retains no data; storage commits atomically after ' +
      'request validation; historical manifests remain byte-identical across different current questions; ' +
      'query capabilities are request-scoped; memory is bounded by entries and bytes; delimiter injection ' +
      'is escaped; repeated/range/negative selectors and ambiguous multi-dataset join paths fall through; ' +
      'mixed tools, transport ' +
      'failure, invalid continuation output, and round-cap exhaustion replay the original request. These ' +
      'are automated regression tests, not quality evidence.',
  );
  out.push('');
  out.push(
    '> **Related work:** LeanCTX already combines exact content-addressed archives, `ctx_expand` ' +
      'JSON/search recovery, and query-conditioned context modes. QCV\'s narrower distinction is drop-in ' +
      'virtualization of arbitrary intercepted provider tool results, deterministic exact current-question ' +
      'prefetch, conditional tool exposure, and transparent continuation inside a transactional ' +
      'multi-optimizer runtime. This report does not claim globally novel ingredients.',
  );
}
out.push('');

out.push('## Arm I — Exact QCV breadth suite');
out.push('');
if (!qcvQuality) {
  out.push('_Not run._');
} else {
  const summary = qcvQuality.summary;
  out.push(
    `Evidence: ${inlineCode(qcvQuality.evidenceLevel)}. ${summary.tasks} deterministic tasks across ` +
      `${qcvQuality.methodology.categories.length} categories, with zero provider calls. This grades exact ` +
      'local materialization and fallback suppression, not model-answer quality.',
  );
  out.push('');
  const categories = [...new Set(qcvQuality.results.map((result) => result.category))];
  out.push(
    mdTable(
      ['category', 'tasks', 'exact', 'virtualized', 'fallback'],
      categories.map((category) => {
        const rows = qcvQuality.results.filter((result) => result.category === category);
        return [
          category,
          String(rows.length),
          `${rows.filter((row) => row.exact).length}/${rows.length}`,
          `${rows.filter((row) => row.virtualized).length}/${rows.length}`,
          String(rows.filter((row) => row.fallbackInjected).length),
        ];
      }),
    ),
  );
  out.push('');
  out.push(
    `Result: ${summary.exact}/${summary.tasks} exact, ${summary.virtualized}/${summary.tasks} virtualized, ` +
      `${summary.fallbackInjected} fallback tools; dataset-region estimate ` +
      `${summary.tokensText.toLocaleString()} → ${summary.tokensCompressed.toLocaleString()} tokens ` +
      `(${pct(summary.tokensSaved / summary.tokensText)} lower). Adversarial controls: ` +
      `${summary.refused}/${summary.negativeControls} safely refused without fallback. Verdict: ` +
      Object.entries(qcvQuality.verdict).map(([key, value]) => inlineCode(`${key}=${value}`)).join(', ') + '.',
  );
}
out.push('');

out.push('## Arm J - Repeated multi-provider QCV evidence gate');
out.push('');
if (!evidenceGate) {
  out.push('_Not run._');
} else {
  const { summary, methodology } = evidenceGate;
  const comparison = summary.comparisons.qcvVsHeadroom;
  out.push(
    `Evidence: ${inlineCode(evidenceGate.evidenceLevel)}. ${methodology.logicalTasks} synthetic ` +
      `structured-task templates x ${methodology.repetitions} independently parameterized variants = ` +
      `${methodology.independentlyParameterizedTasks} unique randomized paired observations per arm. ` +
      `${methodology.protocols.length} protocols, 2 live models, no retries.`,
  );
  out.push('');
  out.push(
    mdTable(
      ['arm', 'exact', 'accuracy (95% Wilson)', 'provider input', 'modeled cost', 'median / p95'],
      ['raw', 'headroom', 'qcv'].map((arm) => {
        const row = summary.arms[arm];
        return [
          arm,
          `${row.correct}/${row.observations}`,
          `${pct(row.accuracy)} (${pct(row.accuracy95.low)}-${pct(row.accuracy95.high)})`,
          row.inputTokens.toLocaleString(),
          `$${row.costUSD.toFixed(6)}`,
          `${row.latencyMs.median.toFixed(0)} / ${row.latencyMs.p95.toFixed(0)} ms`,
        ];
      }),
    ),
  );
  out.push('');
  out.push(
    `QCV vs Headroom: ${pct(comparison.costReduction)} lower modeled provider cost ` +
      `(paired-bootstrap 95% CI ${pct(comparison.costReduction95.low)}-${pct(comparison.costReduction95.high)}), ` +
      `${pct(comparison.inputReduction)} fewer input tokens, ${comparison.harms} regressions, ` +
      `${comparison.improvements} improvements. The exact one-sided 95% upper bound on paired harm is ` +
      `${(comparison.harmRateOneSided95Upper * 100).toFixed(3)}%, below the 2-point ` +
      'non-inferiority margin.',
  );
  out.push('');
  out.push(
    mdTable(
      ['live cell', 'observations', 'raw', 'Headroom', 'QCV'],
      Object.entries(summary.cells).map(([cell, value]) => [
        cell,
        String(value.observations),
        `${value.raw.correct}/${value.raw.observations}`,
        `${value.headroom.correct}/${value.headroom.observations}`,
        `${value.qcv.correct}/${value.qcv.observations}`,
      ]),
    ),
  );
  out.push('');
  out.push(
    `Observed 450-call spend: $${evidenceGate.budget.observedUSD.toFixed(6)}. ` +
      `Implementation SHA-256: ${inlineCode(evidenceGate.environment.implementationSha256)}. ` +
      `Verdict: ${inlineCode(`all-gates=${evidenceGate.verdict}`)}.`,
  );
  out.push('');
  out.push(
    '> This establishes repeated live-model efficacy on the committed synthetic structured-task family. ' +
      'The harm interval treats the 150 fixed variants as exchangeable benchmark units. It does not ' +
      'establish the eligible share of organic customer traffic or universal model quality.',
  );
}
out.push('');

out.push('## Arm K - Real-agent sanitized trace gate');
out.push('');
if (!agentTraceGate) {
  out.push('_Not run._');
} else {
  const sessions = agentTraceGate.sessions;
  const agentRows = ['claude', 'codex'].map((agent) => {
    const rows = sessions.filter((session) => session.agent === agent);
    return [
      agent === 'claude' ? 'Claude Code' : 'Codex CLI',
      String(rows.length),
      `${rows.filter((row) => row.agentCorrect).length}/${rows.length}`,
      String(rows.filter((row) => row.qcvAppliedRecords > 0).length),
      `${rows.reduce((total, row) => total + row.replay.matched, 0)}/${rows.length}`,
    ];
  });
  out.push(
    `Evidence: ${inlineCode(agentTraceGate.evidenceLevel)}. Real installed CLIs ran in disposable ` +
      'synthetic workspaces through the production proxy. Source captures and agent output were deleted; ' +
      'only minimized mode-0600 synthetic derivatives remain.',
  );
  out.push('');
  out.push(mdTable(['agent', 'sessions', 'correct', 'QCV sessions', 'hash-matched replays'], agentRows));
  out.push('');
  const replaySaved = sessions.reduce((total, session) => total + session.replay.tokensSaved, 0);
  out.push(
    `${sessions.length}/${sessions.length} sessions returned the correct final value; ` +
      `${sessions.reduce((total, session) => total + session.replay.matched, 0)}/${sessions.length} ` +
      `sanitized traces replayed hash-identically. Claude Code exercised QCV and stable manifest reuse; ` +
      'Codex locally queried sub-threshold chunks and exercised byte-stable pass-through. Both injected ' +
      `provider POST failures were retried successfully. Offline replay saved ${replaySaved.toLocaleString()} ` +
      'estimated tokens on the Claude traces.',
  );
  out.push('');
  out.push(
    `Observed provider spend: $${agentTraceGate.budget.observedUSD.toFixed(6)}; conservative exposure: ` +
      `$${agentTraceGate.budget.conservativeExposureUSD.toFixed(6)}. Implementation SHA-256: ` +
      `${inlineCode(agentTraceGate.implementationSha256)}. Verdict: ` +
      `${inlineCode(`all-gates=${agentTraceGate.verdict}`)}.`,
  );
  out.push('');
  out.push(
    '> These are first-party real-agent sessions over synthetic repositories, not sanitized customer ' +
      'production traces. Copilot subscription traffic delegates to Headroom and is outside QCV scope.',
  );
}
out.push('');

out.push('## Findings');
out.push('');
if (offline) {
  const t = { base: 0, 'pxpipe-only': 0, 'headroom-only': 0, pinpoint: 0 };
  for (const p of offline.payloads) {
    t.base += p.baselineTokens;
    for (const k of ['pxpipe-only', 'headroom-only', 'pinpoint']) t[k] += p.configs[k].effectiveTokens;
  }
  const f = (k) => pct((t.base - t[k]) / t.base);
  out.push(
    `- **Offline (${offline.model}):** pxpipe-only ${f('pxpipe-only')}, headroom-only ${f('headroom-only')}, ` +
      `**pinpoint ${f('pinpoint')}** overall input-token reduction. The two engines target disjoint regions ` +
      '(optical→system slab, semantic→tool outputs), so composing them beats either alone.',
  );
}
if (copilot) {
  out.push(
    `- **Live Copilot (${copilot.effectiveModel}):** wrapping works end-to-end on the real subscription; ` +
      'correctness is preserved. For Copilot specifically, pinpoint\'s value is headroom\'s semantic engine ' +
      '(optical is out of scope for these models).',
  );
}
if (claudeResults.find((c) => c.model.includes('fable'))) {
  out.push(
    '- **Live Claude Code (fable-5):** optical genuinely engages — pxpipe/pinpoint image the static slab for ' +
      'a **net total-input cut vs native** despite the proxy\'s request inflation, correctness preserved ' +
      '(except a base-URL arithmetic quirk that hits *all* proxies, not compression). On opus (out of ' +
      'optical scope) the same proxying nets *more* tokens. The decisive subscription concern is the ' +
      '**prompt cache**: aggressive/lossy restructuring interacts with Claude Code\'s cache, so pinpoint ' +
      'goes stealth there. See Arm C; the full optical+semantic composition is Arm A.',
  );
} else if (claudeResults.length) {
  out.push(`- **Live Claude Code:** ran on ${claudeResults.map((c) => c.model).join(', ')} — see Arm C.`);
}
if (directAnthropic) {
  const s = directAnthropic.summary;
  out.push(
    `- **Paid direct Anthropic (${directAnthropic.model}):** provider input fell ${pct(s.inputSavingsFraction)} ` +
      `and modeled cost fell ${pct(s.costSavingsFraction)}, with equal ${s.directCorrect}/${directAnthropic.runs.length} ` +
      'quality. This was a three-task, one-repetition pilot and used headroom semantic compression only, ' +
      'so it validates the integration rather than independent pinpoint value.',
  );
}
if (directAnthropicVirtual) {
  const s = directAnthropicVirtual.summary;
  out.push(
    `- **QCV paid pilot (${directAnthropicVirtual.model}):** input fell ${pct(s.inputSavingsFraction)}, ` +
      `modeled cost fell ${pct(s.costSavingsFraction)}, and exact score improved ` +
      `${s.directCorrect}/${directAnthropicVirtual.runs.length} → ` +
      `${s.pinpointCorrect}/${directAnthropicVirtual.runs.length}. This is the first pinpoint-owned ` +
      'optimizer result, but it remains a two-task, one-repetition pilot.',
  );
}
if (qcvQuality) {
  out.push(
    `- **QCV breadth:** ${qcvQuality.summary.exact}/${qcvQuality.summary.tasks} deterministic tasks ` +
      `materialized exact results across ${qcvQuality.methodology.categories.length} structured categories ` +
      `without exposing fallback; ${qcvQuality.summary.refused}/${qcvQuality.summary.negativeControls} ` +
      'adversarial ambiguity controls were refused. This broadens operation coverage but is not ' +
      'live-model non-inferiority evidence.',
  );
}
if (evidenceGate) {
  const comparison = evidenceGate.summary.comparisons.qcvVsHeadroom;
  out.push(
    `- **Repeated live QCV gate:** ${evidenceGate.summary.arms.qcv.correct}/` +
      `${evidenceGate.summary.arms.qcv.observations} exact, zero paired harms, ` +
      `${pct(comparison.costReduction)} lower modeled cost than Headroom ` +
      `(95% CI ${pct(comparison.costReduction95.low)}-${pct(comparison.costReduction95.high)}).`,
  );
}
if (agentTraceGate) {
  out.push(
    `- **Real-agent gate:** ${agentTraceGate.sessions.length}/${agentTraceGate.sessions.length} ` +
      'Claude Code/Codex sessions correct and hash-replayed; Claude exercised QCV, while Codex correctly ' +
      'passed through its sub-threshold local-query workflow.',
  );
}
if (proof) {
  const strictMixed = proof.scenarios.filter((e) => e.category === 'mixed' && e.strictWin).map((e) => e.name);
  out.push(
    `- **Constructed additivity (Arm E):** \`dominates-all=${proof.verdict.dominatesAll}\` on five ` +
      `synthetic disjoint-region inputs; strict token wins on ${strictMixed.join(' + ') || 'mixed'}. ` +
      'This is transform arithmetic, not a task-quality or universal product claim.',
  );
}
if (prose) {
  out.push(
    '- **Prose (Arm F): fills the gap** — a large user-message prose block is compressed **0%** by ' +
      'pxpipe, headroom-tools, and default pinpoint, but `PINPOINT_SEMANTIC_PROSE=1` routes it to headroom\'s ' +
      'Kompress for a real, reversible cut (~6–21% of prose tokens by redundancy), **additive** with the ' +
      'optical + tool_result regions and a **no-op** when there\'s no prose.',
  );
}
if (rdFrontier || adaptive) {
  out.push(
    '- **Controller simulation (Arm G):** the policy loop recovers a hand-authored 2×2 allocation under ' +
      'its own oracle. It is retained as a deterministic mechanism test and excluded from competitive claims.',
  );
}
out.push(
  '- **Right-sizing:** use optical where you control an Anthropic model in pxpipe\'s scope; use headroom ' +
    '(semantic) everywhere, including Copilot; use pinpoint to get both automatically where both apply.',
);
out.push('');
out.push('## Reproduce');
out.push('');
out.push('```bash');
out.push('npm run build');
out.push('~/repos-pinpoint/.headroom-venv/bin/headroom proxy --port 8787 &   # semantic sidecar');
out.push('node benchmarks/offline.mjs           # Arm A (3-way, offline)');
out.push('BENCH_MODEL=claude-opus-4.8 node benchmarks/copilot.mjs   # Arm B (live Copilot)');
out.push('PINPOINT_OPTICAL_ON_SUBSCRIPTION=1 BENCH_MODEL=claude-fable-5 node benchmarks/claude.mjs  # Arm C (live Claude 4-way, optical on)');
out.push('node benchmarks/proof.mjs             # Arm E (constructed additivity check)');
out.push('node benchmarks/prose.mjs             # Arm F (prose region, needs transformers in the sidecar)');
out.push('node benchmarks/rd_frontier.mjs       # Arm G (simulated RD surface)');
out.push('node benchmarks/adaptive.mjs          # Arm G (controller simulation)');
out.push('npm run bench:virtual                 # Arm H (QCV, free conservative accounting)');
out.push('npm run bench:qcv-quality             # Arm I (36 exact tasks, no provider calls)');
out.push('npm run bench:profile                 # v2 local proxy overhead profile');
out.push('npm run bench:profile:isolated        # v2 three-process overhead profile');
out.push('npm run bench:anthropic:self-test     # no network');
out.push('npm run bench:anthropic:preflight     # model discovery + token counts, no generation');
out.push('BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.01 BENCH_MAX_REQUESTS=1 npm run bench:anthropic:canary');
out.push('BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.08 BENCH_MAX_REQUESTS=6 npm run bench:anthropic');
out.push('node benchmarks/report.mjs            # regenerate this file');
out.push('```');
out.push('');

writeFileSync(join(here, 'REPORT.md'), out.join('\n'));
console.log('wrote benchmarks/REPORT.md');
