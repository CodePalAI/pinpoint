# pixroom compression benchmark

_Generated 2026-07-12T10:48:25.308Z._

Measures token consumption (and, for the live arm, the actual response + correctness) for **headroom-only** (semantic), **pxpipe-only** (optical), and **pixroom** (both), on the same prompts + system context.

## Methodology & constraints

Three configurations are compared. A 3-way comparison **through wrapped Copilot is not valid**, for reasons that shape this benchmark:

- **pxpipe cannot wrap Copilot-subscription.** Copilot CLI's only interposition hook is its BYOK provider-override; subscription auth needs GitHub OAuth token-exchange → `api.githubcopilot.com`, which only headroom implements. pxpipe has no Copilot transport.
- **pixroom delegates Copilot to headroom** (optical can't help Copilot's models), so through Copilot `pixroom` and `headroom` are the *same path*.
- **opus 4.8 is out of pxpipe's optical scope** (it reads dense renders poorly), so optical does nothing on opus — a real finding, not a bug.

So the benchmark has two valid arms:

- **Arm A — offline 3-way (rigorous):** identical Copilot-shaped requests routed through the real engines in all three configurations, on a pxpipe-supported model so optical actually engages. Measures effective input-token reduction with one consistent basis: `gpt-tokenizer` for text (base64 image data excluded) **plus** pxpipe's image-token estimate (pixels ÷ 750). Absolute counts are not Anthropic-exact, but the cross-config comparison is apples-to-apples.
- **Arm B — live wrapped Copilot:** baseline `copilot` vs `pixroom wrap copilot` on the real subscription (no API key), measuring Copilot-reported tokens, the actual response, and correctness. pxpipe is N/A; pixroom == headroom.

## Arm A — offline 3-way (effective input tokens)

Model: `claude-fable-5` (pxpipe-supported, so optical engages). headroom sidecar: `external`.

| payload | baseline tok | pxpipe-only | headroom-only | pixroom (both) |
| --- | --- | --- | --- | --- |
| json-data | 18662 | 15309 (18.0%) | 12537 (32.8%) | **9184 (50.8%)** |
| build-log | 18309 | 14956 (18.3%) | 14718 (19.6%) | **11365 (37.9%)** |
| source-code | 10467 | 7114 (32.0%) | 10467 (0.0%) | **7114 (32.0%)** |
| **TOTAL** | **47438** | **37379 (21.2%)** | **37722 (20.5%)** | **27663 (41.7%)** |

**Reading it:** pxpipe images the static system+tools slab; headroom compresses the tool-result content; pixroom does both and reduces the most. This is the composition thesis, measured.

_Caveat:_ headroom's source-code compressor needs the `headroom-ai[code]` extra (tree-sitter), which is not installed here — so `source-code` shows no semantic savings and optical carries it. JSON and log outputs use the always-on SmartCrusher / Log compressors.

<details><summary>Per-stage detail (pixroom config)</summary>

| payload | stage | applied | reason | text→compressed | basis |
| --- | --- | --- | --- | --- | --- |
| json-data | semantic | yes | applied | 11714→5888 | tiktoken |
| json-data | optical | yes | applied | 10975→1259 | estimate |
| build-log | semantic | yes | applied | 13212→9621 | tiktoken |
| build-log | optical | yes | applied | 10975→1259 | estimate |
| source-code | semantic | no | not_profitable | 5002→5002 | tiktoken |
| source-code | optical | yes | applied | 10975→1259 | estimate |

</details>

## Arm B — live wrapped Copilot (real subscription)

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
- **pixroom ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`: pixroom 41.7%).
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
- **pixroom ≈ pxpipe-only on total here** because these are single-shot sessions: the semantic stage's targets (recent tool outputs) are protected by `protect_recent`, so only optical fires. The full composition win (optical + semantic) shows in **Arm A** (offline, `protect_recent=0`: pixroom 41.7%).
- **Correctness:** `math` was correct natively but **wrong through all three proxies** (incl. passthrough/optical pxpipe) — a Claude-Code custom-base-URL *behaviour change* (likely a disabled reasoning aid), independent of compression. Every retrieval/tool prompt stayed correct.


## Arm D — direct-API 3-way

_An API key is present in the environment, so this arm is **runnable** — but it makes **paid** direct-API calls (unlike the Copilot subscription), so it was not run autonomously. On request I can run the full direct-API 3-way (headroom vs pxpipe vs pixroom) on opus 4.8 with provider-reported `usage` — the one arm that puts all three on the exact same live model._

## Arm E — proof: does pixroom dominate both?

Follows headroom's benchmarking route (`benchmarks/comprehensive_eval.py`, `real_world_agent_benchmark.py`): named realistic scenarios, savings measured from **input tokens before/after** — which headroom notes is a *pure function* (`proxy/output_savings.py`), so it needs no live model and is free of the cache / agentic / base-URL confounds. One consistent basis across all configs: gpt-tokenizer for text + Anthropic's exact image formula (ceil(w*h/750)). Savings are vs `raw`, derived from summed token counts.

| scenario | kind | raw | headroom-only | pxpipe-only | pixroom | vs best single |
| --- | --- | --- | --- | --- | --- | --- |
| mixed-json | mixed | 18661 | 12536 (33%) | 15308 (18%) | **9183 (51%)** | **strict win** |
| mixed-logs | mixed | 18308 | 14717 (20%) | 14955 (18%) | **11364 (38%)** | **strict win** |
| mixed-code | mixed | 10466 | 10466 (0%) | 7113 (32%) | **7113 (32%)** | ties best |
| slab-heavy | slab-heavy | 4719 | 4719 (0%) | 1366 (71%) | **1366 (71%)** | ties best |
| tools-heavy | tools-heavy | 20536 | 11537 (44%) | 20536 (0%) | **11537 (44%)** | ties best |

**Why it works — additivity.** The engines compress **disjoint** regions (optical→static slab, semantic→tool outputs) with no interaction, so pixroom's savings = optical savings + semantic savings, exactly:

| mixed scenario | optical Δtok | semantic Δtok | sum | pixroom Δtok | match |
| --- | --- | --- | --- | --- | --- |
| mixed-json | 3353 | 6125 | 9478 | 9478 | exact ✓ |
| mixed-logs | 3353 | 3591 | 6944 | 6944 | exact ✓ |
| mixed-code | 3353 | 0 | 3353 | 3353 | exact ✓ |

**Verdict:** `dominates-all=true` — pixroom is **never worse** than the better of the two single engines on any scenario. It **strictly beats both** on mixed workloads where both engines actually compress (json, logs); it **ties** the better engine where only one region is compressible (slab-heavy → =pxpipe; tools-heavy → =headroom; mixed-code → =pxpipe, because headroom's code compressor needs the `[code]` extra, not installed here).

> This is a **Pareto-domination** proof, not a claim of always-large margins. By construction — disjoint regions, one engine per region, no double-compression — pixroom's output is mathematically ≤ min(headroom-only, pxpipe-only), strict exactly when both regions compress. Real agent traffic (big static slab + bulky tool outputs) is that case, so pixroom wins there; on degenerate single-region workloads it safely reduces to the better engine. Correctness under compression is validated live in Arm C (every retrieval/tool prompt stayed correct across all configs).

## Arm F — prose region (PIXROOM_SEMANTIC_PROSE)

Same input-token methodology as Arm E, on a region the other arms don't exercise: a large **plain-prose block in a USER message** (the RAG / pasted-context pattern). pxpipe images only the system slab and the tool_result stage only touches tool_result blocks, so **every other config passes that block through raw**. The prose path routes it to headroom's **Kompress** (ModernBERT prose token-drop), reversibly via CCR.

| scenario | kind | raw | pxpipe-only | headroom-tools | headroom+prose | pixroom-default | pixroom+prose | prose Δtok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rag-doc | prose | 1713 | 1713 (0%) | 1713 (0%) | 1348 (21%) | 1713 (0%) | **1348 (21%)** | px 365t |
| rag-large | prose | 3019 | 3019 (0%) | 3019 (0%) | 2387 (21%) | 3019 (0%) | **2387 (21%)** | px 632t |
| mixed-all | mixed | 20356 | 17003 (16%) | 14231 (30%) | 13875 (32%) | 10878 (47%) | **10522 (48%)** | px 356t |
| control-tools | control | 18664 | 15311 (18%) | 12539 (33%) | 12539 (33%) | 9186 (51%) | **9186 (51%)** | px 0t |

**Verdict:** `prose-helps=true`, `full-stack-best=true`, `no-harm=true`. On prose-heavy requests every non-prose config reduces the user prose by **0%** — it is the region pxpipe (slab-only) and the tool_result stage both skip. The prose path is the only one that touches it, and it composes **additively** with optical + tool_result compression (`mixed-all`: pixroom+prose is best). On `control-tools` (no prose) the prose path is byte-identical to its baseline.

> **Honest scope.** Kompress is lossy prose token-drop with a must-keep guard (numbers, ALLCAPS, paths, CamelCase are never dropped) and every offload is CCR-recoverable. Realized savings scale with prose redundancy: measured **directly** on varied prose, Kompress cuts **~6% (dense) / 15% (natural) / 18% (redundant)** of prose tokens; the synthetic corpus here is moderately redundant (~21%). It is **opt-in** and needs the sidecar to have the Kompress tokenizer (`pip install transformers` — the lightweight ONNX path, no torch); pixroom sends `compress_user_messages` automatically. Without Kompress the sidecar no-ops prose and these rows tie their baselines.

## Findings

- **Offline (claude-fable-5):** pxpipe-only 21.2%, headroom-only 20.5%, **pixroom 41.7%** overall input-token reduction. The two engines target disjoint regions (optical→system slab, semantic→tool outputs), so composing them beats either alone.
- **Live Copilot (claude-opus-4.8):** wrapping works end-to-end on the real subscription; correctness is preserved. For Copilot specifically, pixroom's value is headroom's semantic engine (optical is out of scope for these models).
- **Live Claude Code (fable-5):** optical genuinely engages — pxpipe/pixroom image the static slab for a **net total-input cut vs native** despite the proxy's request inflation, correctness preserved (except a base-URL arithmetic quirk that hits *all* proxies, not compression). On opus (out of optical scope) the same proxying nets *more* tokens. The decisive subscription concern is the **prompt cache**: aggressive/lossy restructuring interacts with Claude Code's cache, so pixroom goes stealth there. See Arm C; the full optical+semantic composition is Arm A.
- **Proof (Arm E): pixroom dominates** — `dominates-all=true`, never worse than the better single engine, and **strictly better on mixed-json + mixed-logs** (savings are additive across the disjoint optical/semantic regions). It ties the better engine only on single-region workloads. So: **better than both where it matters, never worse anywhere.**
- **Prose (Arm F): fills the gap** — a large user-message prose block is compressed **0%** by pxpipe, headroom-tools, and default pixroom, but `PIXROOM_SEMANTIC_PROSE=1` routes it to headroom's Kompress for a real, reversible cut (~6–21% of prose tokens by redundancy), **additive** with the optical + tool_result regions and a **no-op** when there's no prose.
- **Right-sizing:** use optical where you control an Anthropic model in pxpipe's scope; use headroom (semantic) everywhere, including Copilot; use pixroom to get both automatically where both apply.

## Reproduce

```bash
npm run build
~/repos-pixroom/.headroom-venv/bin/headroom proxy --port 8787 &   # semantic sidecar
node benchmarks/offline.mjs           # Arm A (3-way, offline)
BENCH_MODEL=claude-opus-4.8 node benchmarks/copilot.mjs   # Arm B (live Copilot)
PIXROOM_OPTICAL_ON_SUBSCRIPTION=1 BENCH_MODEL=claude-fable-5 node benchmarks/claude.mjs  # Arm C (live Claude 4-way, optical on)
node benchmarks/proof.mjs             # Arm E (input-token domination proof)
node benchmarks/prose.mjs             # Arm F (prose region, needs transformers in the sidecar)
node benchmarks/report.mjs            # regenerate this file
```
