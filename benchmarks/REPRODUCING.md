# Reproducing Pinpoint's benchmark claims

Pinpoint separates deterministic offline checks from paid model evidence. Do not use an offline token estimate as proof of provider billing or model quality.

## Packaged clean-machine reproduction

The lowest-friction no-model replication runs from the installed package and writes one
content-free mode-0600 JSON bundle:

```bash
pinpoint evidence reproduce \
	--relationship unaffiliated \
	--out pinpoint-opaque-flow-reproduction.json

pinpoint evidence verify pinpoint-opaque-flow-reproduction.json
```

Use `maintainer`, `contracted`, or `other` instead of `unaffiliated` when appropriate.
The relationship field is self-declared and must be checked with the submission. The
bundle runs 30 repeated exact calls of one synthetic hidden destination flow and eight
bypass classes through the production gateway, retains every signed receipt and denial
record, scans 401 synthetic private values, and records a complete runtime-code manifest plus
package identity. It contains no fixture values, credentials, prompts, or raw event
stream. Its SHA-256 checksum detects accidental corruption; neither that checksum nor
the embedded receipt verifier authenticates the operator.

Keep failed bundles and disclose every attempt. Submit through the
[Evidence replication issue form](../.github/ISSUE_TEMPLATE/benchmark_replication.yml)
or a pull request. This packaged gate reduces setup friction; it does not establish
production demand, external identity, or independence by itself.

## No-key checks

These commands make no provider calls:

```bash
npm ci
npm run demo:qcv
npm run bench:qcv-quality
npm run bench:virtual
npm run bench:mcp-opaque-flow
npm run bench:mcp-oss-cross-server
npm run bench:mcp-common-workflows
npm run bench:compare-hcp
```

What they establish:

| Command | Evidence | What it can prove |
|---|---|---|
| `npm run demo:qcv` | Offline real transform | The shipped exact path can answer one supported lookup and replace its dataset region |
| `npm run bench:qcv-quality` | Offline real transform | Exact-operation and refusal coverage over the committed synthetic fixtures |
| `npm run bench:virtual` | Offline real transform | Token accounting for QCV against the committed comparison fixtures |
| `npm run bench:mcp-opaque-flow` | Protocol integration | Fail-closed source capture, hidden exact destination calls, bypass denial, transcript canary absence, operator/session/policy authorization, signed receipt verification/chaining, and local latency |
| `npm run bench:mcp-oss-cross-server` | OSS cross-server integration | Exact hidden composition across pinned unmodified filesystem and memory servers, persistent side-effect verification, separate process environments, and transcript canary absence |
| `npm run bench:mcp-common-workflows` | Paired OSS protocol integration | Exact direct-versus-Pinpoint outcomes, data-bearing response bytes, unrelated fixture values at the client boundary, and three no-op controls across seven published filesystem, memory, Git, Fetch, DBHub, Time, and Playwright MCP servers |
| `npm run bench:compare-hcp` | Comparative mechanism evaluation | Clean pinned HCP validation plus byte-identical Pinpoint/HCP workflow, native denials, client-boundary canary scan, authority/TCB comparison, and explicit non-comparability |

They do not establish live model quality, provider-reported usage, real-agent savings, or production latency.

## Common MCP workflow comparison

Run the paired credential-free matrix:

```bash
npm run bench:mcp-common-workflows
```

The gate launches each pinned published MCP server twice over equivalent disposable
fixtures. The direct arm receives the complete source result and applies a deterministic
local grader. The Pinpoint arm receives either one artifact plus the minimum bounded
query result, or the original result when the upstream MCP operation is already bounded.
Every pair must produce the same exact answer.

| Workflow | Published MCP | Expected Pinpoint behavior |
|---|---|---|
| Exact account lookup in a 1,000-row JSON export | `@modelcontextprotocol/server-filesystem@2026.7.10` | `json_select` over an artifact |
| Filtered account count | `@modelcontextprotocol/server-filesystem@2026.7.10` | `count` over an artifact |
| Incident lookup in a 2,000-line log | `@modelcontextprotocol/server-filesystem@2026.7.10` | literal `grep` over an artifact |
| One fact in a 2,000-line web page | `mcp-server-fetch==2026.7.10` | literal `grep` over an artifact |
| One row in a 1,000-row SQL result | `@bytebase/dbhub@0.23.0` | `json_select` over a nested artifact collection |
| One node from a 500-entity full graph | `@modelcontextprotocol/server-memory@2026.7.4` | `json_select` over an artifact |
| The same node through native `open_nodes` | `@modelcontextprotocol/server-memory@2026.7.4` | passthrough; no artifact or savings claim |
| One marker in a 2,000-line commit | `mcp-server-git==2026.7.10` | literal `grep` over an artifact |
| One target in a large browser page | `@playwright/mcp@0.0.78` | literal `grep` over the default inline accessibility snapshot |
| UTC meeting time converted to Tokyo | `mcp-server-time==2026.7.10` | passthrough; naturally bounded response |

The retained first-party run passed 10/10 workflows. Across data-bearing responses,
direct MCP exposed 1,259,326 bytes and Pinpoint exposed 12,249 bytes, a 99.0%
reduction. The eight oversized workflows kept 11,992 unrelated synthetic marker
occurrences out of the Pinpoint-side client transcript. Two controls created no
artifact: native `open_nodes` returned 437 bytes in both arms and Time returned 450
in both.

These are protocol measurements, not model-token measurements. Fixture setup,
initialization, and tool catalogs are excluded equally; package download time is not
measured. The direct grader represents what a correct client can compute after receiving
the full response, not what an LLM will necessarily infer. See the
[canonical receipt](./results/mcp-common-workflows.first-party-macos-arm64-20260716.json)
the [internet research index](../comparisons/README.md), and the
[evaluation plan](../planning/common_mcp_workflow_evaluation.md).

The opaque-flow protocol gate starts the committed unmodified stdio fixture, runs 30 exact flows and eight adversarial calls, scans 400 generated canaries, verifies every receipt and chain link, validates an operator delegation and exact policy opening, rejects receipt/authority tampering and a wrong operator root, and compares client-visible bytes with a constructed direct-MCP transcript. It makes no provider request. The committed receipt is `results/mcp-opaque-flow.first-party-macos-arm64-20260715.json`.

For security-sensitive runtime changes, run both bounded models and the real-process
adversarial conformance slice:

```bash
npm run formal:opaque-flow
npm run formal:opaque-flow:async
npm run test:mcp-adversarial
```

Repeat the retained synthetic policy opening independently:

```bash
pinpoint-verify-receipt \
	benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json \
	--path firstReceipt \
	--operator-key-id <security.operatorKeyId-from-the-receipt> \
	--policy benchmarks/fixtures/opaque_flow_config.json \
	--authority-opening benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json
```

The benchmark retains an opening because its policy is public and synthetic. Do not publish a production opening record; it enables testing candidate fixed values.

The published cross-server gate creates disposable npm homes/caches and a disposable
memory JSONL file. It passes only if the filesystem server's protected result becomes
one random capability, the memory destination remains absent from the host tool
catalog, direct destination access is denied, exactly 40 selected entities persist,
all 600 source canaries remain absent from the client transcript, and the receipt,
operator delegation, policy opening, and destination-server binding verify. It does
not call a model or provider:

```bash
npm run bench:mcp-oss-cross-server
```

The HCP comparison clones public commit
`e7eb50158f3d495f1dc99a2755abe08f0d0db716` into a disposable directory. It
preserves the public suite's current 293/296 result and three readiness failures,
runs the unchanged native data-pipe demo, then executes 30 same-workflow HCP
repetitions through public JSON-RPC APIs. It fails if fixture hashes differ, either
mechanism arm fails, any of 600 canaries appears, the clean HCP clone changes, or the
Pinpoint worktree changes:

```bash
npm run bench:compare-hcp
```

The HCP providers are thin comparison adapters and count toward that arm's trusted
code. Native denial classes are reported separately. Do not turn the recorded line
counts, process counts, or incomparable timing scopes into one score.

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