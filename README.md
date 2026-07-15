<div align="center"><pre>
██████╗ ██╗███╗   ██╗██████╗  ██████╗ ██╗███╗   ██╗████████╗
██╔══██╗██║████╗  ██║██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝
██████╔╝██║██╔██╗ ██║██████╔╝██║   ██║██║██╔██╗ ██║   ██║
██╔═══╝ ██║██║╚██╗██║██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║
██║     ██║██║ ╚████║██║     ╚██████╔╝██║██║ ╚████║   ██║
╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝
                  The exact context layer for AI agents
</pre></div>

<p align="center"><strong>Your agent already read it. Stop paying the model to read it again.</strong></p>

<p align="center"><strong>On matching structured tool output: 97.2% fewer input tokens and 96.8% lower modeled cost than Headroom · 150/150 exact</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg">
  <a href="./benchmarks/results/evidence-gate.first-party-macos-arm64-20260715.json"><img alt="live evidence: 150/150 exact" src="https://img.shields.io/badge/live%20evidence-150%2F150%20exact-2ea44f.svg"></a>
  <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
  <a href="https://codepal.ai"><img alt="Built by CodePal" src="https://img.shields.io/badge/built%20by-CodePal-2563eb.svg"></a>
</p>

<p align="center">
  <a href="#get-started-60-seconds">Start</a> ·
  <a href="#choose-your-path">Use it</a> ·
  <a href="#proof">Proof</a> ·
  <a href="#works-with-your-stack">Agents</a> ·
  <a href="#safety-and-privacy">Safety</a> ·
  <a href="./benchmarks/REPORT.md">Benchmarks</a> ·
  <a href="https://github.com/CodePalAI/pinpoint/discussions">Community</a>
</p>

<p align="center"><sub>Local-first | Same model and provider | Anthropic + OpenAI | Exact when supported, unchanged when not</sub></p>

<p align="center"><sub><strong>AI agents / LLMs:</strong> read <a href="./llms.txt"><code>/llms.txt</code></a> for the compact project index.</sub></p>

---

Pinpoint keeps bulky old JSON, logs, and source output on your machine. When your agent needs one row, count, symbol, or unique-key join, Pinpoint sends that exact result instead of resending the whole payload. If it cannot answer safely or make the request smaller, it forwards the original request unchanged.

<p align="center">
  <a href="./benchmarks/results/evidence-gate.first-party-macos-arm64-20260715.json">
    <img src="./assets/qcv-evidence-gate.svg" alt="Repeated live gate: Pinpoint QCV answered 150 of 150 independently parameterized structured-task variants exactly across two models and three protocols, with modeled provider cost 96.8% lower than Headroom" width="920">
       </a>
</p>

<p align="center"><sub>Repeated controlled evidence: 30 templates, 150 unique fixture variants, zero QCV regressions, exact one-sided 95% harm bound 1.98%. Synthetic structured tasks, not a universal traffic claim.</sub></p>

<!-- LAUNCH(demo-video): Put a 15-25 second terminal recording here after independent replication. Keep the generated receipt card above as the static fallback. -->

## Get started (60 seconds)

You need Node.js 22 or newer and Git. Until the first npm package is live, build the CLI from a checkout:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint
npm install && npm link

pinpoint demo            # prove the exact path offline
pinpoint wrap claude     # launch Claude Code through Pinpoint
pinpoint proxy           # or use it as an Anthropic/OpenAI proxy
```

<!-- LAUNCH(npm): Replace the checkout flow above with `npx @codepal/pinpoint demo` and `npm install -g @codepal/pinpoint` only after the registry confirms the package. -->

Start with `pinpoint demo`. It runs the production exact-data path against 1,000 JSON rows without an API key, model call, sidecar, or network request:

```console
$ pinpoint demo

pinpoint QCV demo (offline)
dataset: 1,000 exact JSON rows (55,281 chars)
question: What is the email for id 733?
dataset region: 13,821 -> 172 estimated tokens (98.8% smaller)
exact answer materialized: user733@example.com
model-driven fallback: not needed
network requests: 0
```

## Why exact context wins

Your agent loaded 1,000 account rows earlier in the conversation. Now you ask:

> What is the email for account ID 733?

| Without Pinpoint | With Pinpoint |
|---|---|
| Send all 1,000 rows to the provider again | Keep the rows in bounded local memory |
| Make the model search the pile | Look up ID 733 exactly on your machine |
| Spend 13,821 estimated tokens on the dataset region | Send a 172-token reference plus the exact result |
| Hope the model copies the right value | Materialize `user733@example.com` deterministically |

Pinpoint does not change your model or replace your provider. It removes repeated input before the request leaves your machine, and only when it can do so under an explicit rule.

## What it does

- **Exact local context.** Resolve supported JSON lookups, filtered counts, log counts, source exports, projections, and unique-key joins before the request leaves your machine.
- **Drop-in adoption.** Wrap a coding CLI, wrap the official Anthropic/OpenAI SDK, or change one base URL. Keep the same model, provider, streaming behavior, and response types.
- **More usable context.** Stop spending the model's window and your provider budget on an old 10,000-line result when the current question needs one value.
- **Safe composition.** Headroom and pxpipe can optimize other request regions, while Pinpoint prevents two optimizers from rewriting the same bytes.
- **Fail-safe routing.** Short, recent, ambiguous, unsafe, unsupported, or unprofitable requests pass through unchanged.

Pinpoint helps on requests that actually contain reusable bulk context. Ordinary chat and small prompts may not change at all.

## Works with your stack

| Client or protocol | Start with | Exact path on API-key traffic | Subscription / OAuth |
|---|---|:---:|---|
| Claude Code | `pinpoint wrap claude` | Yes | Safe pass-through |
| Codex CLI | `pinpoint wrap codex` | Yes when tool output meets the exact-data rules | Safe pass-through |
| Anthropic SDK / Messages | `@codepal/pinpoint/anthropic` or proxy | Yes | Safe pass-through |
| OpenAI SDK / Chat / Responses | `@codepal/pinpoint/openai` or proxy | Yes | Safe pass-through |
| Aider, OpenCode, Goose, OpenHands, Vibe | `pinpoint wrap <agent>` | Protocol-dependent | Safe pass-through |
| GitHub Copilot CLI | `pinpoint doctor copilot` | Delegated to Headroom | Headroom subscription path |
| Cursor, Cline, Continue | `pinpoint wrap <agent>` | Pinpoint prints the local base URL | Depends on configured auth |

## Choose your path

No new provider account. No model migration. Pick the integration surface you already use:

| You use an LLM through... | Start here | What stays unchanged |
|---|---|---|
| A coding CLI | `pinpoint wrap <agent>` | The CLI, model, login, and provider |
| Anthropic or OpenAI TypeScript SDK | `withPinpoint(client)` | Native client methods, return types, streams, retries |
| Any other language or HTTP client | `pinpoint proxy` | Your client and provider protocol |
| Nothing yet; you just want proof | `pinpoint demo` | No key, model call, sidecar, or network needed |

### Coding CLI: the main path

Run your usual agent through Pinpoint:

```bash
pinpoint agent list

pinpoint wrap claude      # Claude Code
pinpoint wrap codex       # Codex CLI
pinpoint wrap opencode    # OpenCode
pinpoint wrap aider       # Aider
```

Pinpoint changes only the launched process environment. It does not rewrite the agent's config, and a future plain launch bypasses Pinpoint.

**What optimization applies depends on how that CLI authenticates:**

| CLI traffic | Exact local JSON/log/source path | What to expect |
|---|:---:|---|
| Provider API key | **On** | Supported old tool results can become exact local answers instead of full repeated payloads |
| Subscription or OAuth | Off | Conservative pass-through posture; optional Headroom text compression may still run if installed |
| GitHub Copilot CLI | Delegated | `pinpoint doctor copilot`, then `pinpoint wrap copilot`; compression is handled by the optional Headroom integration |
| Cursor, Cline, Continue | Config printed | `pinpoint wrap <agent>` prints the local base URL; keep the proxy running while the editor uses it |

> **About the 96.8% result:** it came from provider API-key traffic containing large eligible structured tool output. It is not a promise for subscription/OAuth CLI sessions, ordinary chat, or traffic that does not match an exact rule.

Pinpoint checks every request, applies only a matching safe rule, and forwards everything else unchanged. Automatic routing is not forced compression.

### TypeScript SDK: native client in, native response out

Until Pinpoint is on npm, build a checkout and install that local directory in your app:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint && npm install && npm run build
cd /path/to/your-app && npm install /path/to/pinpoint
```

<!-- LAUNCH(npm): Replace the checkout flow above with `npm install @codepal/pinpoint` after registry verification. -->

Pinpoint is ESM-only. TypeScript projects should use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`; JavaScript projects should set `"type": "module"` or use `.mjs` files. Requests made with your provider API key can use the exact-data path.

Wrap an Anthropic client:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { withPinpoint } from '@codepal/pinpoint/anthropic';

const anthropic = await withPinpoint(new Anthropic());

try {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Find the failed account in this tool output...' }],
  });

  console.log(message.content);
  console.log(anthropic.pinpoint.stats());
} finally {
  await anthropic.pinpoint.close();
}
```

Or wrap an OpenAI client. Both Chat Completions and Responses use Pinpoint:

```ts
import OpenAI from 'openai';
import { withPinpoint } from '@codepal/pinpoint/openai';

const openai = await withPinpoint(new OpenAI());

try {
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: 'Find the failed account in this tool output...',
  });

  console.log(response.output_text);
  console.log(openai.pinpoint.stats());
} finally {
  await openai.pinpoint.close();
}
```

`withPinpoint()` starts an ephemeral loopback proxy and points that client at it. The official SDK still owns response parsing and streaming, so its native return types and stream APIs stay intact. `close()` stops Pinpoint and restores the client's original `baseURL`. Provider keys remain configured on the original client and are never written to disk.

### Any language or HTTP client: change the base URL

Start Pinpoint:

```bash
pinpoint proxy
```

Then point your existing client at it:

```bash
# Anthropic-compatible clients
ANTHROPIC_BASE_URL=http://127.0.0.1:8788 your-command

# OpenAI-compatible clients
OPENAI_BASE_URL=http://127.0.0.1:8788/v1 your-command
```

Keep your normal provider key configured in the client. Pinpoint forwards it to the same provider and does not write it to disk. Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses are supported.

## What Pinpoint can optimize

Pinpoint targets repeated **tool results**: data your agent already received from a file read, shell command, search, database, or API call. **Older** means it is already in conversation history rather than the current turn.

By default, the exact-data path considers older tool results between 6,000 and 2,000,000 characters. Within that range:

| You ask next... | Pinpoint does locally | The provider receives |
|---|---|---|
| "What is the email for ID 73?" | Exact JSON lookup | The matching value, not the whole array |
| "How many records have `active: true`?" | Exact filtered count | The exact number |
| "Which customer owns order 981?" | One-hop unique-key join across two JSON results | The bounded joined projection |
| "How many ERROR lines are there?" | Boundary-aware log count | The exact count |
| "Which classes are exported?" | Source export scan | The matching `export class` lines |
| A range, negation, duplicate key, competing dataset, or unclear question | Refuse to guess | The original tool result, unchanged |

Pinpoint intentionally leaves short prompts, normal chat, recent turns, images, unsupported content, and unsafe or ambiguous operations alone. Subscription/OAuth traffic keeps the exact-data path off. Optional compression integrations may still reduce other, non-overlapping request regions.

Optional compression modules can reduce other parts of a request, but Pinpoint never applies two transformations to the same bytes.

Every request gets an honest savings report, including negative savings and extra provider rounds used for local retrieval.

The safe exact-data path is already on. Most users do not need to configure it.

<details>
<summary><strong>How this differs from summarization, prompt caching, and compaction</strong></summary>

<br>

Summaries are useful when the model needs the gist. They are a poor primitive for exact IDs, counts, paths, and rows. Pinpoint's exact path retains the original locally and computes only supported deterministic operations.

| Technique | Primary job | Relationship to Pinpoint |
|---|---|---|
| Provider prompt caching | Discounts repeated byte-identical prefixes | Pinpoint keeps stable dataset references across supported exact turns so caching can still help |
| Provider compaction | Shortens provider-managed conversation history | Pinpoint acts before the request on intercepted tool results |
| Text or image compression | Reduces general prose, code, or static context | Optional [Headroom](https://github.com/headroomlabs-ai/headroom) and [pxpipe](https://github.com/teamchong/pxpipe) integrations handle regions the exact path does not own |
| Pinpoint exact path | Materializes a supported answer from local old tool data | Keeps exact bytes local and passes through questions it cannot answer safely |

Pinpoint composes with these techniques; it does not claim to replace them.

</details>

## How it works

A raw agent request can resend thousands of lines of JSON, logs, source code, tool definitions, and old conversation history. The model often needs only a small part of that material for the current turn.

Pinpoint sits between the client and the provider:

1. It separates the system prompt, tool definitions, old tool results, and recent conversation turns.
2. For large old JSON, logs, or source output, the exact-data path stores the original locally and computes supported lookups or counts. Its internal name is Query-Backed Context Virtualization (QCV).
3. Installed compression modules can reduce other parts of the request. Pinpoint prevents two modules from changing the same bytes.
4. Pinpoint validates each change before forwarding the request to the same provider. If one change fails, Pinpoint leaves that part alone.

```
agent or app
       |
       | raw Anthropic or OpenAI request
       v
Pinpoint on 127.0.0.1
       |  exact local datasets
       |  selected context optimizations
       |  validated request + savings report
       v
same LLM provider
```

Provider credentials pass through to the configured upstream. Pinpoint does not send them to local compression services. Provider responses keep their original format. A local retrieval may require one extra provider request, and Pinpoint includes those tokens in its savings report.

### Exact answers instead of summaries

Suppose an agent loaded 50,000 characters of account data and now asks for one email address.

Without Pinpoint, the provider reads the full dataset again. With Pinpoint, the provider receives a small dataset reference plus the exact matching email. The original bytes stay in bounded local memory. Pinpoint does not summarize the data or ask the model to guess which row matters.

<details>
<summary><strong>When exact optimization applies</strong></summary>

Pinpoint changes a request only when all of these checks pass:

1. The request uses Anthropic Messages, OpenAI Chat, or OpenAI Responses with a provider API key.
2. One older tool result meets the size and content rules and matches one explicit lookup or supported count.
3. The local operation returns one complete, bounded, unambiguous result.
4. The dataset reference plus exact result is smaller than the original tool output.
5. The data fits the configured request and memory limits.

Repeated selectors, ranges, negation, multiple matching datasets, malformed values, and subscription traffic pass through unchanged. Exact prefetch works with streaming responses.

</details>

An experimental model-planned fallback exists for harder Anthropic questions, but it is off by default because an earlier version saved tokens while reducing task quality. Disable the exact-data path with `PINPOINT_VIRTUAL_CONTEXT=0` or `pinpoint proxy --no-qcv`. The [technical design note](./planning/query_backed_context.md) documents every boundary and the rejected design.

## Advanced workflows

Most users only need `pinpoint wrap <agent>` or `pinpoint proxy`. The commands below are for evaluation and integration work.

<details>
<summary><strong>Show capture, telemetry, library, and MCP workflows</strong></summary>

<br>

### Preview changes without applying them

```bash
pinpoint proxy --mode shadow --port 8788
```

### Capture and replay your own traffic

Capture bodies only on a trusted machine. Pinpoint records metadata by default and includes prompts only when you explicitly enable them:

```bash
PINPOINT_CAPTURE_PATH=.pinpoint/capture.jsonl PINPOINT_CAPTURE_BODIES=1 pinpoint proxy
pinpoint replay .pinpoint/capture.jsonl
```

Replay runs the captured requests through the current Pinpoint rules without calling a provider.

### Export telemetry

Send content-free optimization events to an OpenTelemetry-compatible OTLP/HTTP collector:

```bash
PINPOINT_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pinpoint proxy
```

### Transform request bodies directly

```ts
import { createPinpoint } from '@codepal/pinpoint';

const pinpoint = createPinpoint();
const { body, report } = await pinpoint.route(
  'anthropic',
  'claude-haiku-4-5',
  anthropicRequestBody,
);

console.log(body);
console.log(report.tokensSavedTotal, report.savedFraction);
await pinpoint.shutdown();
```

Other useful commands:

```bash
pinpoint stats               # savings from a running proxy
pinpoint export README.md    # offline transform report
pinpoint integration list    # installed compression and policy modules
pinpoint mcp                 # MCP tools over stdio
```

Provider wrappers are exported from `@codepal/pinpoint/anthropic` and `@codepal/pinpoint/openai`. Other public subpaths expose the integration kernel, protocols, normalized output events, agent adapters, virtual-context APIs, capture/replay, and OTLP telemetry.

</details>

## Proof

CodePal publishes Pinpoint's raw benchmark artifacts, negative results, and safety checks so people can inspect the claims rather than trust a headline.

### Repeated multi-provider evidence gate

The current primary receipt covers 30 synthetic task templates with five independently parameterized variants each. Every one of the 150 paired observations has a distinct payload, expected answer, task ID, and fixture hash. Each runs three randomized arms: raw provider input, Headroom-only semantic compression, and Pinpoint QCV. The gate used Claude Haiku 4.5 through Anthropic Messages and GPT-4.1 mini through both OpenAI Chat Completions and Responses.

| Arm | Exact score | Provider input | Modeled provider cost |
|---|---:|---:|---:|
| Raw | 109/150 | 1,899,030 | $1.198998 |
| Headroom | 112/150 | 1,713,184 | $1.062131 |
| **Pinpoint QCV** | **150/150** | **48,439** | **$0.034462** |

Against Headroom, QCV used 97.2% fewer input tokens and 96.8% lower modeled provider cost. The paired-bootstrap 95% cost-reduction interval was 96.5%-96.9%. There were zero paired regressions and 38 improvements; the exact one-sided 95% upper bound on harm was 1.98%, below the predeclared two-point non-inferiority margin. That inferential bound treats the 150 fixed, independently parameterized variants as exchangeable benchmark units; it is not a confidence bound for organic traffic.

The run made 450 paid calls with no harness retries and observed $2.295591 in provider spend. Inspect the [full repeated receipt](./benchmarks/results/evidence-gate.first-party-macos-arm64-20260715.json).

### Real-agent capture and replay gate

Five real Claude Code sessions and five real Codex CLI sessions ran in disposable synthetic repositories through the production proxy. The grader parsed only Claude's final `result` or Codex's last `agent_message`; all 10 returned the single correct email value. All 10 minimized sanitized traces replayed hash-identically, stable cache shape was observed, four long/join sessions completed, and both injected provider POST failures were retried by the agents.

Claude Code exercised QCV on line-numbered `Read` output. Codex queried sub-6,000-character chunks locally, so Pinpoint correctly left those requests unchanged. The source captures, agent outputs, credentials, and personal paths were deleted; only reviewed synthetic derivatives remain. Inspect the [agent receipt](./benchmarks/results/agent-trace-gate.first-party-macos-arm64-20260715.json) and [sanitized traces](./benchmarks/traces/agent-gate/).

These are first-party real-agent sessions over synthetic data, not customer production traces. Copilot subscription traffic delegates to Headroom and is outside QCV scope.

### Historical paid exact-context pilot

The earlier pilot used two fixed Haiku 4.5 tasks sent directly to Anthropic and through Pinpoint:

- Provider-reported input fell from **22,614 to 594 tokens**.
- Modeled cost fell from **$0.022684 to $0.000664**.
- Exact score improved from **1/2 to 2/2**.

On the log task, the raw model answered `5` for a fixture containing seven errors. Pinpoint counted the exact local lines and returned `7`. See the [raw paid result](./benchmarks/results/direct-anthropic-virtual.json).

A separate three-task pilot tested the optional general compression path. Input fell from 24,249 to 14,478 tokens with the same 2/3 exact score. That result validates the integration path rather than Pinpoint's exact-context algorithm.

Those pilots remain useful negative and design-history evidence, but the repeated gate above supersedes them as the primary quality result.

Run the offline checks or repeat either paid gate from a clean machine using the [benchmark reproduction guide](./benchmarks/REPRODUCING.md). Labeled replication runs write separate receipts instead of replacing the committed artifacts.

### Broader offline token accounting

The offline corpus runs real Pinpoint transforms over agent-shaped requests and compares the resulting input with the original raw request:

| Workload | Raw input | Pinpoint input | Input saved |
|---|---:|---:|---:|
| JSON tool output + static context | 18,662 | 9,184 | **50.8%** |
| Build log + static context | 18,309 | 10,063 | **45.0%** |
| Source output + static context | 12,049 | 5,846 | **51.5%** |
| **Total** | **49,020** | **25,093** | **48.8%** |

This offline result validates transformation and token accounting, not model quality. The repeated live gate above measures model quality on its committed synthetic task family. Cache behavior, model choice, and how often organic requests match the exact rules can change the net saving.

The broader exact-data test suite runs 42 deterministic tasks across JSON lookup, filtered counts, logs, source exports, tabular JSON, nested projections, and one-hop unique-key joins. It produced 42/42 exact materializations, replaced the large old tool output in 42/42 cases, and never exposed model-planned retrieval. The measured tool-output regions fell from 144,272 to 7,583 estimated tokens. It also refused 20/20 ambiguous, competing-dataset, unsafe-join, and lossy-number controls. This is offline operation coverage, not live-model quality evidence.

The full [benchmark report](./benchmarks/REPORT.md) keeps live, offline, agentic, and simulated evidence separate. It also preserves failed experiments instead of averaging them into successful results.

## Safety and privacy

- Pinpoint binds to `127.0.0.1` by default. It has no public login or access-control layer, so do not expose it directly to the internet.
- Provider credentials are forwarded to the configured provider and are not stored by Pinpoint.
- QCV stores replaced tool results in process memory with a default cap of 256 datasets or 64 MiB and least-recently-used eviction.
- Reversible compression handles are separately limited to 1,000 entries or 64 MiB, expire after 30 minutes, and are cleared at shutdown. A request is left unchanged if its own reversible batch cannot fit.
- A Headroom process started by Pinpoint is forced to loopback, one worker, stateless mode, and in-memory CCR; provider credential variables are not inherited. A custom `PINPOINT_HEADROOM_URL` follows that external service's network and retention policy and receives the selected content sent for compression.
- Audit and shadow modes preview changes without storing exact datasets or changing requests.
- Failed changes, unavailable modules, unsupported traffic, and unsafe questions leave the affected content unchanged.
- The experimental model-planned fallback is disabled by default and has a separate switch.
- Local retrieval calls run inside the proxy only when every tool call in the response belongs to Pinpoint. Mixed tool ownership replays the original request.
- Durable capture is off by default and records metadata only unless `PINPOINT_CAPTURE_BODIES=1` is explicitly set. Body-enabled files contain private prompts and are readable only by your operating-system user (file mode `0600`).
- OpenTelemetry events never include request or response content.

See the [security policy](./SECURITY.md) before exposing the proxy outside a trusted machine or network.

## Configuration (optional)

The defaults are designed for local use. These are the controls most people need:

| You want to | Set |
|---|---|
| Change the proxy port | `PINPOINT_PORT=9000` |
| Preview without changing requests | `PINPOINT_MODE=shadow` |
| Turn off the exact-data path | `PINPOINT_VIRTUAL_CONTEXT=0` |
| Reduce logs | `PINPOINT_LOG=warn` |

<details>
<summary><strong>All environment variables</strong></summary>

<br>

| Env | Purpose | Default |
|---|---|---|
| `PINPOINT_HOST` / `PINPOINT_PORT` | listen interface / port | `127.0.0.1` / `8788` |
| `PINPOINT_MAX_INSPECTION_BYTES` | maximum request bytes buffered for optimization; larger requests stream unchanged | `33554432` |
| `PINPOINT_MODE` | `audit` (no processors), `shadow` (propose only), `optimize` (commit), `enforce` (reserved output policy) | `optimize` |
| `PINPOINT_VIRTUAL_CONTEXT` | exact-data path; set `0` to turn it off | `on` |
| `PINPOINT_VIRTUAL_QUERY_FALLBACK` | model-planned retrieval for harder Anthropic questions (experimental) | `off` |
| `PINPOINT_VIRTUAL_MIN_CHARS` / `PINPOINT_VIRTUAL_MAX_CHARS` | old tool-output size range | `6000` / `2000000` |
| `PINPOINT_VIRTUAL_MAX_ENTRIES` / `PINPOINT_VIRTUAL_MAX_STORED_BYTES` | in-process exact-store limits | `256` / `67108864` |
| `PINPOINT_VIRTUAL_MAX_DATASETS_PER_REQUEST` | maximum datasets virtualized in one request | `8` |
| `PINPOINT_VIRTUAL_MAX_QUERY_ROUNDS` | hidden query fallback round cap | `4` |
| `PINPOINT_CCR_CONTINUATION` | execute pure local retrieval calls inside the proxy | `on` |
| `PINPOINT_CCR_MAX_CONTINUATION_ROUNDS` | maximum extra provider rounds for local retrieval | `3` |
| `PINPOINT_CCR_MAX_ENTRIES` / `PINPOINT_CCR_MAX_STORED_BYTES` | in-process reversible handle limits | `1000` / `67108864` |
| `PINPOINT_CCR_TTL_MS` | reversible handle retention time | `1800000` |
| `PINPOINT_HEADROOM_REQUEST_TIMEOUT_MS` | local compression/retrieval request timeout | `60000` |
| `PINPOINT_CAPTURE_PATH` | fsynced JSONL optimization capture | unset |
| `PINPOINT_CAPTURE_BODIES` | include sensitive bodies required for replay | `off` |
| `PINPOINT_CAPTURE_MAX_BYTES` / `PINPOINT_CAPTURE_MAX_FILES` | bounded JSONL rotation | `268435456` / `3` |
| `PINPOINT_OTLP_ENDPOINT` | OpenTelemetry OTLP/HTTP endpoint | unset |
| `PINPOINT_OTLP_HEADERS` | collector headers as comma-separated `key=value` pairs | unset |
| `PINPOINT_OPTICAL` / `PINPOINT_SEMANTIC` | image-based and text-based compression switches | `on` |
| `PINPOINT_MODELS` | models allowed to use image-based compression; `off` disables it | `claude-fable-5` |
| `PINPOINT_SEMANTIC_PROSE` | text-compress large prose from older user turns | `off` |
| `PINPOINT_OPTICAL_ON_SUBSCRIPTION` | allow lossy image-based compression on subscription traffic | `off` |
| `PINPOINT_LOG` | `silent`\|`error`\|`warn`\|`info`\|`debug` | `info` |

</details>

Advanced exact-data limits are documented in the [design note](./planning/query_backed_context.md). Run `pinpoint help` for CLI options and `pinpoint doctor` to inspect the local runtime.

## Integrations

You can use Pinpoint's exact-context path and demo with Node.js alone. Python is not required.

Pinpoint owns the proxy, exact-data path, provider adapters, safe change planning, and savings reports. Its public integration API also lets compression and policy modules propose changes without taking over routing or safety rules.

Two standalone examples live in [`examples/integrations`](./examples/integrations/README.md): a non-compression secret-redaction policy and a deterministic JSON tool-output minifier. They import only public package exports and run with built-ins disabled.

The package includes [pxpipe](https://github.com/teamchong/pxpipe) for supported image-based compression inside the Pinpoint process. [Headroom](https://github.com/headroomlabs-ai/headroom) adds optional text-aware compression through a small local background process:

```bash
pip install headroom-ai
pinpoint doctor
```

If that background process is unavailable, its stage does nothing while the exact-data path and other available modules continue. Configure an existing process with `PINPOINT_HEADROOM_URL`, or disable auto-start with `PINPOINT_HEADROOM_AUTOSPAWN=0`. Only use an external sidecar you trust with the selected tool output and prose sent for compression. See [UPSTREAM.md](./UPSTREAM.md) for versioning and attribution.

## Built at CodePal

Pinpoint open-sources one part of the context-optimization system developed at [CodePal](https://codepal.ai). It is the exact-context runtime and evidence harness, not CodePal's complete product, model stack, or infrastructure.

CodePal builds AI development tools for moving from an idea to production software. Visit [codepal.ai](https://codepal.ai) for the full product.

## Contributing

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md). The main local checks are:

```bash
npm run typecheck
npm test                        # offline test suite
node benchmarks/proof.mjs       # constructed additivity check
node benchmarks/rd_frontier.mjs # simulated RD surface
node benchmarks/adaptive.mjs    # controller simulation
npm run bench:virtual           # QCV vs current full stack, no provider calls
npm run bench:qcv-quality       # 42 exact tasks + 20 refusal controls, no provider calls
npm run bench:profile           # paired direct-vs-proxy local profile + raw samples
npm run bench:profile:isolated  # separate load, proxy, and upstream processes
```

Questions, integration ideas, independent benchmark runs, and sanitized field reports belong in [GitHub Discussions](https://github.com/CodePalAI/pinpoint/discussions). Reproducible defects and optimizer proposals use the structured [issue forms](https://github.com/CodePalAI/pinpoint/issues/new/choose).

## Status

Pinpoint is experimental but usable today for local evaluation and API-key traffic.

Pinpoint is developed and maintained by [CodePal](https://codepal.ai) with contributions from the open-source community.

- **Validated first-party:** 150 independently parameterized live task variants across two models and three protocols, plus 10 real Claude Code/Codex sessions with retries, cache shape, long turns, and hash-matched replay.
- **Still being proved:** independent replication, the eligible share of organic traffic, external adoption, customer demand, and lower proxy overhead under heavy concurrency.

The [product assessment](./planning/product_assessment.md) explains the evidence and current limits without marketing shortcuts.

## License

**Apache-2.0.** Third-party attribution is listed in [`NOTICE`](./NOTICE).

Pinpoint is an open-source CodePal project. Contributions are welcome under [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

