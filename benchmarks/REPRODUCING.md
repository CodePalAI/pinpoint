# Reproducing Pinpoint's benchmark claims

Pinpoint separates deterministic offline checks from paid model evidence. Do not use an offline token estimate as proof of provider billing or model quality.

## No-key checks

These commands make no provider calls:

```bash
npm ci
npm run demo:qcv
npm run bench:qcv-quality
npm run bench:virtual
npm run bench:mcp-opaque-flow
```

What they establish:

| Command | Evidence | What it can prove |
|---|---|---|
| `npm run demo:qcv` | Offline real transform | The shipped exact path can answer one supported lookup and replace its dataset region |
| `npm run bench:qcv-quality` | Offline real transform | Exact-operation and refusal coverage over the committed synthetic fixtures |
| `npm run bench:virtual` | Offline real transform | Token accounting for QCV against the committed comparison fixtures |
| `npm run bench:mcp-opaque-flow` | Protocol integration | Fail-closed source capture, hidden exact destination calls, bypass denial, transcript canary absence, signed receipt verification/chaining, and local latency |

They do not establish live model quality, provider-reported usage, real-agent savings, or production latency.

The opaque-flow protocol gate starts the committed unmodified stdio fixture, runs 30 exact flows and seven adversarial calls, scans 400 generated canaries, verifies every receipt and chain link, mutates one receipt to prove rejection, and compares client-visible bytes with a constructed direct-MCP transcript. It makes no provider request. The committed receipt is `results/mcp-opaque-flow.first-party-macos-arm64-20260715.json`.

## Live cross-host opaque-flow gate

Install and authenticate current Claude Code and GitHub Copilot CLI clients, then run:

```bash
npm run bench:mcp-opaque-flow:cross-host
```

The script sets a $0.15 Claude budget cap, disables unrelated Claude tools, exposes only the synthetic MCP server to Copilot, and retains no raw event stream or debug log. It fails unless both hosts call the source plus `pinpoint_flow`, neither model calls the hidden destination or query tool, both signed receipts verify, both hidden destinations accept the exact 40-record projection, all 800 aggregate canaries and both public value hashes are absent, both final answers equal `VALIDATED`, and no repository file changes occur.

This is one explicitly sequenced first-party synthetic task. It does not measure tool discovery among unrelated servers, external demand, semantic side channels, or production data. Review the content-free receipt before publishing a replication.

## Repeated multi-provider evidence gate

The primary paid gate needs both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. Set them through your shell's secure or masked input flow. Never paste a key into a command transcript, issue, artifact, or pull request.

Install the optional Headroom comparison sidecar, build Pinpoint, and run the offline harness self-test:

```bash
python3.13 -m venv .venv
.venv/bin/pip install "headroom-ai>=0.31.0"
export PINPOINT_HEADROOM_BIN="$PWD/.venv/bin/headroom"
npm ci
npm run bench:evidence:self-test
```

The self-test verifies 30 task templates, five unique fixture variants per template, 150 unique fixture hashes, six categories, balanced three-protocol coverage, budget enforcement, credential scrubbing, and the exact statistical threshold. With zero paired harms over 150 observations, the one-sided 95% Clopper-Pearson upper bound is 1.977%.

Run the transform-only preflight. It lists models, proves all 30 QCV plans are exact without model fallback, and computes a one-token-per-byte conservative spend bound. Listing provider models may make authenticated metadata requests, but this phase sends no completion requests:

```bash
BENCH_MAX_USD=15 \
BENCH_MAX_REQUESTS=450 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-20260715 \
npm run bench:evidence:preflight
```

Run one exact QCV canary through Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses:

```bash
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=0.15 \
BENCH_MAX_REQUESTS=3 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-20260715 \
npm run bench:evidence:canary
```

Run the complete gate only after both checks pass:

```bash
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=15 \
BENCH_MAX_REQUESTS=450 \
BENCH_REPS=5 \
BENCH_SEED=20260715 \
BENCH_BOOTSTRAP_SAMPLES=10000 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-20260715 \
npm run bench:evidence
```

The gate fails unless all of these hold:

- at least 30 task templates and five independently parameterized variants per template;
- a distinct fixture hash, payload, expected answer, and task ID for every paired observation;
- all six arm-order permutations observed;
- two live models and Anthropic Messages, OpenAI Chat, and OpenAI Responses represented;
- at least 98% QCV exact accuracy;
- one-sided 95% paired-harm upper bound below two percentage points versus raw and Headroom;
- QCV modeled provider cost at least 25% below Headroom, including the paired-bootstrap 95% lower bound;
- no harness retries, complete observations, and spend/request caps respected.

The committed first-party run used Claude Haiku 4.5 and GPT-4.1 mini. It made 450 completion calls and observed $2.295591 in provider spend. The one-token-per-byte preflight projection was $14.8625; that deliberately extreme value is a cap reservation, not a token or cost estimate. Actual modeled cost uses provider-reported usage. Pricing is an explicit dated public-price snapshot in the receipt; review it before each replication.

The exact harm interval treats the 150 fixed, independently parameterized variants as exchangeable benchmark units. It is a bound for this benchmark population under that assumption, not a confidence interval for organic customer traffic. Replications should use a new seed and artifact label and should add new task families rather than only rerunning the same fixtures.

## Real-agent capture and replay gate

Install current Claude Code and Codex CLIs. The harness runs them in disposable synthetic repositories through Pinpoint. It never modifies stored Codex auth: Codex uses a disposable `CODEX_HOME` and a custom loopback provider supplied through `CODEX_API_KEY`. Source captures and raw agent output are deleted after each session.

Run the two-session canary, then the complete ten-session gate:

```bash
BENCH_MAX_USD=0.5 \
BENCH_MAX_REQUESTS=12 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-20260715 \
npm run bench:agent-traces:canary

BENCH_MAX_USD=3 \
BENCH_MAX_REQUESTS=60 \
BENCH_MAX_REQUESTS_PER_SESSION=8 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-20260715 \
npm run bench:agent-traces
```

The full gate requires five Claude Code and five Codex sessions, correct final email values parsed only from Claude's final `result` or Codex's last `agent_message`, tool continuations, four long/join sessions, stable cache shape, one successful injected POST retry per agent, and hash-identical offline replay of every sanitized derivative. Claude must exercise QCV. Codex is expected to pass through when it locally queries sub-6,000-character chunks.

Before publishing, verify every trace is mode `0600` and scan the receipts and `benchmarks/traces/agent-gate/` for credentials, home-directory paths, temporary paths, proprietary prompts, and real user data. The committed run observed $0.104211 in provider spend under a $1.371887 conservative exposure calculation.

These are first-party real-agent sessions over synthetic repositories, not customer production traces. Do not relabel them as organic or external traffic.

## Historical paid pilot

Use a clean machine or disposable environment. Record the operator, date, OS, CPU, Node version, Python version, Pinpoint commit, Headroom version, exact model ID, and Anthropic SDK/API version with the receipt.

Install the optional semantic sidecar used by the harness, then build Pinpoint:

```bash
python3.13 -m venv .venv
.venv/bin/pip install "headroom-ai>=0.31.0"
export PINPOINT_HEADROOM_BIN="$PWD/.venv/bin/headroom"
npm ci
npm run build
npm run bench:anthropic:self-test
```

Set `ANTHROPIC_API_KEY` through your shell's secure or masked input flow.

Run the free token-count preflight first:

```bash
BENCH_VIRTUAL_CONTEXT=1 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic:preflight
```

Run the one-request canary. This requires an explicit paid-call switch and hard caps:

```bash
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=0.01 \
BENCH_MAX_REQUESTS=1 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic:canary
```

Only continue if the canary is exact and the preflight's projected maximum is acceptable:

```bash
BENCH_VIRTUAL_CONTEXT=1 \
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=0.05 \
BENCH_MAX_REQUESTS=4 \
BENCH_SEED=202607 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic
```

`BENCH_ARTIFACT_LABEL` preserves the canonical receipt and writes labeled JSON files under `benchmarks/results/`. Change both the seed and label for each repetition. Run at least five paired repetitions before treating the result as more than a pilot.

## Publishing a replication

1. Keep every successful and failed run.
2. Confirm the artifacts contain no credentials, proprietary prompts, or real user data. The harness refuses known Anthropic key shapes, but the operator still owns the review.
3. Open a benchmark-replication issue with environment metadata and the raw labeled JSON receipts, or submit a pull request that adds them without replacing the canonical pilot.
4. Report exact task counts, repetitions, model IDs, dates, provider usage, failures, retries, and exclusions beside every aggregate.
5. Do not update the README headline from a single replication. Aggregate reviewed runs first and preserve the original receipt.

The full generated [benchmark report](./REPORT.md) labels simulations, offline transforms, live controlled calls, and live agent runs separately.