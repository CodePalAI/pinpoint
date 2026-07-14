<h1 align="center">Pixroom</h1>

<p align="center"><strong>Stop paying your LLM to reread giant tool outputs.</strong></p>

<p align="center">A local context optimizer for coding agents and LLM apps. Pixroom shrinks requests before they leave your machine while keeping exact data available when the model needs it.</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg">
       <a href="https://github.com/CodePalAI/pixroom/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CodePalAI/pixroom/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg">
       <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
</p>

<p align="center">
       <a href="#start-in-30-seconds">Start</a> ·
       <a href="#use-it-with-your-agent-or-app">Use it</a> ·
  <a href="#proof">Proof</a> ·
  <a href="#how-it-works">How it works</a> ·
       <a href="#safety-and-privacy">Safety</a> ·
       <a href="./benchmarks/REPORT.md">Benchmarks</a>
</p>

<p align="center"><sub>Local by default | No Pixroom account | Works with your existing provider credentials</sub></p>

---

## Save up to 97.4% on eligible input

LLM agents often resend thousands of lines of old JSON, logs, source code, and tool output on every turn. Those input tokens cost money and consume context space even when the model needs only one row or count.

Pixroom sits between your app and the provider. You keep the same model, SDK, and response format.

In controlled paid Haiku 4.5 pilots, measured against sending the same requests directly to the LLM:

| Workload | Raw LLM input | With Pixroom | Input saved | Exact score |
|---|---:|---:|---:|---:|
| Mixed long-context tasks (3) | 24,249 | 14,478 | **40.3%** | 2/3 -> 2/3 |
| Structured JSON and log tasks (2) | 22,614 | 594 | **97.4%** | 1/2 -> 2/2 |

Modeled cost fell 40.1% and 97.1%, respectively. These were small controlled pilots with synthetic fixtures, one model, and one run per task. They show what Pixroom did on eligible requests, not what every prompt will save.

## Start in 30 seconds

You need Node.js 18 or newer and Git. Pixroom is not on the npm registry yet, so install the current release directly from GitHub:

```bash
npm install -g git+https://github.com/CodePalAI/pixroom.git
pixroom demo
```

The demo runs the real optimizer without an API key, model call, or network request:

```console
$ pixroom demo

pixroom QCV demo (offline)
dataset: 1,000 exact JSON rows (55,281 chars)
question: What is the email for id 733?
dataset region: 13,821 -> 171 estimated tokens (98.8% smaller)
exact answer materialized: user733@example.com
model-driven fallback: not needed
network requests: 0
```

<details>
<summary><strong>Installing from a cloned checkout</strong></summary>

```bash
git clone https://github.com/CodePalAI/pixroom.git
cd pixroom
npm install && npm link
pixroom demo
```

</details>

## Use it with your agent or app

### Coding agents

| You use | Run |
|---|---|
| Claude Code | `pixroom wrap claude` |
| Codex | `pixroom wrap codex` |
| Aider, OpenCode, Goose, OpenHands, or Vibe | `pixroom agent list`, then `pixroom wrap <agent>` |
| GitHub Copilot CLI | `pixroom doctor copilot`, then `pixroom wrap copilot` |
| Cursor, Cline, or Continue | `pixroom wrap cursor` to print the base URL setup |

`wrap` changes only the launched process environment. It does not rewrite your agent configuration.

### Your own LLM app

Start Pixroom:

```bash
pixroom proxy
```

Then point your existing client at it:

```bash
# Anthropic-compatible clients
ANTHROPIC_BASE_URL=http://127.0.0.1:8788 your-command

# OpenAI-compatible clients
OPENAI_BASE_URL=http://127.0.0.1:8788/v1 your-command
```

Keep your normal provider key configured in the client. Pixroom forwards it to the provider and does not write it to disk.

## What Pixroom does automatically

- **Large old tool results:** keeps eligible JSON, logs, and source output in bounded local memory, then inserts the exact row, field, or count needed now.
- **Other bulky context:** lets registered optimizers reduce eligible prompt, tool, and history regions without applying two transforms to the same bytes.
- **Unclear or unsafe requests:** leaves them unchanged. Pixroom does not guess an answer from ambiguous data.
- **Every request:** records an honest savings report, including negative savings and hidden continuation costs.

Safe exact optimization is already on. Most users do not need to configure QCV or understand its internals.

## How it works

A raw agent request can resend thousands of lines of JSON, logs, source code, tool definitions, and old conversation history. The model often needs only a small part of that material for the current turn.

Pixroom sits between the client and the provider:

1. It identifies the distinct context regions in the request.
2. Query-Backed Context Virtualization (QCV) moves eligible structured tool output into an exact local store and computes narrow lookups or counts locally.
3. Registered optimizers can reduce other eligible regions. Each region has one owner, so transforms do not overlap.
4. Pixroom validates and commits each selected optimizer atomically, then forwards the composed request to the same LLM provider. A failed proposal rolls back without corrupting the request or undoing previously committed regions.

```
agent or app
       |
       | raw Anthropic or OpenAI request
       v
Pixroom on 127.0.0.1
       |  exact local datasets
       |  selected context optimizations
       |  validated request + savings report
       v
same LLM provider
```

Provider credentials pass through to the configured upstream. Pixroom does not send them to local optimization services. Provider responses keep their original format and stream through unless a feature explicitly requires a bounded continuation.

### Exact answers instead of summaries

Suppose an agent loaded 50,000 characters of account data and now asks for one email address.

Without Pixroom, the provider reads the full dataset again. With Pixroom, the provider receives a small dataset reference plus the exact matching email. The original bytes stay in bounded local memory. Pixroom does not summarize the data or ask the model to guess which row matters.

<details>
<summary><strong>When exact optimization applies</strong></summary>

Pixroom changes a request only when all of these checks pass:

1. The request uses Anthropic Messages, OpenAI Chat, or OpenAI Responses with API-key authentication.
2. One eligible historical dataset matches one explicit lookup or supported count.
3. The local operation returns one complete, bounded, unambiguous result.
4. The dataset reference plus exact result is smaller than the original tool output.
5. The data fits the configured request and memory limits.

Repeated selectors, ranges, negation, multiple matching datasets, malformed values, and subscription traffic pass through unchanged. Exact prefetch works with streaming responses.

</details>

An experimental model-driven fallback exists for harder Anthropic questions, but it is off by default because an earlier version saved tokens while reducing task quality. Disable all exact virtualization with `PIXROOM_VIRTUAL_CONTEXT=0` or `pixroom proxy --no-qcv`. The [QCV design note](./planning/query_backed_context.md) documents every boundary and the rejected design.

## Advanced workflows

Most users only need `pixroom wrap <agent>` or `pixroom proxy`. The commands below are for evaluation and integration work.

<details>
<summary><strong>Show capture, telemetry, SDK, and MCP workflows</strong></summary>

<br>

### Preview changes without applying them

```bash
pixroom proxy --mode shadow --port 8788
```

### Capture and replay your own traffic

Capture bodies only on a trusted machine. Pixroom records metadata by default and includes prompts only when you explicitly enable them:

```bash
PIXROOM_CAPTURE_PATH=.pixroom/capture.jsonl PIXROOM_CAPTURE_BODIES=1 pixroom proxy
pixroom replay .pixroom/capture.jsonl
```

Replay runs the captured requests through the current optimizer stack without calling a provider.

### Export telemetry

Send content-free optimization spans to an OTLP/HTTP collector:

```bash
PIXROOM_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pixroom proxy
```

### Embed the runtime

```ts
import { createPixroom } from 'pixroom';

const pixroom = createPixroom();
const { body, report } = await pixroom.route(
  'anthropic',
  'claude-haiku-4-5',
  anthropicRequestBody,
);

console.log(body);
console.log(report.tokensSavedTotal, report.savedFraction);
```

Other useful commands:

```bash
pixroom stats               # savings from a running proxy
pixroom export README.md    # offline transform report
pixroom integration list    # installed optimizer capabilities
pixroom mcp                 # MCP tools over stdio
```

Public subpaths expose the integration kernel, protocols, normalized output events, agent adapters, virtual-context APIs, capture/replay, and OTLP telemetry.

</details>

## Proof

### Paid exact-context pilot

The headline result came from two fixed Haiku 4.5 tasks sent directly to Anthropic and through Pixroom:

- Provider-reported input fell from **22,614 to 594 tokens**.
- Modeled cost fell from **$0.022684 to $0.000664**.
- Exact score improved from **1/2 to 2/2**.

On the log task, the raw model answered `5` for a fixture containing seven errors. Pixroom counted the exact local lines and returned `7`. See the [raw paid result](./benchmarks/results/direct-anthropic-virtual.json).

A separate three-task pilot tested the optional semantic path. Input fell from 24,249 to 14,478 tokens with the same 2/3 exact score. That result validates the integration path rather than Pixroom's exact-context algorithm.

These are small pilots with synthetic fixtures, one model, and one randomized pair per task. They do not establish universal model-quality parity.

### Broader offline token accounting

The offline corpus runs real Pixroom transforms over agent-shaped requests and compares the resulting input with the original raw request:

| Workload | Raw input | Pixroom input | Input saved |
|---|---:|---:|---:|
| JSON tool output + static context | 18,662 | 9,184 | **50.8%** |
| Build log + static context | 18,309 | 10,063 | **45.0%** |
| Source output + static context | 12,049 | 5,846 | **51.5%** |
| **Total** | **49,020** | **25,093** | **48.8%** |

This offline result validates transform and token accounting, not model quality. The paid pilots are also small: synthetic fixtures, one model, one randomized pair per task, and no retries. Cache behavior, retrievals, model choice, and workload eligibility can change the net saving.

The broader exact-QCV suite runs 36 deterministic tasks across JSON lookup, filtered counts, logs, source exports, tabular JSON, and nested projections. It produced 36/36 exact materializations, 36/36 virtualizations, and zero fallback tools, reducing the measured dataset regions from 104,018 to 5,964 estimated tokens. It also refused 12/12 ambiguous or multi-dataset controls without exposing fallback. This is offline operation coverage, not live-model quality evidence.

The full [benchmark report](./benchmarks/REPORT.md) keeps live, offline, agentic, and simulated evidence separate. It also preserves failed experiments instead of averaging them into successful results.

## Compatibility

| API | Exact local lookups | Streaming exact lookups | Local retrieval continuation |
|---|:---:|:---:|:---:|
| Anthropic Messages | Yes | Yes | Yes |
| OpenAI Chat Completions | Yes | Yes | Yes |
| OpenAI Responses | Yes | Yes | Yes |

Exact virtualization applies to API-key traffic. Subscription and unsupported traffic pass through unchanged unless another configured optimizer can handle it.

Wrappers are included for Claude Code, Codex, Aider, OpenCode, Goose, OpenHands, Vibe, GitHub Copilot CLI, Cursor, Cline, and Continue. Run `pixroom agent list` to see whether each adapter proxies traffic, delegates to another local path, or prints configuration.

## Safety and privacy

- Pixroom binds to `127.0.0.1` by default. It is not an authenticated public gateway.
- Provider credentials are forwarded to the configured provider and are not stored by Pixroom.
- QCV stores exact eligible tool output in process memory only. The default cap is 256 datasets or 64 MiB, with least-recently-used eviction.
- Audit and shadow modes inspect proposals without retaining QCV datasets or changing requests.
- Failed proposals leave their regions unchanged; unavailable optimizers, unsupported traffic, and unsafe QCV questions pass through to the next eligible path.
- The experimental model-driven QCV fallback is disabled by default and has a separate switch.
- Local retrieval calls run inside the proxy only when every tool call in the response belongs to Pixroom. Mixed tool ownership replays the original request.
- Durable capture is off by default and records metadata only unless `PIXROOM_CAPTURE_BODIES=1` is explicitly set. Body-enabled files contain private prompts and are forced to mode `0600`.
- OTLP spans never include request or response content.

See the [security policy](./SECURITY.md) before exposing the proxy outside a trusted machine or network.

## Configuration (optional)

The defaults are designed for local use. These are the controls most people need:

| You want to | Set |
|---|---|
| Change the proxy port | `PIXROOM_PORT=9000` |
| Preview without changing requests | `PIXROOM_MODE=shadow` |
| Turn off exact virtualization | `PIXROOM_VIRTUAL_CONTEXT=0` |
| Reduce logs | `PIXROOM_LOG=warn` |

<details>
<summary><strong>All environment variables</strong></summary>

<br>

| Env | Purpose | Default |
|---|---|---|
| `PIXROOM_HOST` / `PIXROOM_PORT` | listen interface / port | `127.0.0.1` / `8788` |
| `PIXROOM_MODE` | `audit` (no processors), `shadow` (propose only), `optimize` (commit), `enforce` (reserved output policy) | `optimize` |
| `PIXROOM_VIRTUAL_CONTEXT` | exact QCV master switch; set `0` for the kill switch | `on` |
| `PIXROOM_VIRTUAL_QUERY_FALLBACK` | model-driven `pixroom_query` continuation (experimental) | `off` |
| `PIXROOM_VIRTUAL_MIN_CHARS` / `PIXROOM_VIRTUAL_MAX_CHARS` | eligible dataset size range | `6000` / `2000000` |
| `PIXROOM_VIRTUAL_MAX_ENTRIES` / `PIXROOM_VIRTUAL_MAX_STORED_BYTES` | in-process exact-store limits | `256` / `67108864` |
| `PIXROOM_VIRTUAL_MAX_DATASETS_PER_REQUEST` | maximum datasets virtualized in one request | `8` |
| `PIXROOM_VIRTUAL_MAX_QUERY_ROUNDS` | hidden query fallback round cap | `4` |
| `PIXROOM_CCR_CONTINUATION` | execute pure local retrieval calls inside the proxy | `on` |
| `PIXROOM_CCR_MAX_CONTINUATION_ROUNDS` | hidden CCR continuation round cap | `3` |
| `PIXROOM_CAPTURE_PATH` | fsynced JSONL optimization capture | unset |
| `PIXROOM_CAPTURE_BODIES` | include sensitive bodies required for replay | `off` |
| `PIXROOM_CAPTURE_MAX_BYTES` / `PIXROOM_CAPTURE_MAX_FILES` | bounded JSONL rotation | `268435456` / `3` |
| `PIXROOM_OTLP_ENDPOINT` | OTLP/HTTP traces endpoint | unset |
| `PIXROOM_OTLP_HEADERS` | collector headers as comma-separated `key=value` pairs | unset |
| `PIXROOM_OPTICAL` / `PIXROOM_SEMANTIC` | built-in integration switches | `on` |
| `PIXROOM_MODELS` | optical integration model allowlist; `off` disables it | integration default |
| `PIXROOM_SEMANTIC_PROSE` | include large prose from non-recent user turns | `off` |
| `PIXROOM_OPTICAL_ON_SUBSCRIPTION` | allow lossy optical on oauth/subscription (stealth) | `off` |
| `PIXROOM_LOG` | `silent`\|`error`\|`warn`\|`info`\|`debug` | `info` |

</details>

Advanced QCV limits are documented in the [design note](./planning/query_backed_context.md). Run `pixroom help` for CLI options and `pixroom doctor` to inspect the local runtime.

## Integrations

You can use Pixroom's exact-context path and demo with Node.js alone. Python is not required.

Pixroom owns the proxy, QCV, protocol adapters, transactional request planning, and savings reports. Its public integration API also lets specialized optimizers propose changes without taking over routing or safety policy.

Two standalone examples live in [`examples/integrations`](./examples/integrations/README.md): a non-compression secret-redaction policy and a deterministic JSON tool-output minifier. They import only public package exports and run with built-ins disabled.

The package includes [pxpipe](https://github.com/teamchong/pxpipe) for supported in-process optical compression. [Headroom](https://github.com/headroomlabs-ai/headroom) adds optional semantic compression through a local sidecar:

```bash
pip install headroom-ai
pixroom doctor
```

If the sidecar is unavailable, that stage becomes a no-op while exact QCV and other available paths continue. Configure an existing sidecar with `PIXROOM_HEADROOM_URL`, or disable auto-start with `PIXROOM_HEADROOM_AUTOSPAWN=0`. See [UPSTREAM.md](./UPSTREAM.md) for versioning and attribution.

## Contributing

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md). The main local checks are:

```bash
npm run typecheck
npm test                        # offline test suite
node benchmarks/proof.mjs       # constructed additivity check
node benchmarks/rd_frontier.mjs # simulated RD surface
node benchmarks/adaptive.mjs    # controller simulation
npm run bench:virtual           # QCV vs current full stack, no provider calls
npm run bench:qcv-quality       # 36 exact structured tasks, no provider calls
npm run bench:profile           # paired direct-vs-proxy local profile + raw samples
npm run bench:profile:isolated  # separate load, proxy, and upstream processes
```

## Status

Pixroom is experimental but usable today for local evaluation and API-key traffic.

- **Implemented:** cross-provider exact QCV, streaming exact prefetch, local retrieval continuation, capture/replay, OTLP export, SDK, MCP, and agent wrappers.
- **Still being proved:** repeated live-model quality across larger task sets, real sanitized agent traces, independent adoption, and lower proxy overhead under heavy concurrency.

The [product assessment](./planning/product_assessment.md) explains the evidence and current limits without marketing shortcuts.

## License

**Apache-2.0.** Third-party attribution is listed in [`NOTICE`](./NOTICE).

Contributions are welcome under [`CONTRIBUTING.md`](./CONTRIBUTING.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

