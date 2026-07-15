# pinpoint compression benchmark

_Generated 2026-07-15T08:41:42.060Z._

Measures token consumption (and, for live arms, response correctness) for **headroom-only** (semantic), **pxpipe-only** (optical), and **pinpoint** (both), on the same prompts + system context. Results are separated by evidence level; simulations are not presented as product-performance evidence.

## Evidence levels

- `unit-simulation` — hand-parameterized mechanism/controller checks; useful for unit behavior, not competitive claims.
- `offline-real-transform` — real compressor code over synthetic or fixture inputs; valid for transform/token accounting only.
- `protocol-integration` — real gateway and protocol processes over a deterministic fixture, without a model; valid for wire behavior, exact grading, and local timing only.
- `live-controlled` — real model call with a fixed, directly graded prompt; currently single-run unless stated otherwise.
- `live-agentic` — real tool-using agent run; correctness is useful, while tokens/latency are high-variance without paired repetitions.

## Value-opaque MCP dataflow

### Protocol integration gate

Evidence: `protocol-integration`. Production stdio gateway plus an unmodified deterministic MCP fixture; no model or provider call.

| Check | Result |
|---|---:|
| Exact hidden destination acceptances | 30/30 |
| Policy/resource/query/capability bypasses denied | 7/7 |
| Private canaries absent from client transcript | 400/400 |
| Signed receipts and receipt chain valid | 30/30 |
| Modified receipt rejected | Yes |
| Identical payload commitments publicly unlinkable | 30/30 distinct |
| Constructed direct transcript | 31,013 bytes |
| Opaque source + flow transcript | 2,628 bytes |
| Visible-byte reduction | 91.5% |
| Internal flow latency p50 / p95 / p99 | 0.27 / 0.91 / 1.08 ms |

The protected source was 26,231 bytes while the ordinary virtualization threshold was deliberately set to 100,000,000 characters. Capture therefore occurred because of policy, not optimization eligibility. The destination accepted the exact 40-record projection. Public content hashes, source values, destination arguments, and destination result values were absent from the client transcript.

This is an exact synthetic trace check, not semantic noninterference, a provider token measurement, a production-demand estimate, or a benchmark against IFC/code-execution systems. Counts, sizes, field names, timing, and success status remain visible. See `results/mcp-opaque-flow.first-party-macos-arm64-20260715.json`.

### Live cross-host gate

Evidence: `live-agentic`. One authorized synthetic flow, independently executed by two installed clients.

| Host | Source + flow calls | Model called destination | Receipt | Destination | Values in event stream | Final |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Claude Code 2.1.197 / Haiku 4.5 | Yes | No | Valid | Accepted 40 | 0/400 canaries | `VALIDATED` |
| GitHub Copilot CLI 1.0.71-2 / GPT-5.3 Codex | Yes | No | Valid | Accepted 40 | 0/400 canaries | `VALIDATED` |

Claude completed in four turns with $0.014894 observed cost. Copilot reported zero premium requests and no file changes. Neither public source nor selected-payload hash appeared in either event stream. This proves two-host protocol usability for one first-party fixture, not organic prevalence or general model quality. See `results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json`.

## Benchmark v2 — no-op proxy profile

Evidence: `offline-real-transform`. Local network mock, 150 requests per arm, 3 repetitions, randomized direct/proxy arm order after 20 warmups.

| protocol | payload | concurrency | direct mean p95 | pinpoint mean p95 | added p95 |
| --- | --- | --- | --- | --- | --- |
| openai | 1024 B | 1 | 0.56 ms | 1.43 ms | 0.87 ms |
| openai | 1024 B | 10 | 4.99 ms | 14.09 ms | 9.10 ms |
| openai | 1024 B | 100 | 27.08 ms | 60.09 ms | 33.01 ms |
| openai | 102400 B | 1 | 0.37 ms | 0.63 ms | 0.26 ms |
| openai | 102400 B | 10 | 5.64 ms | 7.62 ms | 1.98 ms |
| openai | 102400 B | 100 | 15.60 ms | 66.64 ms | 51.03 ms |
| anthropic | 1024 B | 1 | 0.20 ms | 0.38 ms | 0.17 ms |
| anthropic | 1024 B | 10 | 1.56 ms | 3.08 ms | 1.52 ms |
| anthropic | 1024 B | 100 | 7.64 ms | 38.42 ms | 30.78 ms |
| anthropic | 102400 B | 1 | 0.30 ms | 0.61 ms | 0.31 ms |
| anthropic | 102400 B | 10 | 4.84 ms | 6.41 ms | 1.56 ms |
| anthropic | 102400 B | 100 | 15.35 ms | 60.33 ms | 44.98 ms |

Zero-error verdict: `true`. Raw per-request latency, CPU, RSS, event-loop delay, machine metadata, Node version, config, and git SHA are in `results/proxy-profile.json`.

> This is a local smoke profile, not a 1k-RPS release benchmark. Direct mock and proxy share one process, so CPU/RSS are diagnostic. The isolated-process profile follows; future work still needs SSE, WebSocket, 1 MB payloads, soak, and competitor gateways.

### Isolated-process profile

Evidence: `offline-real-transform`. Load generator, Pinpoint, and mock provider run in separate OS processes; 150 requests per arm, 3 repetitions, randomized arm order.

| protocol | payload | concurrency | direct mean p95 | pinpoint mean p95 | added p95 |
| --- | --- | --- | --- | --- | --- |
| openai | 1024 B | 1 | 0.44 ms | 0.86 ms | 0.42 ms |
| openai | 1024 B | 10 | 4.05 ms | 5.97 ms | 1.92 ms |
| openai | 1024 B | 100 | 23.29 ms | 51.72 ms | 28.43 ms |
| openai | 102400 B | 1 | 0.41 ms | 1.94 ms | 1.53 ms |
| openai | 102400 B | 10 | 2.30 ms | 5.32 ms | 3.02 ms |
| openai | 102400 B | 100 | 16.11 ms | 32.53 ms | 16.42 ms |
| anthropic | 1024 B | 1 | 0.22 ms | 0.43 ms | 0.21 ms |
| anthropic | 1024 B | 10 | 1.70 ms | 2.91 ms | 1.22 ms |
| anthropic | 1024 B | 100 | 7.78 ms | 22.43 ms | 14.65 ms |
| anthropic | 102400 B | 1 | 0.34 ms | 0.86 ms | 0.51 ms |
| anthropic | 102400 B | 10 | 2.17 ms | 4.23 ms | 2.06 ms |
| anthropic | 102400 B | 100 | 16.05 ms | 33.06 ms | 17.01 ms |

Verdict: `zero-errors=true`, `below-5ms-at-c100=false`, `max-added-p95-at-c100=28.43ms`. The isolated run removes same-event-loop contention but does not meet the saturation target; the extra local HTTP hop remains visible and is not presented as solved.

## Legacy benchmark arms

Retained for transparency while the quality-constrained benchmark v2 is built.

## Methodology & constraints

Three configurations are compared. A 3-way comparison **through wrapped Copilot is not valid**, for reasons that shape this benchmark:

- **pxpipe cannot wrap Copilot-subscription.** Copilot CLI's only interposition hook is its BYOK provider-override; subscription auth needs GitHub OAuth token-exchange → `api.githubcopilot.com`, which only headroom implements. pxpipe has no Copilot transport.
- **pinpoint delegates Copilot to headroom** (optical can't help Copilot's models), so through Copilot `pinpoint` and `headroom` are the *same path*.
- **opus 4.8 is out of pxpipe's optical scope** (it reads dense renders poorly), so optical does nothing on opus — a real finding, not a bug.

So the benchmark has two valid arms:

- **Arm A — offline 3-way (rigorous):** identical Copilot-shaped requests routed through the real engines in all three configurations, on a pxpipe-supported model so optical actually engages. Measures effective input-token reduction with one consistent basis: `gpt-tokenizer` for text (base64 image data excluded) **plus** pxpipe's image-token estimate (pixels ÷ 750). Absolute counts are not Anthropic-exact, but the cross-config comparison is apples-to-apples.
- **Arm B — live wrapped Copilot:** baseline `copilot` vs `pinpoint wrap copilot` on the real subscription (no API key), measuring Copilot-reported tokens, the actual response, and correctness. pxpipe is N/A; pinpoint == headroom.

## Arm A — offline 3-way (effective input tokens)

Evidence: `offline-real-transform`.

Model: `claude-fable-5` (pxpipe-supported, so optical engages). headroom sidecar: `external`.

| payload | baseline tok | pxpipe-only | headroom-only | pinpoint (both) |
| --- | --- | --- | --- | --- |
| json-data | 18662 | 15309 (18.0%) | 12537 (32.8%) | **9184 (50.8%)** |
| build-log | 18309 | 14956 (18.3%) | 13416 (26.7%) | **10063 (45.0%)** |
| source-code | 12049 | 8696 (27.8%) | 9199 (23.7%) | **5846 (51.5%)** |
| **TOTAL** | **49020** | **38961 (20.5%)** | **35152 (28.3%)** | **25093 (48.8%)** |

**Reading it:** pxpipe images the static system+tools slab; headroom compresses the tool-result content; pinpoint does both and reduces the most. This is the composition thesis, measured.

_Caveat:_ headroom's AST-aware source-code compressor needs the `headroom-ai[code]` extra (tree-sitter), which is not installed here. Its generic semantic fallback still compressed the `source-code` fixture in this run; do not read that row as AST-aware compression.

<details><summary>Per-stage detail (pinpoint config)</summary>

| payload | stage | applied | reason | text→compressed | basis |
| --- | --- | --- | --- | --- | --- |
| json-data | semantic | yes | applied | 11714→5888 | tiktoken |
| json-data | optical | yes | applied | 10975→1259 | estimate |
| build-log | semantic | yes | applied | 13212→8718 | tiktoken |
| build-log | optical | yes | applied | 10975→1259 | estimate |
| source-code | semantic | yes | applied | 6368→4489 | tiktoken |
| source-code | optical | yes | applied | 10975→1259 | estimate |

</details>

## Arm B — live wrapped Copilot (real subscription)

Evidence: per row `live-controlled` (exact/reasoning) or `live-agentic` (tool use); single-run, no confidence intervals.

Requested model: `claude-opus-4.8`. Effective model: `claude-opus-4.8`.

`baseline` = plain `copilot`; `wrapped` = `pinpoint wrap copilot` (→ headroom subscription). pxpipe = **N/A**.

| prompt | base in-tok | wrap in-tok | Δ in-tok | base ok | wrap ok | lat b/w |
| --- | --- | --- | --- | --- | --- | --- |
| echo (exact) | 27200 | 26100 | −1100 | ✓ | ✓ | 7.0s / 21.6s |
| math (reasoning) | 27200 | 26100 | −1100 | ✓ | ✓ | 6.9s / 19.0s |
| files (agentic-tool) | 54600 | 52500 | −2100 | ✓ | ✓ | 8.9s / 15.1s |
| classes (verbatim-fidelity) | 54800 | 52400 | −2400 | ✓ | ✓ | 11.7s / 12.9s |
| summary (gist) | 58800 | 82900 | +24100 | ✓ | ✓ | 11.8s / 15.2s |

**Correctness:** baseline 5/5, wrapped 5/5 — compression must not change answers.

**Controlled prompts (echo, math)** — fixed context, no agentic tool use — show a consistent **4.0%** input-token reduction from headroom compressing Copilot's static context, with identical answers. This is the clean live signal.

> ⚠️ **Agentic variance:** the files/classes/summary prompts let Copilot decide how much to read, so their token counts vary run-to-run *independent of compression* (a wrapped run may fetch more context than its baseline, or vice-versa). Treat the controlled prompts as the compression signal; the agentic rows demonstrate correctness is preserved under real tool use.

> Latency: wrapped runs are slower because each one-shot `-p` call spins up a fresh headroom proxy. A persistent proxy (long-lived session) amortizes that startup away.

### Actual responses (first 240 chars, cleaned)

**echo** — _Reply with exactly this token and nothing else: BENCH_ECHO_7Q_ (expected: `BENCH_ECHO_7Q`)

- baseline: BENCH_ECHO_7Q AI Credits 5.81 (5s)
- wrapped:  BENCH_ECHO_7Q

**math** — _Compute 1234 * 5678. Reply with only the integer, no commas._ (expected: `7006652`)

- baseline: 7006652 AI Credits 5.78 (5s)
- wrapped:  7006652

**files** — _How many files ending in .ts are under the src directory (recursively) of this repository? Reply with only the number._ (expected: `18`)

- baseline: │ "src/**/*.ts" └ 18 files found 18 AI Credits 7.45 (7s)
- wrapped:  / Search (glob) │ "src/**/*.ts" └ 18 files found 18

**classes** — _Name the two exported compressor classes defined in src/compressors/optical.ts and src/compressors/semantic.ts. Reply as a comma-separated list._ (expected: `OpticalCompressor, SemanticCompressor`)

- baseline: │ "export class" (src/compressors/optical.ts) └ 1 line found OpticalCompressor, SemanticCompressor AI Credits 8.07 (9s)
- wrapped:  / Search (grep) │ "export class" (src/compressors/optical.ts, src/compressors/semantic.ts) └ 2 lines found OpticalCompressor, SemanticCompressor

**summary** — _In one sentence, what is the purpose of src/wrap/runner.ts in this repository?_ (expected: `(gist: launches/delegates wrapped agents)`)

- baseline: │ src/wrap/runner.ts └ 250 lines read AI Credits 10.5 (9s)
- wrapped:  │ "src/wrap/runner.ts" └ 1 file found │ src/wrap/runner.ts └ 250 lines read

> Note: Copilot's reported input-token count may reflect its own pre-send tokenization rather than the compressed payload headroom forwards. If `Δ in-tok ≈ 0`, the compression still occurred on the wire (see Arm A for the measured reduction); Copilot just isn't surfacing the post-proxy count.

## Arm C — live Claude Code 4-way

Evidence: per row `live-controlled` or `live-agentic`; single-run, fixed-order, and cache-warmth confounded.

`baseline` = native `claude`; the other three route Claude Code through each proxy via `ANTHROPIC_BASE_URL` (no API key). Ground-truth usage from `claude --output-format json`, including the prompt-cache breakdown. Unlike Copilot, pxpipe and pinpoint are the **real front door** here.

> **How to read it:** `total input` (input + cache-read + cache-write) is the cache-independent compression signal. `billed` weights cache-read 0.1× / cache-write 1.25×, so it swings with cache hit/miss — and because configs run in a fixed order sharing Anthropic's 5-min server cache, treat billed as directional. Note: proxying Claude Code (any custom base URL) itself **inflates** the request (seen on opus, where pxpipe is a no-op: 35.5k vs 19.9k native), so "net vs native" folds in that inflation.

### `claude-fable-5` — optical **on** (PINPOINT_OPTICAL_ON_SUBSCRIPTION=1)

**Total input tokens** (cache-independent — the compression signal):

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo (exact) | 21176 | 7077 | 14825 | 14825 |
| math (reasoning) | 21092 | 7074 | 14822 | 14822 |
| files (agentic-tool) | 42321 | 23654 | 29761 | 29761 |
| classes (verbatim-fidelity) | 42671 | 36598 | 29959 | 29903 |
| summary (gist) | 43522 | 33726 | 30824 | 30823 |

**Billed-weighted input:**

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo (exact) | 5086 | 8163 | 17727 | 4377 |
| math (reasoning) | 8550 | 3422 | 5207 | 4377 |
| files (agentic-tool) | 10808 | 13175 | 10403 | 6309 |
| classes (verbatim-fidelity) | 11038 | 28592 | 10630 | 9699 |
| summary (gist) | 12127 | 25050 | 11736 | 10900 |

**Correctness:**

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo | ✓ | ✓ | ✓ | ✓ |
| math | ✓ | ✗ | ✗ | ✗ |
| files | ✓ | ✓ | ✓ | ✓ |
| classes | ✓ | ✓ | ✓ | ✓ |
| summary | ✓ | ✓ | ✓ | ✓ |

**Findings:**

- Avg total-input **vs native** (− = fewer tokens; includes the proxy's request inflation): headroom-only −43%, pxpipe-only −30%, pinpoint −30%.
- **Optical engages on `claude-fable-5`:** imaging the slab yields a net −30% vs native (it more than offsets the proxy inflation), with identifiers protected by pxpipe's factsheet.
- **pinpoint ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`).
- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.

### `claude-opus-4-8` — optical off (subscription stealth default)

**Total input tokens** (cache-independent — the compression signal):

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo (exact) | 19881 | 5772 | 35482 | 35482 |
| math (reasoning) | 19878 | 5769 | 35479 | 35479 |
| files (agentic-tool) | 39905 | 35761 | 71092 | 71118 |
| classes (verbatim-fidelity) | 40097 | 87539 | 71297 | 71299 |
| summary (gist) | 44192 | 46411 | 75389 | 75389 |

**Billed-weighted input:**

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo (exact) | 4705 | 3037 | 6008 | 6008 |
| math (reasoning) | 4960 | 3292 | 6263 | 6008 |
| files (agentic-tool) | 10596 | 30811 | 13112 | 12880 |
| classes (verbatim-fidelity) | 10816 | 86644 | 13347 | 13064 |
| summary (gist) | 15960 | 43335 | 18487 | 10000 |

**Correctness:**

| prompt | baseline | headroom-only | pxpipe-only | pinpoint |
| --- | --- | --- | --- | --- |
| echo | ✓ | ✓ | ✓ | ✓ |
| math | ✓ | ✗ | ✗ | ✗ |
| files | ✓ | ✓ | ✓ | ✓ |
| classes | ✓ | ✓ | ✓ | ✓ |
| summary | ✓ | ✓ | ✓ | ✓ |

**Findings:**

- Avg total-input **vs native** (− = fewer tokens; includes the proxy's request inflation): headroom-only −6%, pxpipe-only +77%, pinpoint +77%.
- **Optical can't offset the proxy inflation on `claude-opus-4-8`** (out of pxpipe scope / stealth): net +77%. The optical win needs a pxpipe-supported model (compare the fable-5 row / Arm A).
- **pinpoint ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`).
- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.


## Arm D — paid direct Anthropic pilot

Evidence: `live-controlled`. Model: `claude-haiku-4-5-20251001`; 3 synthetic, exactly graded tasks; one paired run per task; randomized arm order; no retries. Usage is provider-reported.

| task | direct input | pinpoint input | input reduction | direct answer | pinpoint answer |
| --- | --- | --- | --- | --- | --- |
| json-lookup | 11282 | 5855 | 48.1% | ✓ `user73@example.com` | ✓ `user73@example.com` |
| log-errors | 11332 | 7328 | 35.3% | ✗ `6` | ✗ `6` |
| prose-needle | 1635 | 1295 | 20.8% | ✓ `SILVER-CEDAR-91` | ✓ `SILVER-CEDAR-91` |

**Result:** provider input 24,249 → 14,478 (**40.3% lower**); modeled billed cost $0.024369 → $0.014598 (**40.1% lower**); quality 2/3 → 2/3.

Actual pilot spend was **$0.038967** across 6 calls (hard caps: $0.08 and 6 calls). The separate canary cost $0.000059.

> **Attribution:** optical was disabled because Haiku 4.5 is outside pxpipe's default model scope. This arm therefore validates pinpoint's headroom integration and paid measurement path, but the **40.1% cost reduction is headroom-derived, not independent pinpoint IP**. Pinpoint's incremental composition value is measured only in Arm A/E on a pxpipe-supported model.

> Both arms answered the log-count task `6` instead of the fixture truth `7`. That is baseline model failure, not a compression regression. With N=3 and one repetition, this pilot supports quality parity only; it provides no confidence interval or interpretable latency comparison.

## Arm E — constructed additivity check

Evidence: `offline-real-transform`. This checks token arithmetic on five constructed, disjoint-region scenarios; it does not establish task-quality, latency, or universal product dominance.

Follows headroom's benchmarking route (`benchmarks/comprehensive_eval.py`, `real_world_agent_benchmark.py`): named realistic scenarios, savings measured from **input tokens before/after** — which headroom notes is a *pure function* (`proxy/output_savings.py`), so it needs no live model and is free of the cache / agentic / base-URL confounds. One consistent basis across all configs: gpt-tokenizer for text + Anthropic's exact image formula (ceil(w*h/750)). Savings are vs `raw`, derived from summed token counts.

| scenario | kind | raw | headroom-only | pxpipe-only | pinpoint | vs best single |
| --- | --- | --- | --- | --- | --- | --- |
| mixed-json | mixed | 18661 | 12536 (33%) | 15308 (18%) | **9183 (51%)** | **strict win** |
| mixed-logs | mixed | 18308 | 13415 (27%) | 14955 (18%) | **10062 (45%)** | **strict win** |
| mixed-code | mixed | 12048 | 9198 (24%) | 8695 (28%) | **5845 (51%)** | **strict win** |
| slab-heavy | slab-heavy | 4719 | 4719 (0%) | 1366 (71%) | **1366 (71%)** | ties best |
| tools-heavy | tools-heavy | 20536 | 11537 (44%) | 20536 (0%) | **11537 (44%)** | ties best |

**Why it works — additivity.** The engines compress **disjoint** regions (optical→static slab, semantic→tool outputs) with no interaction, so pinpoint's savings = optical savings + semantic savings, exactly:

| mixed scenario | optical Δtok | semantic Δtok | sum | pinpoint Δtok | match |
| --- | --- | --- | --- | --- | --- |
| mixed-json | 3353 | 6125 | 9478 | 9478 | exact ✓ |
| mixed-logs | 3353 | 4893 | 8246 | 8246 | exact ✓ |
| mixed-code | 3353 | 2850 | 6203 | 6203 | exact ✓ |

**Corpus verdict:** `dominates-all=true` — on these five inputs, pinpoint is not worse than the better single transform and is strictly smaller on mixed workloads where both engines actually compress (JSON, logs, and current source text); it **ties** the better engine where only one region is compressible (slab-heavy → =pxpipe; tools-heavy → =headroom). The source row uses Headroom's generic fallback because the optional AST-aware `[code]` extra is not installed.

> This is an additivity property of the constructed partition, not a general Pareto proof. Real task quality, retries/retrievals, cache behavior, model capability, and transform overhead can reverse a token-only ranking. Those dimensions move to the v2 quality-constrained benchmark.

## Arm F — prose region (PINPOINT_SEMANTIC_PROSE)

Evidence: `offline-real-transform`.

Same input-token methodology as Arm E, on a region the other arms don't exercise: a large **plain-prose block in a USER message** (the RAG / pasted-context pattern). pxpipe images only the system slab and the tool_result stage only touches tool_result blocks, so **every other config passes that block through raw**. The prose path routes it to headroom's **Kompress** (ModernBERT prose token-drop), reversibly via CCR.

| scenario | kind | raw | pxpipe-only | headroom-tools | headroom+prose | pinpoint-default | pinpoint+prose | prose Δtok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rag-doc | prose | 1713 | 1713 (0%) | 1713 (0%) | 1348 (21%) | 1713 (0%) | **1348 (21%)** | px 365t |
| rag-large | prose | 3019 | 3019 (0%) | 3019 (0%) | 2387 (21%) | 3019 (0%) | **2387 (21%)** | px 632t |
| mixed-all | mixed | 20356 | 17003 (16%) | 14231 (30%) | 13875 (32%) | 10878 (47%) | **10522 (48%)** | px 356t |
| control-tools | control | 18664 | 15311 (18%) | 12539 (33%) | 12539 (33%) | 9186 (51%) | **9186 (51%)** | px 0t |

**Verdict:** `prose-helps=true`, `full-stack-best=true`, `no-harm=true`. On prose-heavy requests every non-prose config reduces the user prose by **0%** — it is the region pxpipe (slab-only) and the tool_result stage both skip. The prose path is the only one that touches it, and it composes **additively** with optical + tool_result compression (`mixed-all`: pinpoint+prose is best). On `control-tools` (no prose) the prose path is byte-identical to its baseline.

> **Honest scope.** Kompress is lossy prose token-drop with a must-keep guard (numbers, ALLCAPS, paths, CamelCase are never dropped) and every offload is CCR-recoverable. Realized savings scale with prose redundancy: measured **directly** on varied prose, Kompress cuts **~6% (dense) / 15% (natural) / 18% (redundant)** of prose tokens; the synthetic corpus here is moderately redundant (~21%). It is **opt-in** and needs the sidecar to have the Kompress tokenizer (`pip install transformers` — the lightweight ONNX path, no torch); pinpoint sends `compress_user_messages` automatically. Without Kompress the sidecar no-ops prose and these rows tie their baselines.

## Arm G — controller simulation

Evidence: `unit-simulation`. Both retrieval probabilities and characteristic engine ratios are **hand-authored**, and the same oracle trains and grades the controller. This arm checks that the policy/store loop can recover a planted allocation; it is not evidence that the allocation, savings, or regret values hold on real traffic.

**Simulated RD surface — planted best engine per content type** (at 55.0% savings):

| content type | best engine | optical regret | semantic regret |
| --- | --- | --- | --- |
| json | **optical** | 0.133 | 0.183 |
| code | **semantic** | 0.289 | 0.162 |
| log | **optical** | 0.050 | 0.179 |
| prose | **semantic** | 0.382 | 0.107 |

`cross-modal=true` confirms that the configured oracle contains multiple winners. It does not validate those winners against a model.

**Closed-loop self-consistency.** The controller starts at the static rule and learns from simulated retrieval-regret. Net token saving is the internal objective (`saved − regret`: a retrieval wastes the compressed copy):

| policy | netSaved | regret |
| --- | --- | --- |
| static semantic-only (today) | 32.7% | 0.148 |
| static optical-only | 42.3% | 0.252 |
| **adaptive (learned)** | **52.1%** | **0.092** |
| optimal (offline ceiling) | 50.0% | 0.113 |

**Learned routing vs offline-optimal:**

| content type | optimal | learned | match |
| --- | --- | --- | --- |
| json | optical | optical | ✓ |
| log | optical | optical | ✓ |
| code | semantic | semantic | ✓ |
| prose | semantic | semantic | ✓ |

**Simulation verdict:** `learns=true`, `beats-both-single-engines=true`, `pareto-not-dominated=true`, `recovered-cross-modal-map=true`. The controller recovers the allocation planted by its oracle. The percentages are simulated outputs, not observed product savings.

> The current runtime controller is also not yet genuine same-region cross-modal routing: on the slab, selecting semantic means skipping optical and forwarding raw text. It remains **off by default**. Real adaptive claims are gated on shadow proposals and held-out task benchmarks.

## Arm H — Query-Backed Context Virtualization (QCV)

QCV keeps exact large structured tool results in a bounded local content-addressed store. It sends a small typed manifest, deterministically materializes narrow answers for high-confidence explicit questions, and falls through when the safe default cannot answer. The experimental fallback exposes `pinpoint_query` only when explicitly enabled. Headroom and pxpipe remain fallbacks for regions QCV does not claim.

Evidence: `offline-real-transform`. The conservative total counts the optimized initial request **plus one complete uncached fallback-query continuation**, even when deterministic prefetch would answer in one request. Exactness is checked against the local store; no model call.

| scenario | current pinpoint | QCV initial | fallback continuation | QCV conservative total | further reduction | exact |
| --- | --- | --- | --- | --- | --- | --- |
| json-data | 9219 | 1614 | 1736 | 3350 | 63.7% | ✓ |
| build-log | 10096 | 1578 | 1679 | 3257 | 67.7% | ✓ |
| source-code | 9569 | 1608 | 1738 | 3346 | 65.0% | ✓ |

Verdict: `exact=true`, `one-uncached-query-smaller=true`. QCV used 63.7-67.7% fewer input tokens than the previous full Headroom+pxpipe stack under this deliberately pessimistic accounting.

**Rejected live design:** the first manifest-only pilot cut input 79.1% but regressed quality 2/3 → 1/3. Haiku spent the bounded round planning or emitted truncated tool-call JSON; JSON lookup regressed and log count remained wrong. The design was rejected, not averaged into the successful result.

**Repaired paid pilot:** evidence `live-controlled`, model `claude-haiku-4-5-20251001`, 2 exactly graded structured tasks, one randomized pair each, no retries. Provider usage includes every request; deterministic prefetch needed no hidden round on these tasks.

| task | raw input | QCV input | reduction | raw answer | QCV answer |
| --- | --- | --- | --- | --- | --- |
| json-lookup | 11282 | 323 | 97.1% | ✓ `user73@example.com` | ✓ `user73@example.com` |
| log-errors | 11332 | 271 | 97.6% | ✗ `5` | ✓ `7` |

Provider input 22,614 → 594 (**97.4% lower**); modeled cost $0.022684 → $0.000664 (**97.1% lower**); quality 1/2 → 2/2. Actual four-call spend: $0.023348.

On the same fixture definitions, the earlier Headroom-only paid arm used 13,183 input tokens and $0.013253. QCV used 95.5% fewer input tokens and 95.0% lower modeled cost than that semantic path. These are separate single-run pilots, so treat quality differences as directional.

> Scope: the deterministic exact subset defaults on for first-party Anthropic Messages, OpenAI Chat, and OpenAI Responses PAYG traffic, including streaming responses. Ambiguous questions pass through by default; `PINPOINT_VIRTUAL_QUERY_FALLBACK=1` separately enables the bounded Anthropic query tool for non-streaming requests. Subscription traffic passes through. This historical N=2 pilot is design evidence; Arm J is the current repeated result.

**Default-safety checks:** proposal inspection retains no data; storage commits atomically after request validation; historical manifests remain byte-identical across different current questions; query capabilities are request-scoped; memory is bounded by entries and bytes; delimiter injection is escaped; repeated/range/negative selectors and ambiguous multi-dataset join paths fall through; mixed tools, transport failure, invalid continuation output, and round-cap exhaustion replay the original request. These are automated regression tests, not quality evidence.

> **Related work:** LeanCTX already combines exact content-addressed archives, `ctx_expand` JSON/search recovery, and query-conditioned context modes. QCV's narrower distinction is drop-in virtualization of arbitrary intercepted provider tool results, deterministic exact current-question prefetch, conditional tool exposure, and transparent continuation inside a transactional multi-optimizer runtime. This report does not claim globally novel ingredients.

## Arm I — Exact QCV breadth suite

Evidence: `offline-real-transform`. 42 deterministic tasks across 7 categories, with zero provider calls. This grades exact local materialization and fallback suppression, not model-answer quality.

| category | tasks | exact | virtualized | fallback |
| --- | --- | --- | --- | --- |
| json-lookup | 6 | 6/6 | 6/6 | 0 |
| filtered-count | 6 | 6/6 | 6/6 | 0 |
| log-count | 6 | 6/6 | 6/6 | 0 |
| source-code | 6 | 6/6 | 6/6 | 0 |
| table-json | 6 | 6/6 | 6/6 | 0 |
| nested-projection | 6 | 6/6 | 6/6 | 0 |
| json-join | 6 | 6/6 | 6/6 | 0 |

Result: 42/42 exact, 42/42 virtualized, 0 fallback tools; dataset-region estimate 144,272 → 7,583 tokens (94.7% lower). Adversarial controls: 20/20 safely refused without fallback. Verdict: `atLeastThirtyTasks=true`, `sixCategories=true`, `sevenCategories=true`, `allExact=true`, `allVirtualized=true`, `noFallback=true`, `allNegativeControlsRefused=true`.

## Arm J - Repeated multi-provider QCV evidence gate

Evidence: `live-controlled`. 30 synthetic structured-task templates x 5 independently parameterized variants = 150 unique randomized paired observations per arm. 3 protocols, 2 live models, no retries.

| arm | exact | accuracy (95% Wilson) | provider input | modeled cost | median / p95 |
| --- | --- | --- | --- | --- | --- |
| raw | 109/150 | 72.7% (65.0%-79.2%) | 1,899,030 | $1.198998 | 1129 / 2101 ms |
| headroom | 112/150 | 74.7% (67.2%-81.0%) | 1,713,184 | $1.062131 | 1097 / 2267 ms |
| qcv | 150/150 | 100.0% (97.5%-100.0%) | 48,439 | $0.034462 | 850 / 2042 ms |

QCV vs Headroom: 96.8% lower modeled provider cost (paired-bootstrap 95% CI 96.5%-96.9%), 97.2% fewer input tokens, 0 regressions, 38 improvements. The exact one-sided 95% upper bound on paired harm is 1.977%, below the 2-point non-inferiority margin.

| live cell | observations | raw | Headroom | QCV |
| --- | --- | --- | --- | --- |
| openai-responses:gpt-4.1-mini | 50 | 37/50 | 37/50 | 50/50 |
| anthropic-messages:claude-haiku-4-5-20251001 | 50 | 37/50 | 39/50 | 50/50 |
| openai-chat:gpt-4.1-mini | 50 | 35/50 | 36/50 | 50/50 |

Observed 450-call spend: $2.295591. Implementation SHA-256: `bc1b47c9555a16ed345489f0db1b24ed581cb3a905d222f7eb30b1ab846b0f3f`. Verdict: `all-gates=true`.

> This establishes repeated live-model efficacy on the committed synthetic structured-task family. The harm interval treats the 150 fixed variants as exchangeable benchmark units. It does not establish the eligible share of organic customer traffic or universal model quality.

## Arm K - Real-agent sanitized trace gate

Evidence: `live-agentic`. Real installed CLIs ran in disposable synthetic workspaces through the production proxy. Source captures and agent output were deleted; only minimized mode-0600 synthetic derivatives remain.

| agent | sessions | correct | QCV sessions | hash-matched replays |
| --- | --- | --- | --- | --- |
| Claude Code | 5 | 5/5 | 5 | 5/5 |
| Codex CLI | 5 | 5/5 | 0 | 5/5 |

10/10 sessions returned the correct final value; 10/10 sanitized traces replayed hash-identically. Claude Code exercised QCV and stable manifest reuse; Codex locally queried sub-threshold chunks and exercised byte-stable pass-through. Both injected provider POST failures were retried successfully. Offline replay saved 60,671 estimated tokens on the Claude traces.

Observed provider spend: $0.104211; conservative exposure: $1.371887. Implementation SHA-256: `f8cb9475c9a38007f604af6b4c8acce0328e85a21633ef356aec7b4cf4e62079`. Verdict: `all-gates=true`.

> These are first-party real-agent sessions over synthetic repositories, not sanitized customer production traces. Copilot subscription traffic delegates to Headroom and is outside QCV scope.

## Findings

- **Offline (claude-fable-5):** pxpipe-only 20.5%, headroom-only 28.3%, **pinpoint 48.8%** overall input-token reduction. The two engines target disjoint regions (optical→system slab, semantic→tool outputs), so composing them beats either alone.
- **Live Copilot (claude-opus-4.8):** wrapping works end-to-end on the real subscription; correctness is preserved. For Copilot specifically, pinpoint's value is headroom's semantic engine (optical is out of scope for these models).
- **Live Claude Code (fable-5):** optical genuinely engages — pxpipe/pinpoint image the static slab for a **net total-input cut vs native** despite the proxy's request inflation, correctness preserved (except a base-URL arithmetic quirk that hits *all* proxies, not compression). On opus (out of optical scope) the same proxying nets *more* tokens. The decisive subscription concern is the **prompt cache**: aggressive/lossy restructuring interacts with Claude Code's cache, so pinpoint goes stealth there. See Arm C; the full optical+semantic composition is Arm A.
- **Paid direct Anthropic (claude-haiku-4-5-20251001):** provider input fell 40.3% and modeled cost fell 40.1%, with equal 2/3 quality. This was a three-task, one-repetition pilot and used headroom semantic compression only, so it validates the integration rather than independent pinpoint value.
- **QCV paid pilot (claude-haiku-4-5-20251001):** input fell 97.4%, modeled cost fell 97.1%, and exact score improved 1/2 → 2/2. This is the first pinpoint-owned optimizer result, but it remains a two-task, one-repetition pilot.
- **QCV breadth:** 42/42 deterministic tasks materialized exact results across 7 structured categories without exposing fallback; 20/20 adversarial ambiguity controls were refused. This broadens operation coverage but is not live-model non-inferiority evidence.
- **Repeated live QCV gate:** 150/150 exact, zero paired harms, 96.8% lower modeled cost than Headroom (95% CI 96.5%-96.9%).
- **Real-agent gate:** 10/10 Claude Code/Codex sessions correct and hash-replayed; Claude exercised QCV, while Codex correctly passed through its sub-threshold local-query workflow.
- **Constructed additivity (Arm E):** `dominates-all=true` on five synthetic disjoint-region inputs; strict token wins on mixed-json + mixed-logs + mixed-code. This is transform arithmetic, not a task-quality or universal product claim.
- **Prose (Arm F): fills the gap** — a large user-message prose block is compressed **0%** by pxpipe, headroom-tools, and default pinpoint, but `PINPOINT_SEMANTIC_PROSE=1` routes it to headroom's Kompress for a real, reversible cut (~6–21% of prose tokens by redundancy), **additive** with the optical + tool_result regions and a **no-op** when there's no prose.
- **Controller simulation (Arm G):** the policy loop recovers a hand-authored 2×2 allocation under its own oracle. It is retained as a deterministic mechanism test and excluded from competitive claims.
- **Right-sizing:** use optical where you control an Anthropic model in pxpipe's scope; use headroom (semantic) everywhere, including Copilot; use pinpoint to get both automatically where both apply.

## Reproduce

```bash
npm run build
~/repos-pinpoint/.headroom-venv/bin/headroom proxy --port 8787 &   # semantic sidecar
node benchmarks/offline.mjs           # Arm A (3-way, offline)
BENCH_MODEL=claude-opus-4.8 node benchmarks/copilot.mjs   # Arm B (live Copilot)
PINPOINT_OPTICAL_ON_SUBSCRIPTION=1 BENCH_MODEL=claude-fable-5 node benchmarks/claude.mjs  # Arm C (live Claude 4-way, optical on)
node benchmarks/proof.mjs             # Arm E (constructed additivity check)
node benchmarks/prose.mjs             # Arm F (prose region, needs transformers in the sidecar)
node benchmarks/rd_frontier.mjs       # Arm G (simulated RD surface)
node benchmarks/adaptive.mjs          # Arm G (controller simulation)
npm run bench:virtual                 # Arm H (QCV, free conservative accounting)
npm run bench:qcv-quality             # Arm I (36 exact tasks, no provider calls)
npm run bench:profile                 # v2 local proxy overhead profile
npm run bench:profile:isolated        # v2 three-process overhead profile
npm run bench:anthropic:self-test     # no network
npm run bench:anthropic:preflight     # model discovery + token counts, no generation
BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.01 BENCH_MAX_REQUESTS=1 npm run bench:anthropic:canary
BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.08 BENCH_MAX_REQUESTS=6 npm run bench:anthropic
node benchmarks/report.mjs            # regenerate this file
```
