# pixroom compression benchmark

_Generated 2026-07-14T11:42:58.491Z._

Measures token consumption (and, for live arms, response correctness) for **headroom-only** (semantic), **pxpipe-only** (optical), and **pixroom** (both), on the same prompts + system context. Results are separated by evidence level; simulations are not presented as product-performance evidence.

## Evidence levels

- `unit-simulation` — hand-parameterized mechanism/controller checks; useful for unit behavior, not competitive claims.
- `offline-real-transform` — real compressor code over synthetic or fixture inputs; valid for transform/token accounting only.
- `live-controlled` — real model call with a fixed, directly graded prompt; currently single-run unless stated otherwise.
- `live-agentic` — real tool-using agent run; correctness is useful, while tokens/latency are high-variance without paired repetitions.

## Benchmark v2 — no-op proxy profile

Evidence: `offline-real-transform`. Local network mock, 150 requests per arm, 3 repetitions, randomized direct/proxy arm order after 20 warmups.

| protocol | payload | concurrency | direct mean p95 | pixroom mean p95 | added p95 |
| --- | --- | --- | --- | --- | --- |
| openai | 1024 B | 1 | 0.30 ms | 0.49 ms | 0.18 ms |
| openai | 1024 B | 10 | 2.47 ms | 2.66 ms | 0.18 ms |
| openai | 1024 B | 100 | 10.22 ms | 25.88 ms | 15.67 ms |
| openai | 102400 B | 1 | 0.25 ms | 0.46 ms | 0.21 ms |
| openai | 102400 B | 10 | 4.61 ms | 5.96 ms | 1.35 ms |
| openai | 102400 B | 100 | 15.33 ms | 34.50 ms | 19.17 ms |
| anthropic | 1024 B | 1 | 0.14 ms | 0.24 ms | 0.10 ms |
| anthropic | 1024 B | 10 | 1.41 ms | 2.34 ms | 0.93 ms |
| anthropic | 1024 B | 100 | 7.09 ms | 19.37 ms | 12.28 ms |
| anthropic | 102400 B | 1 | 0.24 ms | 0.41 ms | 0.17 ms |
| anthropic | 102400 B | 10 | 4.29 ms | 6.34 ms | 2.05 ms |
| anthropic | 102400 B | 100 | 14.63 ms | 39.84 ms | 25.21 ms |

Zero-error verdict: `true`. Raw per-request latency, CPU, RSS, event-loop delay, machine metadata, Node version, config, and git SHA are in `results/proxy-profile.json`.

> This is a local smoke profile, not a 1k-RPS release benchmark. Direct mock and proxy share one process, so CPU/RSS are diagnostic. The full v2 matrix will isolate containers and add SSE, WebSocket, 1 MB payloads, soak, and competitor gateways.

## Legacy benchmark arms

Retained for transparency while the quality-constrained benchmark v2 is built.

## Methodology & constraints

Three configurations are compared. A 3-way comparison **through wrapped Copilot is not valid**, for reasons that shape this benchmark:

- **pxpipe cannot wrap Copilot-subscription.** Copilot CLI's only interposition hook is its BYOK provider-override; subscription auth needs GitHub OAuth token-exchange → `api.githubcopilot.com`, which only headroom implements. pxpipe has no Copilot transport.
- **pixroom delegates Copilot to headroom** (optical can't help Copilot's models), so through Copilot `pixroom` and `headroom` are the *same path*.
- **opus 4.8 is out of pxpipe's optical scope** (it reads dense renders poorly), so optical does nothing on opus — a real finding, not a bug.

So the benchmark has two valid arms:

- **Arm A — offline 3-way (rigorous):** identical Copilot-shaped requests routed through the real engines in all three configurations, on a pxpipe-supported model so optical actually engages. Measures effective input-token reduction with one consistent basis: `gpt-tokenizer` for text (base64 image data excluded) **plus** pxpipe's image-token estimate (pixels ÷ 750). Absolute counts are not Anthropic-exact, but the cross-config comparison is apples-to-apples.
- **Arm B — live wrapped Copilot:** baseline `copilot` vs `pixroom wrap copilot` on the real subscription (no API key), measuring Copilot-reported tokens, the actual response, and correctness. pxpipe is N/A; pixroom == headroom.

## Arm A — offline 3-way (effective input tokens)

Evidence: `offline-real-transform`.

Model: `claude-fable-5` (pxpipe-supported, so optical engages). headroom sidecar: `external`.

| payload | baseline tok | pxpipe-only | headroom-only | pixroom (both) |
| --- | --- | --- | --- | --- |
| json-data | 18662 | 15309 (18.0%) | 12537 (32.8%) | **9184 (50.8%)** |
| build-log | 18309 | 14956 (18.3%) | 13416 (26.7%) | **10063 (45.0%)** |
| source-code | 12049 | 8696 (27.8%) | 9199 (23.7%) | **5846 (51.5%)** |
| **TOTAL** | **49020** | **38961 (20.5%)** | **35152 (28.3%)** | **25093 (48.8%)** |

**Reading it:** pxpipe images the static system+tools slab; headroom compresses the tool-result content; pixroom does both and reduces the most. This is the composition thesis, measured.

_Caveat:_ headroom's AST-aware source-code compressor needs the `headroom-ai[code]` extra (tree-sitter), which is not installed here. Its generic semantic fallback still compressed the `source-code` fixture in this run; do not read that row as AST-aware compression.

<details><summary>Per-stage detail (pixroom config)</summary>

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

`baseline` = plain `copilot`; `wrapped` = `pixroom wrap copilot` (→ headroom subscription). pxpipe = **N/A**.

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

`baseline` = native `claude`; the other three route Claude Code through each proxy via `ANTHROPIC_BASE_URL` (no API key). Ground-truth usage from `claude --output-format json`, including the prompt-cache breakdown. Unlike Copilot, pxpipe and pixroom are the **real front door** here.

> **How to read it:** `total input` (input + cache-read + cache-write) is the cache-independent compression signal. `billed` weights cache-read 0.1× / cache-write 1.25×, so it swings with cache hit/miss — and because configs run in a fixed order sharing Anthropic's 5-min server cache, treat billed as directional. Note: proxying Claude Code (any custom base URL) itself **inflates** the request (seen on opus, where pxpipe is a no-op: 35.5k vs 19.9k native), so "net vs native" folds in that inflation.

### `claude-fable-5` — optical **on** (PIXROOM_OPTICAL_ON_SUBSCRIPTION=1)

**Total input tokens** (cache-independent — the compression signal):

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo (exact) | 21176 | 7077 | 14825 | 14825 |
| math (reasoning) | 21092 | 7074 | 14822 | 14822 |
| files (agentic-tool) | 42321 | 23654 | 29761 | 29761 |
| classes (verbatim-fidelity) | 42671 | 36598 | 29959 | 29903 |
| summary (gist) | 43522 | 33726 | 30824 | 30823 |

**Billed-weighted input:**

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo (exact) | 5086 | 8163 | 17727 | 4377 |
| math (reasoning) | 8550 | 3422 | 5207 | 4377 |
| files (agentic-tool) | 10808 | 13175 | 10403 | 6309 |
| classes (verbatim-fidelity) | 11038 | 28592 | 10630 | 9699 |
| summary (gist) | 12127 | 25050 | 11736 | 10900 |

**Correctness:**

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo | ✓ | ✓ | ✓ | ✓ |
| math | ✓ | ✗ | ✗ | ✗ |
| files | ✓ | ✓ | ✓ | ✓ |
| classes | ✓ | ✓ | ✓ | ✓ |
| summary | ✓ | ✓ | ✓ | ✓ |

**Findings:**

- Avg total-input **vs native** (− = fewer tokens; includes the proxy's request inflation): headroom-only −43%, pxpipe-only −30%, pixroom −30%.
- **Optical engages on `claude-fable-5`:** imaging the slab yields a net −30% vs native (it more than offsets the proxy inflation), with identifiers protected by pxpipe's factsheet.
- **pixroom ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`).
- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.

### `claude-opus-4-8` — optical off (subscription stealth default)

**Total input tokens** (cache-independent — the compression signal):

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo (exact) | 19881 | 5772 | 35482 | 35482 |
| math (reasoning) | 19878 | 5769 | 35479 | 35479 |
| files (agentic-tool) | 39905 | 35761 | 71092 | 71118 |
| classes (verbatim-fidelity) | 40097 | 87539 | 71297 | 71299 |
| summary (gist) | 44192 | 46411 | 75389 | 75389 |

**Billed-weighted input:**

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo (exact) | 4705 | 3037 | 6008 | 6008 |
| math (reasoning) | 4960 | 3292 | 6263 | 6008 |
| files (agentic-tool) | 10596 | 30811 | 13112 | 12880 |
| classes (verbatim-fidelity) | 10816 | 86644 | 13347 | 13064 |
| summary (gist) | 15960 | 43335 | 18487 | 10000 |

**Correctness:**

| prompt | baseline | headroom-only | pxpipe-only | pixroom |
| --- | --- | --- | --- | --- |
| echo | ✓ | ✓ | ✓ | ✓ |
| math | ✓ | ✗ | ✗ | ✗ |
| files | ✓ | ✓ | ✓ | ✓ |
| classes | ✓ | ✓ | ✓ | ✓ |
| summary | ✓ | ✓ | ✓ | ✓ |

**Findings:**

- Avg total-input **vs native** (− = fewer tokens; includes the proxy's request inflation): headroom-only −6%, pxpipe-only +77%, pixroom +77%.
- **Optical can't offset the proxy inflation on `claude-opus-4-8`** (out of pxpipe scope / stealth): net +77%. The optical win needs a pxpipe-supported model (compare the fable-5 row / Arm A).
- **pixroom ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`).
- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.


## Arm D — paid direct Anthropic pilot

Evidence: `live-controlled`. Model: `claude-haiku-4-5-20251001`; 3 synthetic, exactly graded tasks; one paired run per task; randomized arm order; no retries. Usage is provider-reported.

| task | direct input | pixroom input | input reduction | direct answer | pixroom answer |
| --- | --- | --- | --- | --- | --- |
| json-lookup | 11282 | 5855 | 48.1% | ✓ `user73@example.com` | ✓ `user73@example.com` |
| log-errors | 11332 | 7328 | 35.3% | ✗ `6` | ✗ `6` |
| prose-needle | 1635 | 1295 | 20.8% | ✓ `SILVER-CEDAR-91` | ✓ `SILVER-CEDAR-91` |

**Result:** provider input 24,249 → 14,478 (**40.3% lower**); modeled billed cost $0.024369 → $0.014598 (**40.1% lower**); quality 2/3 → 2/3.

Actual pilot spend was **$0.038967** across 6 calls (hard caps: $0.08 and 6 calls). The separate canary cost $0.000059.

> **Attribution:** optical was disabled because Haiku 4.5 is outside pxpipe's default model scope. This arm therefore validates pixroom's headroom integration and paid measurement path, but the **40.1% cost reduction is headroom-derived, not independent pixroom IP**. Pixroom's incremental composition value is measured only in Arm A/E on a pxpipe-supported model.

> Both arms answered the log-count task `6` instead of the fixture truth `7`. That is baseline model failure, not a compression regression. With N=3 and one repetition, this pilot supports quality parity only; it provides no confidence interval or interpretable latency comparison.

## Arm E — constructed additivity check

Evidence: `offline-real-transform`. This checks token arithmetic on five constructed, disjoint-region scenarios; it does not establish task-quality, latency, or universal product dominance.

Follows headroom's benchmarking route (`benchmarks/comprehensive_eval.py`, `real_world_agent_benchmark.py`): named realistic scenarios, savings measured from **input tokens before/after** — which headroom notes is a *pure function* (`proxy/output_savings.py`), so it needs no live model and is free of the cache / agentic / base-URL confounds. One consistent basis across all configs: gpt-tokenizer for text + Anthropic's exact image formula (ceil(w*h/750)). Savings are vs `raw`, derived from summed token counts.

| scenario | kind | raw | headroom-only | pxpipe-only | pixroom | vs best single |
| --- | --- | --- | --- | --- | --- | --- |
| mixed-json | mixed | 18661 | 12536 (33%) | 15308 (18%) | **9183 (51%)** | **strict win** |
| mixed-logs | mixed | 18308 | 13415 (27%) | 14955 (18%) | **10062 (45%)** | **strict win** |
| mixed-code | mixed | 12048 | 9198 (24%) | 8695 (28%) | **5845 (51%)** | **strict win** |
| slab-heavy | slab-heavy | 4719 | 4719 (0%) | 1366 (71%) | **1366 (71%)** | ties best |
| tools-heavy | tools-heavy | 20536 | 11537 (44%) | 20536 (0%) | **11537 (44%)** | ties best |

**Why it works — additivity.** The engines compress **disjoint** regions (optical→static slab, semantic→tool outputs) with no interaction, so pixroom's savings = optical savings + semantic savings, exactly:

| mixed scenario | optical Δtok | semantic Δtok | sum | pixroom Δtok | match |
| --- | --- | --- | --- | --- | --- |
| mixed-json | 3353 | 6125 | 9478 | 9478 | exact ✓ |
| mixed-logs | 3353 | 4893 | 8246 | 8246 | exact ✓ |
| mixed-code | 3353 | 2850 | 6203 | 6203 | exact ✓ |

**Corpus verdict:** `dominates-all=true` — on these five inputs, pixroom is not worse than the better single transform and is strictly smaller on mixed workloads where both engines actually compress (JSON, logs, and current source text); it **ties** the better engine where only one region is compressible (slab-heavy → =pxpipe; tools-heavy → =headroom). The source row uses Headroom's generic fallback because the optional AST-aware `[code]` extra is not installed.

> This is an additivity property of the constructed partition, not a general Pareto proof. Real task quality, retries/retrievals, cache behavior, model capability, and transform overhead can reverse a token-only ranking. Those dimensions move to the v2 quality-constrained benchmark.

## Arm F — prose region (PIXROOM_SEMANTIC_PROSE)

Evidence: `offline-real-transform`.

Same input-token methodology as Arm E, on a region the other arms don't exercise: a large **plain-prose block in a USER message** (the RAG / pasted-context pattern). pxpipe images only the system slab and the tool_result stage only touches tool_result blocks, so **every other config passes that block through raw**. The prose path routes it to headroom's **Kompress** (ModernBERT prose token-drop), reversibly via CCR.

| scenario | kind | raw | pxpipe-only | headroom-tools | headroom+prose | pixroom-default | pixroom+prose | prose Δtok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rag-doc | prose | 1713 | 1713 (0%) | 1713 (0%) | 1348 (21%) | 1713 (0%) | **1348 (21%)** | px 365t |
| rag-large | prose | 3019 | 3019 (0%) | 3019 (0%) | 2387 (21%) | 3019 (0%) | **2387 (21%)** | px 632t |
| mixed-all | mixed | 20356 | 17003 (16%) | 14231 (30%) | 13875 (32%) | 10878 (47%) | **10522 (48%)** | px 356t |
| control-tools | control | 18664 | 15311 (18%) | 12539 (33%) | 12539 (33%) | 9186 (51%) | **9186 (51%)** | px 0t |

**Verdict:** `prose-helps=true`, `full-stack-best=true`, `no-harm=true`. On prose-heavy requests every non-prose config reduces the user prose by **0%** — it is the region pxpipe (slab-only) and the tool_result stage both skip. The prose path is the only one that touches it, and it composes **additively** with optical + tool_result compression (`mixed-all`: pixroom+prose is best). On `control-tools` (no prose) the prose path is byte-identical to its baseline.

> **Honest scope.** Kompress is lossy prose token-drop with a must-keep guard (numbers, ALLCAPS, paths, CamelCase are never dropped) and every offload is CCR-recoverable. Realized savings scale with prose redundancy: measured **directly** on varied prose, Kompress cuts **~6% (dense) / 15% (natural) / 18% (redundant)** of prose tokens; the synthetic corpus here is moderately redundant (~21%). It is **opt-in** and needs the sidecar to have the Kompress tokenizer (`pip install transformers` — the lightweight ONNX path, no torch); pixroom sends `compress_user_messages` automatically. Without Kompress the sidecar no-ops prose and these rows tie their baselines.

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

QCV keeps exact large structured tool results in a bounded local content-addressed store. It sends a small typed manifest, deterministically materializes narrow answers for high-confidence explicit questions, and falls through when the safe default cannot answer. The experimental fallback exposes `pixroom_query` only when explicitly enabled. Headroom and pxpipe remain fallbacks for regions QCV does not claim.

Evidence: `offline-real-transform`. The conservative total counts the optimized initial request **plus one complete uncached fallback-query continuation**, even when deterministic prefetch would answer in one request. Exactness is checked against the local store; no model call.

| scenario | current pixroom | QCV initial | fallback continuation | QCV conservative total | further reduction | exact |
| --- | --- | --- | --- | --- | --- | --- |
| json-data | 9219 | 1614 | 1736 | 3350 | 63.7% | ✓ |
| build-log | 10096 | 1578 | 1679 | 3257 | 67.7% | ✓ |
| source-code | 7253 | 1618 | 1751 | 3369 | 53.6% | ✓ |

Verdict: `exact=true`, `one-uncached-query-smaller=true`. QCV used 53.6-67.7% fewer input tokens than the previous full Headroom+pxpipe stack under this deliberately pessimistic accounting.

**Rejected live design:** the first manifest-only pilot cut input 79.1% but regressed quality 2/3 → 1/3. Haiku spent the bounded round planning or emitted truncated tool-call JSON; JSON lookup regressed and log count remained wrong. The design was rejected, not averaged into the successful result.

**Repaired paid pilot:** evidence `live-controlled`, model `claude-haiku-4-5-20251001`, 2 exactly graded structured tasks, one randomized pair each, no retries. Provider usage includes every request; deterministic prefetch needed no hidden round on these tasks.

| task | raw input | QCV input | reduction | raw answer | QCV answer |
| --- | --- | --- | --- | --- | --- |
| json-lookup | 11282 | 323 | 97.1% | ✓ `user73@example.com` | ✓ `user73@example.com` |
| log-errors | 11332 | 271 | 97.6% | ✗ `5` | ✓ `7` |

Provider input 22,614 → 594 (**97.4% lower**); modeled cost $0.022684 → $0.000664 (**97.1% lower**); quality 1/2 → 2/2. Actual four-call spend: $0.023348.

On the same fixture definitions, the earlier Headroom-only paid arm used 13,183 input tokens and $0.013253. QCV used 95.5% fewer input tokens and 95.0% lower modeled cost than that semantic path. These are separate single-run pilots, so treat quality differences as directional.

> Scope: the deterministic exact subset defaults on for first-party Anthropic Messages, PAYG, non-streaming, old large JSON/log/code tool results. Ambiguous questions pass through by default; `PIXROOM_VIRTUAL_QUERY_FALLBACK=1` separately enables the bounded query tool. Streaming and subscription traffic pass through. N=2 is breakthrough-candidate evidence, not a universal claim.

**Default-safety checks:** proposal inspection retains no data; storage commits atomically after request validation; historical manifests remain byte-identical across different current questions; query capabilities are request-scoped; memory is bounded by entries and bytes; delimiter injection is escaped; repeated/range/negative/multi-dataset selectors fall through; mixed tools, transport failure, invalid continuation output, and round-cap exhaustion replay the original request. These are automated regression tests, not quality evidence.

> **Related work:** LeanCTX already combines exact content-addressed archives, `ctx_expand` JSON/search recovery, and query-conditioned context modes. QCV's narrower distinction is drop-in virtualization of arbitrary intercepted provider tool results, deterministic exact current-question prefetch, conditional tool exposure, and transparent continuation inside a transactional multi-optimizer runtime. This report does not claim globally novel ingredients.

## Findings

- **Offline (claude-fable-5):** pxpipe-only 20.5%, headroom-only 28.3%, **pixroom 48.8%** overall input-token reduction. The two engines target disjoint regions (optical→system slab, semantic→tool outputs), so composing them beats either alone.
- **Live Copilot (claude-opus-4.8):** wrapping works end-to-end on the real subscription; correctness is preserved. For Copilot specifically, pixroom's value is headroom's semantic engine (optical is out of scope for these models).
- **Live Claude Code (fable-5):** optical genuinely engages — pxpipe/pixroom image the static slab for a **net total-input cut vs native** despite the proxy's request inflation, correctness preserved (except a base-URL arithmetic quirk that hits *all* proxies, not compression). On opus (out of optical scope) the same proxying nets *more* tokens. The decisive subscription concern is the **prompt cache**: aggressive/lossy restructuring interacts with Claude Code's cache, so pixroom goes stealth there. See Arm C; the full optical+semantic composition is Arm A.
- **Paid direct Anthropic (claude-haiku-4-5-20251001):** provider input fell 40.3% and modeled cost fell 40.1%, with equal 2/3 quality. This was a three-task, one-repetition pilot and used headroom semantic compression only, so it validates the integration rather than independent pixroom value.
- **QCV paid pilot (claude-haiku-4-5-20251001):** input fell 97.4%, modeled cost fell 97.1%, and exact score improved 1/2 → 2/2. This is the first pixroom-owned optimizer result, but it remains a two-task, one-repetition pilot.
- **Constructed additivity (Arm E):** `dominates-all=true` on five synthetic disjoint-region inputs; strict token wins on mixed-json + mixed-logs + mixed-code. This is transform arithmetic, not a task-quality or universal product claim.
- **Prose (Arm F): fills the gap** — a large user-message prose block is compressed **0%** by pxpipe, headroom-tools, and default pixroom, but `PIXROOM_SEMANTIC_PROSE=1` routes it to headroom's Kompress for a real, reversible cut (~6–21% of prose tokens by redundancy), **additive** with the optical + tool_result regions and a **no-op** when there's no prose.
- **Controller simulation (Arm G):** the policy loop recovers a hand-authored 2×2 allocation under its own oracle. It is retained as a deterministic mechanism test and excluded from competitive claims.
- **Right-sizing:** use optical where you control an Anthropic model in pxpipe's scope; use headroom (semantic) everywhere, including Copilot; use pixroom to get both automatically where both apply.

## Reproduce

```bash
npm run build
~/repos-pixroom/.headroom-venv/bin/headroom proxy --port 8787 &   # semantic sidecar
node benchmarks/offline.mjs           # Arm A (3-way, offline)
BENCH_MODEL=claude-opus-4.8 node benchmarks/copilot.mjs   # Arm B (live Copilot)
PIXROOM_OPTICAL_ON_SUBSCRIPTION=1 BENCH_MODEL=claude-fable-5 node benchmarks/claude.mjs  # Arm C (live Claude 4-way, optical on)
node benchmarks/proof.mjs             # Arm E (constructed additivity check)
node benchmarks/prose.mjs             # Arm F (prose region, needs transformers in the sidecar)
node benchmarks/rd_frontier.mjs       # Arm G (simulated RD surface)
node benchmarks/adaptive.mjs          # Arm G (controller simulation)
npm run bench:virtual                 # Arm H (QCV, free conservative accounting)
npm run bench:profile                 # v2 local proxy overhead profile
npm run bench:anthropic:self-test     # no network
npm run bench:anthropic:preflight     # model discovery + token counts, no generation
BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.01 BENCH_MAX_REQUESTS=1 npm run bench:anthropic:canary
BENCH_ALLOW_PAID=1 BENCH_MAX_USD=0.08 BENCH_MAX_REQUESTS=6 npm run bench:anthropic
node benchmarks/report.mjs            # regenerate this file
```
