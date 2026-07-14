<div align="center"><pre>
██████╗ ██╗██╗  ██╗██████╗  ██████╗  ██████╗ ███╗   ███╗
██╔══██╗██║╚██╗██╔╝██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║
██████╔╝██║ ╚███╔╝ ██████╔╝██║   ██║██║   ██║██╔████╔██║
██╔═══╝ ██║ ██╔██╗ ██╔══██╗██║   ██║██║   ██║██║╚██╔╝██║
██║     ██║██╔╝ ██╗██║  ██║╚██████╔╝╚██████╔╝██║ ╚═╝ ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝
              save tokens before they reach the LLM
</pre></div>

<p align="center"><strong>Point your existing agent at one local proxy and send fewer input tokens to the LLM.</strong></p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg">
       <a href="https://github.com/CodePalAI/pixroom/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CodePalAI/pixroom/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg">
       <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
</p>

<p align="center">
       <a href="#try-it-locally">Try it</a> ·
  <a href="#proof">Proof</a> ·
  <a href="#agent-compatibility">Agents</a> ·
  <a href="#how-it-works">How it works</a> ·
       <a href="./benchmarks/REPORT.md">Benchmarks</a>
</p>

---

## Save up to 97.4% on eligible input

Pixroom reduces the context your agents and LLM apps send to model providers. Connect it with a base URL or agent wrapper; no app rewrite is required. Pixroom removes repeated bulk before the request leaves your machine. Your app still calls the same model and receives the same response format.

In controlled paid Haiku 4.5 pilots, measured against sending the same requests directly to the LLM:

| Workload | Raw LLM input | With Pixroom | Input saved | Exact score |
|---|---:|---:|---:|---:|
| Mixed long-context tasks (3) | 24,249 | 14,478 | **40.3%** | 2/3 -> 2/3 |
| Structured JSON and log tasks (2) | 22,614 | 594 | **97.4%** | 1/2 -> 2/2 |

Modeled cost fell 40.1% and 97.1%, respectively. These are small controlled pilots with synthetic fixtures, one model, and one run per task. They show measured savings on eligible requests, not a promise that every prompt will shrink by the same amount.

## Try it locally

From this checkout:

```bash
npm install && npm run build && npm link
pixroom demo
```

The demo runs the real exact-context optimizer without an API key, model call, or network request:

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

Start the local proxy when you are ready to use it with an app or agent:

```bash
pixroom proxy
```

Then point Anthropic clients to `http://127.0.0.1:8788` or OpenAI clients to `http://127.0.0.1:8788/v1`. You can also use one of the agent wrappers below.

## What it does

- Connects through one local endpoint. Existing apps only need a base URL change.
- Keeps eligible old JSON, logs, and source output in a bounded local store, then sends the model the exact result needed for the current question.
- Compresses other eligible context regions when a configured optimizer can reduce them safely.
- Preserves recent turns and passes unsupported or ambiguous requests through unchanged.
- Reports input-token savings per request, including negative results and fallback costs.
- Supports Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses, plus CLI wrappers for popular coding agents.
- Exposes the same runtime as a Node/TypeScript SDK and an MCP server.

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

### Exact context without guesswork

QCV does not summarize the stored dataset. It keeps the original bytes in process memory and inserts an exact result into the current turn. The default path does not ask the model to plan a retrieval.

QCV applies only when all of these conditions hold:

1. The request is Anthropic Messages, OpenAI Chat, or OpenAI Responses traffic using PAYG/API-key auth. Deterministic exact prefetch also works when the response is streamed.
2. Exactly one eligible historical dataset matches one explicit selector or supported exact count.
3. The local operation returns a complete, bounded, unambiguous result.
4. Manifest plus current-turn prefetch is smaller than the original tool result.
5. Every referenced dataset fits the per-request and process memory budgets.

Repeated selectors, ranges, negation, multiple matching datasets, malformed values, and subscription traffic pass through unchanged. The model-driven fallback remains unavailable on streaming requests. Disable QCV with `PIXROOM_VIRTUAL_CONTEXT=0` or `pixroom proxy --no-qcv`.

The model-driven `pixroom_query` fallback is separate and off by default. An early version saved tokens but reduced task quality, so the default now uses only conservative exact prefetch. See the [QCV design note](./planning/query_backed_context.md) for supported operations, safety limits, and the rejected design.

## Use it

```bash
pixroom proxy                           # local endpoint on 127.0.0.1:8788
pixroom wrap claude                     # launch a supported agent through Pixroom
pixroom agent list                      # show wrapper coverage
pixroom integration list                # show active optimizer capabilities
pixroom export README.md                # inspect savings without an LLM call
pixroom replay capture.jsonl            # replay body-enabled captures offline
pixroom mcp                             # expose compress, retrieve, and stats tools
```

Use shadow mode to measure proposals without changing requests:

```bash
pixroom proxy --mode shadow --port 8788
```

Capture replayable requests only on a trusted machine. Bodies are never captured unless explicitly enabled:

```bash
PIXROOM_CAPTURE_PATH=.pixroom/capture.jsonl PIXROOM_CAPTURE_BODIES=1 pixroom proxy
pixroom replay .pixroom/capture.jsonl
```

Export content-free optimization spans to an OTLP/HTTP collector:

```bash
PIXROOM_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pixroom proxy
```

Or embed the Node/TypeScript runtime:

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

Public subpaths expose the integration kernel, protocol registry, normalized output events, agent registry, virtual-context APIs, capture/replay, and OTLP telemetry.

## Proof

### Paid requests versus raw LLM usage

These pilots sent the same fixed tasks directly to Anthropic and through Pixroom. Input usage is provider-reported. Cost uses the provider's published Haiku 4.5 rates.

| Pilot | Raw input | Pixroom input | Reduction | Raw modeled cost | Pixroom modeled cost | Exact score |
|---|---:|---:|---:|---:|---:|---:|
| Mixed long-context, 3 tasks | 24,249 | 14,478 | **40.3%** | $0.024369 | $0.014598 | 2/3 -> 2/3 |
| Exact JSON and logs, 2 tasks | 22,614 | 594 | **97.4%** | $0.022684 | $0.000664 | 1/2 -> 2/2 |

The mixed-context pilot exercised Headroom semantic compression through Pixroom; its 40.3% result is integration evidence, not Pixroom-owned compression IP. The structured pilot exercised Pixroom's QCV deterministic exact path. On the log-count task, raw Haiku returned `5` for a fixture containing seven errors; Pixroom computed the exact count locally and returned `7`.

### Broader offline token accounting

The offline corpus runs real Pixroom transforms over agent-shaped requests and compares the resulting input with the original raw request:

| Workload | Raw input | Pixroom input | Input saved |
|---|---:|---:|---:|
| JSON tool output + static context | 18,662 | 9,184 | **50.8%** |
| Build log + static context | 18,309 | 10,063 | **45.0%** |
| Source output + static context | 12,049 | 5,846 | **51.5%** |
| **Total** | **49,020** | **25,093** | **48.8%** |

This offline result validates transform and token accounting, not model quality. The paid pilots are also small: synthetic fixtures, one model, one randomized pair per task, and no retries. Cache behavior, retrievals, model choice, and workload eligibility can change the net saving.

The broader exact-QCV suite runs 36 deterministic tasks across JSON lookup, filtered counts, logs, source exports, tabular JSON, and nested projections. It produced 36/36 exact materializations, 36/36 virtualizations, and zero fallback tools, reducing the measured dataset regions from 104,018 to 5,964 estimated tokens. This is offline operation coverage, not live-model quality evidence.

The full [benchmark report](./benchmarks/REPORT.md) keeps live, offline, agentic, and simulated evidence separate. It also preserves failed experiments instead of averaging them into successful results.

## Agent compatibility

`pixroom wrap <agent>` launches the agent with temporary environment changes. It does not edit the agent's configuration files.

| Setup | Agents | Command |
|---|---|---|
| Launch through the local proxy | Claude Code, Codex, Aider, OpenCode, Goose, OpenHands, Vibe | `pixroom wrap <agent>` |
| Use an existing subscription login | GitHub Copilot | `pixroom wrap copilot` |
| Print the base URL configuration | Cursor, Cline, Continue | `pixroom wrap <agent>` |

Run `pixroom agent list` for the exact traffic, delegation, and configuration coverage of each wrapper. Exact QCV applies to first-party Anthropic Messages, OpenAI Chat, and OpenAI Responses requests using API-key auth. Other traffic can use the remaining registered optimizers or pass through unchanged.

## Safety and privacy

- Pixroom binds to `127.0.0.1` by default. It is not an authenticated public gateway.
- Provider credentials are forwarded to the configured provider and are not stored by Pixroom.
- QCV stores exact eligible tool output in process memory only. The default cap is 256 datasets or 64 MiB, with least-recently-used eviction.
- Audit and shadow modes inspect proposals without retaining QCV datasets or changing requests.
- Failed proposals leave their regions unchanged; unavailable optimizers, unsupported traffic, and unsafe QCV questions pass through to the next eligible path.
- The experimental model-driven QCV fallback is disabled by default and has a separate switch.
- `headroom_retrieve` calls are executed inside the proxy only when every tool call in the response is Pixroom-owned. Mixed tool ownership replays the original request.
- Durable capture is off by default and records metadata only unless `PIXROOM_CAPTURE_BODIES=1` is explicitly set. Body-enabled files contain private prompts and are forced to mode `0600`.
- OTLP spans never include request or response content.

See the [security policy](./SECURITY.md) before exposing the proxy outside a trusted machine or network.

## Configuration

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
| `PIXROOM_CCR_CONTINUATION` | execute pure `headroom_retrieve` calls inside the proxy | `on` |
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

Advanced QCV limits are documented in the [design note](./planning/query_backed_context.md). Run `pixroom help` for CLI options and `pixroom doctor` to inspect the local runtime.

## Integrations

Pixroom owns the proxy, QCV, protocol adapters, transactional request planning, and savings reports. Its public integration kernel also lets specialized optimizers propose changes without taking over the product's routing or safety policy.

Two standalone examples live in [`examples/integrations`](./examples/integrations/README.md): a non-compression secret-redaction policy and a deterministic JSON tool-output minifier. They import only public package exports and run with built-ins disabled.

The default distribution includes [pxpipe](https://github.com/teamchong/pxpipe) for in-process optical compression and [Headroom](https://github.com/headroomlabs-ai/headroom) for optional semantic compression through a local sidecar. Install the optional sidecar with:

```bash
pip install headroom-ai
pixroom doctor
```

If the sidecar is unavailable, semantic optimization becomes a no-op while QCV and other available paths continue. Configure an existing sidecar with `PIXROOM_HEADROOM_URL`, or disable auto-start with `PIXROOM_HEADROOM_AUTOSPAWN=0`. See [UPSTREAM.md](./UPSTREAM.md) for versioning and attribution.

## Develop

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

**Experimental optimizer runtime.** The transactional kernel, cross-provider exact QCV, streaming-safe exact prefetch, server-side CCR continuation, durable capture/replay, OTLP export, normalized output events, agent registry, and external integration examples are implemented. Remaining proof gates are lower saturated two-hop latency, repeated live-model non-inferiority, sanitized production trace replay, and independent external adoption. The candid standalone-product decision is in [the product assessment](./planning/product_assessment.md).

## License

**Apache-2.0.** Third-party attribution is listed in [`NOTICE`](./NOTICE).

Contributions are welcome under [`CONTRIBUTING.md`](./CONTRIBUTING.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

