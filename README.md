<div align="center"><pre>
██████╗ ██╗███╗   ██╗██████╗  ██████╗ ██╗███╗   ██╗████████╗
██╔══██╗██║████╗  ██║██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝
██████╔╝██║██╔██╗ ██║██████╔╝██║   ██║██║██╔██╗ ██║   ██║
██╔═══╝ ██║██║╚██╗██║██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║
██║     ██║██║ ╚████║██║     ╚██████╔╝██║██║ ╚████║   ██║
╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝
                 The value-opaque MCP dataflow firewall for AI agents
</pre></div>

<p align="center"><strong>Move exact data between MCP tools without putting the values in model context.</strong></p>

<p align="center">Wrap an unmodified stdio MCP server. Pinpoint can keep large exact results queryable, or pass an allowlisted projection into a hidden destination tool and return only a signed receipt.</p>

<p align="center"><strong>Real cross-host gate: Claude Code + GitHub Copilot CLI both completed the same hidden 40-record destination flow with zero fixture values in either client event stream</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg">
  <a href="./benchmarks/results/mcp-gateway-cross-host.first-party-macos-arm64-20260715.json"><img alt="real cross-host MCP gate: 2 of 2 exact" src="https://img.shields.io/badge/cross--host%20MCP%20gate-2%2F2%20exact-2ea44f.svg"></a>
  <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
  <a href="https://codepal.ai"><img alt="Built by CodePal" src="https://img.shields.io/badge/built%20by-CodePal-2563eb.svg"></a>
</p>

<p align="center">
  <a href="#get-started-60-seconds">Start</a> ·
  <a href="#value-opaque-flows">Opaque flows</a> ·
  <a href="#mcp-gateway-the-main-path">Gateway</a> ·
  <a href="#how-it-works">How</a> ·
  <a href="#proof">Proof</a> ·
  <a href="#what-passes-through">Limits</a> ·
  <a href="#safety-and-privacy">Safety</a> ·
  <a href="./benchmarks/REPORT.md">Benchmarks</a> ·
  <a href="https://github.com/CodePalAI/pinpoint/discussions">Community</a>
</p>

<p align="center"><sub>The lossless MCP result firewall for AI agents | Local-first | Provider-independent | Subscription-compatible</sub></p>

<p align="center"><sub><strong>AI agents / LLMs:</strong> read <a href="./llms.txt"><code>/llms.txt</code></a> for the compact project index.</sub></p>

---

## What changes at the tool boundary

| Upstream MCP result | Without Pinpoint | With Pinpoint |
|---|---|---|
| 1,000 JSON records | The host inserts every row into conversation history | A content-addressed `pinpoint://artifact/...` link and schema |
| A large log or source dump | The host truncates it or spends context on it | A local exact artifact with bounded `grep`, `count`, and `slice` |
| Wrapped data under `data.results` or `data.items` | The wrapper and every nested row enter context | Pinpoint finds the only unambiguous record collection and keeps the complete wrapper locally |
| One tool's values must become another tool's input | The model or generated code copies the values between calls | A predeclared `pinpoint_flow` projects locally, calls the hidden destination, and returns a signed commitment-only receipt |
| Small, error, media, mixed, ambiguous, or unprofitable output | The original result | The original result, byte-equivalent |

The gateway runs between the MCP host and server, before Claude Code, Codex, Copilot, Cursor, or another host can truncate or persist the result. It does not need a provider API key and does not depend on the model API protocol.

> **Evidence boundary:** two installed clients passed the same first-party synthetic task with an intentionally unfilterable MCP tool. This proves cross-host gateway compatibility and autonomous follow-up querying for one exact task. It does not estimate how common oversized MCP results are.

<!-- LAUNCH(demo-video): Put a 15-25 second terminal recording here after independent replication. Keep the generated receipt card above as the static fallback. -->

## Get started (60 seconds)

You need Node.js 22 or newer and Git. Until the first npm package is live, build the CLI from a checkout:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint
npm install && npm link

pinpoint mcp gateway -- npx -y <your-mcp-server-package>
```

<!-- LAUNCH(npm): Replace the checkout flow above with `npx @codepal/pinpoint demo` and `npm install -g @codepal/pinpoint` only after the registry confirms the package. -->

Put that command where your host currently starts the upstream server. For example, a Claude-compatible `.mcp.json` entry is:

```json
{
  "mcpServers": {
    "protected-api": {
      "command": "pinpoint",
      "args": ["mcp", "gateway", "--", "npx", "-y", "<your-mcp-server-package>"]
    }
  }
}
```

The upstream command is spawned directly, without a shell. Its normal tools remain visible under the same names. Pinpoint adds one tool, `pinpoint_query`, and a bounded MCP resource surface.

## What it does

- **Intercept upstream.** Capture the complete MCP result before host caps, truncation, conversation storage, or provider billing.
- **Retain exact data.** Store content in bounded local memory under a SHA-256-derived artifact id. Capacity is reserved atomically; no dead handle is emitted.
- **Reveal only what is needed.** Expose deterministic `schema`, `json_select`, `count`, `grep`, `slice`, and unique-key `json_join` operations with bounded outputs.
- **Stay protocol-native.** Preserve upstream tool names and input schemas, union structured output schemas with the artifact envelope, and expose `resource_link` plus `resources/read` previews.
- **Fail open.** Leave errors, media, mixed blocks, small results, ambiguous wrappers, unsupported data, and unprofitable transformations unchanged.

The existing Anthropic/OpenAI proxy and SDK path still supports provider-wire QCV and optional Headroom/pxpipe composition. It is now a secondary path, not the main product claim.

## Value-opaque flows

An operator can predeclare one exact path from a source tool to a destination tool:

```bash
pinpoint mcp gateway \
  --flow-config ./flow-policy.json \
  -- npx -y <your-mcp-server-package>
```

The policy names the source, destination, destination argument, allowed operations,
filter fields, projection fields, fixed or dynamic destination arguments, and byte/item
limits. See the [complete example](./examples/mcp-opaque-flow.json).

With a flow policy loaded, Pinpoint defaults to strict mode:

1. configured source results are captured at every size, even when normal virtualization would be unprofitable;
2. source capture fails closed instead of returning values when exact retention is impossible;
3. the model receives a random process-local capability, not a content hash;
4. `pinpoint_query`, artifact resources, previews, and direct destination calls are unavailable;
5. `pinpoint_flow` accepts only the configured operation, fields, filters, limits, and non-payload arguments;
6. Pinpoint calls the unmodified destination tool internally and suppresses its result values;
7. the model receives one Ed25519-signed, hash-chained receipt with HMAC commitments, counts, field names, limits, and success status, but no source or destination values.

The session verification key is pinned in the MCP `initialize` response. SDK users can call `verifyMcpOpaqueFlowReceipt()` to verify a receipt. This is value-opaque composition, not a claim of zero information leakage: tool names, field names, counts, byte sizes, timing, and success remain observable.

Anthropic and Cloudflare already demonstrated privacy-preserving MCP composition through generated code and sandboxing; Microsoft Fides established agent information-flow control. Pinpoint's narrower candidate contribution is declarative composition between unmodified tools through a host-independent gateway, without generated code or a sandbox, plus signed disclosure-bounded receipts. The [technical claim and prior-art analysis](./planning/value_opaque_mcp_dataflow.md) states the boundary in detail.

## Works with your stack

| Surface | Put Pinpoint here | Provider login requirement | Current evidence |
|---|---|---|---|
| Any stdio MCP host | `pinpoint mcp gateway -- <server> [args...]` | None; the host keeps its existing login | Protocol integration tests |
| Claude Code MCP | Wrap the configured server command | API key or subscription | Real synthetic agent gate passed |
| GitHub Copilot CLI | Wrap the configured server command | Existing Copilot login | Real synthetic agent gate passed; zero premium requests |
| VS Code, Codex, Cursor, other MCP hosts | Wrap the configured server command | Whatever the host already uses | Protocol-compatible; real-host replication open |
| Anthropic SDK / Messages | `@codepal/pinpoint/anthropic` or provider proxy | Provider API key for wire QCV | Repeated controlled QCV gate |
| OpenAI SDK / Chat / Responses | `@codepal/pinpoint/openai` or provider proxy | Provider API key for wire QCV | Repeated controlled QCV gate |

## Choose your path

No new provider account. No model migration. Pick the integration surface you already use:

| Your large data enters through... | Start here | What stays unchanged |
|---|---|---|
| An MCP server | `pinpoint mcp gateway -- <server> [args...]` | Host, upstream tool names, arguments, provider, and login |
| Anthropic or OpenAI TypeScript SDK | `withPinpoint(client)` | Native client methods, return types, streams, and retries |
| Provider HTTP | `pinpoint proxy` | Client and provider protocol |
| A local fixture | `pinpoint demo` | No key, model call, sidecar, or network needed |

### MCP gateway: the main path

Wrap the command your host already uses to launch an MCP server:

```bash
pinpoint mcp gateway -- npx -y <server-package>
pinpoint mcp gateway --min-chars 32000 -- python -m your_mcp_server
```

`--min-chars` overrides the default 16,000-character virtualization threshold. `PINPOINT_MCP_MIN_CHARS` provides the same setting for managed environments.

The host sees all upstream tools plus `pinpoint_query`. When an eligible result crosses the threshold:

1. Pinpoint retains the exact text or structured object in bounded process memory.
2. The original call returns a compact text manifest and `pinpoint://artifact/<id>` resource link.
3. The agent calls `pinpoint_query` for a bounded exact result.
4. The full artifact never enters model context unless the gateway deliberately passes it through.

This moves Pinpoint ahead of host truncation. It also makes the exact path available on subscription/OAuth clients because no model API request is intercepted.

The original `pinpoint mcp` command still starts Pinpoint's standalone compress/retrieve/stats server. The gateway is selected only by the explicit `mcp gateway -- ...` form.

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

## What passes through

The MCP gateway virtualizes a result only when every safety condition holds:

1. The upstream call succeeded and returned either one text block or a structured JSON object.
2. The exact payload meets the 16,000-character default threshold.
3. The compact artifact envelope is smaller than the original result.
4. Bounded local storage can retain the complete payload atomically.
5. Structured data has an exact query shape. A nested record array is selected only when it is the sole candidate within three wrapper levels.

Everything else passes through unchanged. That includes error results, images and other media, mixed content blocks, small responses, multiple competing nested arrays, unsupported values, and results that cannot fit in the local store.

Those are the ordinary **optimization** rules. A source named in an opaque-flow policy is a **confidentiality** boundary instead: Pinpoint captures it regardless of size or envelope profitability and returns a value-free error if exact capture fails. Protected result metadata, extension fields, JSON-RPC errors, stderr, and unsolicited server messages cannot act as alternate value paths. This intentional fail-closed behavior applies only when the operator loads a flow policy.

Artifacts live only for the gateway process lifetime. The default store is capped at 256 entries and 64 MiB with least-recently-used eviction. Query outputs are capped independently; clients cannot use `pinpoint_query` to dump an unbounded artifact back into context.

### Provider-wire QCV: the secondary path

The Anthropic/OpenAI proxy still targets large **older tool results** already present in a provider request. On API-key traffic it can precompute an exact current-question answer before the request leaves the machine:

| Current question | Local operation | Provider receives |
|---|---|---|
| "What is the email for ID 73?" | Exact JSON lookup | The matching value, not the whole array |
| "How many records have `active: true`?" | Exact filtered count | The exact number |
| "Which customer owns order 981?" | One-hop unique-key join | The bounded joined projection |
| "How many ERROR lines are there?" | Boundary-aware log count | The exact count |
| A range, duplicate key, competing dataset, or unclear question | Refuse to guess | The original tool result, unchanged |

Provider-wire QCV remains useful for custom applications and clients that already send full historical results. It is not the main coding-CLI thesis because modern hosts often filter or truncate the data before the model API boundary.

<details>
<summary><strong>How this differs from summarization, prompt caching, and compaction</strong></summary>

<br>

Summaries are useful when the model needs the gist. They are a poor primitive for exact IDs, counts, paths, and rows. Pinpoint's exact path retains the original locally and computes only supported deterministic operations.

| Technique | Primary job | Relationship to Pinpoint |
|---|---|---|
| MCP server filtering and pagination | Prevents oversized results at the source | Preferred when the server can be changed; Pinpoint protects unmodified servers |
| Host spill-to-file | Retains output behind a local path | Host-specific and usually text-oriented; Pinpoint adds protocol-native resources and exact structured operations |
| Provider prompt caching | Discounts repeated byte-identical prefixes | Still useful after the gateway reduces what enters history |
| Provider compaction | Summarizes or clears older history | Acts later and may lose exact details; Pinpoint retains queryable bytes before history |
| Text or image compression | Reduces general prose, code, or static context | Optional [Headroom](https://github.com/headroomlabs-ai/headroom) and [pxpipe](https://github.com/teamchong/pxpipe) integrations remain secondary modules |

Pinpoint composes with these techniques; it does not claim to replace them.

</details>

## How it works

A normal MCP host calls a tool, receives its result, and inserts that result into the next model turn. At that point the provider bill and context damage are already determined.

The gateway moves the decision one boundary earlier:

1. It starts the unmodified upstream stdio server and forwards JSON-RPC requests, responses, notifications, and server-initiated messages.
2. It preserves upstream tool names and input schemas. Structured output schemas become an explicit union of the original object and Pinpoint's artifact envelope.
3. Eligible oversized results enter the local virtual store before the host receives them.
4. The host receives a small manifest, a `resource_link`, and the `pinpoint_query` tool.
5. Exact bounded query results enter model context only when requested.

```
MCP host / coding agent
  |
  | tools/call
  v
Pinpoint MCP gateway -----> unmodified upstream MCP server
  |                              |
  | exact local artifact <-------+
  |
  +---- compact resource handle ----> host conversation
  +<--- pinpoint_query ---------------+
  +---- bounded exact result --------> model
```

The model provider is not in this data path until after the gateway has reduced the result. MCP server credentials remain in the upstream command environment; Pinpoint does not persist them.

### Exact answers instead of summaries

Suppose an MCP API returns 1,000 accounts even though the agent needs one email. Pinpoint returns the artifact schema and identifier. The agent then calls:

```json
{
  "id": "vctx_...",
  "op": "json_select",
  "where": { "accountId": 733 },
  "fields": ["email"]
}
```

The query engine returns one exact projection. It does not summarize the array, use embeddings, or ask a second model to copy a row.

<details>
<summary><strong>When exact optimization applies</strong></summary>

Provider-wire QCV changes an Anthropic/OpenAI request only when all of these checks pass:

1. The request uses Anthropic Messages, OpenAI Chat, or OpenAI Responses with a provider API key.
2. One older tool result meets the size and content rules and matches one explicit lookup or supported count.
3. The local operation returns one complete, bounded, unambiguous result.
4. The dataset reference plus exact result is smaller than the original tool output.
5. The data fits the configured request and memory limits.

Repeated selectors, ranges, negation, multiple matching datasets, malformed values, and subscription traffic pass through unchanged. Exact prefetch works with streaming responses.

</details>

An experimental model-planned fallback exists for harder Anthropic questions, but it is off by default because an earlier version saved tokens while reducing task quality. Disable provider-wire QCV with `PINPOINT_VIRTUAL_CONTEXT=0` or `pinpoint proxy --no-qcv`. The MCP gateway is separately and explicitly activated by `pinpoint mcp gateway`. The [technical design note](./planning/query_backed_context.md) documents the shared exact query engine and rejected fallback design.

## Advanced workflows

Most MCP users only need `pinpoint mcp gateway -- <server>`. The commands below are for provider-wire evaluation and integration work.

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

Provider wrappers are exported from `@codepal/pinpoint/anthropic` and `@codepal/pinpoint/openai`. `@codepal/pinpoint/mcp` exports the gateway and firewall APIs. Other public subpaths expose the integration kernel, protocols, normalized output events, agent adapters, virtual-context APIs, capture/replay, and OTLP telemetry.

</details>

## Proof

CodePal publishes Pinpoint's raw benchmark artifacts, negative results, and safety checks so people can inspect the claims rather than trust a headline.

### Cross-host value-opaque flow gate

Claude Code 2.1.197 with Claude Haiku 4.5 and GitHub Copilot CLI 1.0.71-2 with GPT-5.3 Codex independently executed the same authorized synthetic flow through the production CLI gateway. Each host called only `synthetic_accounts_list` and `pinpoint_flow`. Neither model called the hidden `synthetic_projection_validate` destination or `pinpoint_query`.

| Host | Source call | Opaque flow | Model destination call | Signed receipt | Exact destination acceptance | Final answer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Claude Code | Yes | Yes | No | Valid | 40 records | `VALIDATED` |
| GitHub Copilot CLI | Yes | Yes | No | Valid | 40 records | `VALIDATED` |

The grader scanned 400 synthetic private canaries per host, 800 total, and found zero occurrences in either client event stream. It also found neither public source nor selected-payload hashes. Claude completed in four turns for $0.014894 observed provider cost. Copilot reported zero premium requests and zero file changes. Inspect the [content-free cross-host receipt](./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json) or rerun `npm run bench:mcp-opaque-flow:cross-host` with both clients authenticated.

The no-model protocol gate exercised the same production gateway 30 times and recorded 30/30 exact destination acceptances, 7/7 denied bypasses, 400/400 absent canaries, valid signatures and receipt chain, rejection of a modified receipt, and distinct commitments for 30 identical payloads. The protected 26,231-byte source was captured even with the ordinary threshold set to 100,000,000 characters. A constructed direct transcript was 31,013 bytes; the source plus signed opaque-flow result was 2,628 bytes, 91.5% lower. Local p95 flow latency was 0.91 ms over 30 samples on the recorded machine. Inspect the [protocol receipt](./benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json) or run `npm run bench:mcp-opaque-flow` without a provider call.

These tests prove exact behavior for committed synthetic traces, not semantic noninterference, production demand, or a universal security guarantee. Counts, sizes, field names, timing, and success remain visible. The wrapped process is trusted with values, and receipt keys are ephemeral session keys rather than operator identity certificates. The [value-opaque design note](./planning/value_opaque_mcp_dataflow.md) compares verified prior art and lists the remaining breakthrough gates.

### Cross-host MCP gateway gate

Claude Code 2.1.197 and GitHub Copilot CLI 1.0.71-2 independently used the production gateway against the same disposable synthetic MCP server. The upstream `accounts_list` tool intentionally had no filter and returned 1,000 records under `structuredContent.data.accounts`. Both clients received the same artifact id and returned exactly `user733@example.com`.

| Host | Model | Upstream call | Exact query | Final answer | Bounded result evidence |
|---|---|:---:|:---:|:---:|---|
| Claude Code | Claude Haiku 4.5 | Yes | Yes | Exact | Largest model-visible tool result: 508 characters |
| GitHub Copilot CLI | GPT-5.3 Codex | Yes | Yes | Exact | Largest complete tool-event record: 2,840 characters; includes event metadata |

Claude autonomously performed this sequence:

1. discovered and called `mcp__accounts__accounts_list`;
2. received a 508-character artifact result instead of the 81,665-character structured payload, a 99.4% reduction in model-visible characters for that tool result;
3. called `mcp__accounts__pinpoint_query` with `accountId: 733` and `fields: ["email"]`;
4. returned exactly `user733@example.com`.

The final artifact-asserting gate completed in six agent turns for $0.023223 observed provider cost. Filesystem, shell, subagent, and editing tools were denied, and the run failed unless both MCP calls occurred, exactly one expected artifact id appeared, every visible tool result stayed below 5,000 characters, and the final answer matched exactly. Inspect the [content-free receipt](./benchmarks/results/mcp-gateway-agent.first-party-macos-arm64-20260715.json) or rerun `npm run bench:mcp-gateway:agent` with Claude Code authenticated.

Copilot auto-routed to `gpt-5.3-codex`, exposed only the synthetic `accounts` MCP server, called both tools, changed no files, and used zero premium requests. Rerun with `npm run bench:mcp-gateway:copilot`.

Inspect the [cross-host receipt](./benchmarks/results/mcp-gateway-cross-host.first-party-macos-arm64-20260715.json). Cursor was not authenticated and Codex was blocked by local configuration/authentication, so neither is counted. This remains one first-party synthetic compatibility task, not an estimate of organic prevalence or a universal quality claim.

### Provider-wire QCV evidence gate

The provider-wire receipt covers 30 synthetic task templates with five independently parameterized variants each. Every one of the 150 paired observations has a distinct payload, expected answer, task ID, and fixture hash. Each runs three randomized arms: raw provider input, Headroom-only semantic compression, and Pinpoint QCV. The gate used Claude Haiku 4.5 through Anthropic Messages and GPT-4.1 mini through both OpenAI Chat Completions and Responses.

| Arm | Exact score | Provider input | Modeled provider cost |
|---|---:|---:|---:|
| Raw | 109/150 | 1,899,030 | $1.198998 |
| Headroom | 112/150 | 1,713,184 | $1.062131 |
| **Pinpoint QCV** | **150/150** | **48,439** | **$0.034462** |

Against raw requests, modeled provider cost was 97.1% lower. Against Headroom, QCV used 97.2% fewer input tokens and 96.8% lower modeled provider cost. The paired-bootstrap 95% cost-reduction interval was 96.5%-96.9%. There were zero paired regressions and 38 improvements; the exact one-sided 95% upper bound on harm was 1.98%, below the predeclared two-point non-inferiority margin. That inferential bound treats the 150 fixed, independently parameterized variants as exchangeable benchmark units; it is not a confidence bound for organic traffic.

<details>
<summary><strong>View the provider-wire receipt graphic</strong></summary>

<br>

<img src="./assets/qcv-evidence-gate.svg" alt="Controlled provider-wire QCV gate: 150 of 150 eligible synthetic variants exact, with modeled provider cost 96.8% lower than Headroom" width="920">

</details>

All 150 tasks were deliberately eligible for provider-wire QCV. This proves conditional efficacy after a large exact result reaches provider history. It does not measure how frequently modern coding CLIs produce that traffic.

The run made 450 paid calls with no harness retries and observed $2.295591 in provider spend. Inspect the [full repeated receipt](./benchmarks/results/evidence-gate.first-party-macos-arm64-20260715.json).

### Historical provider-proxy agent gate

Five real Claude Code sessions and five real Codex CLI sessions ran in disposable synthetic repositories through the production proxy. The grader parsed only Claude's final `result` or Codex's last `agent_message`; all 10 returned the single correct email value. All 10 minimized sanitized traces replayed hash-identically, stable cache shape was observed, four long/join sessions completed, and both injected provider POST failures were retried by the agents.

Claude Code exercised QCV on line-numbered `Read` output. Codex queried sub-6,000-character chunks locally, so Pinpoint correctly left those requests unchanged. The source captures, agent outputs, credentials, and personal paths were deleted; only reviewed synthetic derivatives remain. Inspect the [agent receipt](./benchmarks/results/agent-trace-gate.first-party-macos-arm64-20260715.json) and [sanitized traces](./benchmarks/traces/agent-gate/).

These are first-party real-agent sessions over synthetic data, not customer production traces. Copilot subscription traffic is outside provider-wire QCV scope; the new MCP gateway is independent of provider authentication.

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

- Opaque-flow policies are operator-owned JSON loaded before startup. The model cannot choose an arbitrary source, destination, payload argument, operation, field, or limit.
- Configured source tools are fail-closed at every result size. Protected content, metadata, extension fields, JSON-RPC errors, stderr, and unsolicited server messages are not forwarded as alternate value paths.
- Strict flow mode uses random 128-bit process-local capabilities. Public content hashes, artifact resources, previews, `pinpoint_query`, and direct hidden-destination calls are disabled by default.
- Flow receipts expose field names, counts, sizes, limits, and success status. Values are represented by per-sequence HMAC-SHA256 commitments; equal values do not produce equal public commitments.
- Receipts are Ed25519-signed and hash-chained. The session verification key is pinned at MCP initialization. This detects receipt modification but is not operator identity, hardware attestation, or proof that the upstream process is honest.
- The wrapped upstream process is trusted with source and destination values. Pinpoint does not stop that process from using its own network, filesystem, subprocess, timing, or other operating-system channels.
- The MCP gateway spawns the configured upstream command directly with `shell: false`. Upstream arguments are never interpolated into a shell command.
- Gateway artifacts stay in bounded process memory and disappear at shutdown. Text blocks retain their exact text. Structured content is retained as canonical JSON after MCP parsing.
- Store capacity is reserved atomically before a handle is emitted. If the artifact cannot fit, the complete original result passes through instead of producing a dead reference.
- `pinpoint_query` accepts only bounded deterministic operations and caps every result. `resources/read` returns a bounded preview, never the complete unbounded artifact.
- Outside configured opaque-flow sources, error results, media, mixed content, ambiguous nested collections, and unsupported output pass through unchanged. The host may still apply its own truncation to those results.
- Upstream MCP output is untrusted. Virtualization reduces initial exposure, but queried rows or lines can still contain prompt injection or malicious data and must be treated like any other tool result.
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
| `PINPOINT_MCP_MIN_CHARS` | ordinary MCP result-firewall threshold | `16000` |
| `PINPOINT_MCP_FLOW_CONFIG` | versioned value-opaque flow policy file | unset |
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

- **Validated first-party:** one exact MCP task replicated across Claude Code and GitHub Copilot CLI, 150 independently parameterized provider-wire variants across two models and three protocols, plus 10 historical Claude Code/Codex proxy sessions with retries, cache shape, long turns, and hash-matched replay.
- **Still being proved:** independent replication, the eligible share of organic traffic, external adoption, customer demand, and lower proxy overhead under heavy concurrency.

The [product assessment](./planning/product_assessment.md) explains the evidence and current limits without marketing shortcuts.

## License

**Apache-2.0.** Third-party attribution is listed in [`NOTICE`](./NOTICE).

Pinpoint is an open-source CodePal project. Contributions are welcome under [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

