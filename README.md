<h1 align="center">Pinpoint</h1>

<p align="center"><strong>Let AI agents use private tool data without showing it to the model.</strong></p>

<p align="center">Pinpoint sits between an MCP host and your tools. It applies an exact policy locally, sends only approved fields to a destination tool, and gives the agent a signed receipt instead of the values.</p>

<p align="center">
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache%202.0-1f6feb.svg"></a>
  <a href="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A522-2f855a.svg">
  <a href="./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json"><img alt="Opaque flow gate passed on two clients for one synthetic flow" src="https://img.shields.io/badge/opaque%20flow%20gate-2%20clients%20%2F%201%20synthetic%20flow-2ea44f.svg"></a>
  <img alt="Experimental status" src="https://img.shields.io/badge/status-experimental-c2410c.svg">
</p>

<p align="center">
  <a href="#start-here">See the value</a> ·
  <a href="#ten-everyday-mcp-jobs-ten-exact-answers">Results</a> ·
  <a href="#install">Try it</a> ·
  <a href="#where-it-fits">Use cases</a> ·
  <a href="#evidence">Evidence</a> ·
  <a href="#security-boundary">Security</a>
</p>

<p align="center"><sub>Open source · Local or VPC-side · Works before model context · Your host keeps its model and login</sub></p>

<p align="center">
  <img src="./assets/pinpoint-policy-flow.svg" alt="Pinpoint controls an exact local projection from an existing source MCP tool into an existing destination MCP tool while the AI agent receives only a random capability and signed receipt" width="1100">
</p>

---

## Ten everyday MCP jobs. Ten exact answers.

<p align="center">
  <strong>10/10 exact</strong> &nbsp;·&nbsp;
  <strong>99.0% fewer response bytes</strong> &nbsp;·&nbsp;
  <strong>11,992 unrelated value occurrences kept out</strong>
</p>

<table>
  <thead>
    <tr>
      <th align="left">What the user asked</th>
      <th align="right">Without Pinpoint</th>
      <th align="right">With Pinpoint</th>
      <th align="left">Outcome</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="./comparisons/customer-record-lookup.md"><strong>Find one customer's email</strong></a></td>
      <td align="right">215,336 B<br><sub>999 unrelated visible</sub></td>
      <td align="right">1,463 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>99.3% less</strong><br><sub>same exact email</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/active-account-count.md"><strong>Count active EU accounts</strong></a></td>
      <td align="right">215,336 B<br><sub>1,000 unrelated visible</sub></td>
      <td align="right">1,307 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>99.4% less</strong><br><sub>same exact count: 166</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/incident-log-triage.md"><strong>Find one incident in a service log</strong></a></td>
      <td align="right">276,180 B<br><sub>1,999 unrelated visible</sub></td>
      <td align="right">1,490 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>99.5% less</strong><br><sub>same exact log line</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/web-research.md"><strong>Find one fact on a long web page</strong></a></td>
      <td align="right">108,253 B<br><sub>1,999 unrelated visible</sub></td>
      <td align="right">1,377 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>98.7% less</strong><br><sub>same exact source line</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/database-query.md"><strong>Find one row in a large SQL report</strong></a></td>
      <td align="right">117,099 B<br><sub>999 unrelated visible</sub></td>
      <td align="right">1,468 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>98.7% less</strong><br><sub>same exact database value</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/knowledge-graph-lookup.md"><strong>Recall one customer note</strong></a></td>
      <td align="right">132,672 B<br><sub>998 unrelated visible</sub></td>
      <td align="right">1,495 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>98.9% less</strong><br><sub>same exact note</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/native-filter-passthrough.md"><strong>Open one named customer</strong></a></td>
      <td align="right">437 B<br><sub>already bounded</sub></td>
      <td align="right">437 B<br><sub>no artifact created</sub></td>
      <td><strong>Byte-identical</strong><br><sub>Pinpoint stayed out of the way</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/large-commit-triage.md"><strong>Find one change in a large commit</strong></a></td>
      <td align="right">96,416 B<br><sub>1,999 unrelated visible</sub></td>
      <td align="right">1,384 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>98.6% less</strong><br><sub>same exact changed line</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/browser-snapshot.md"><strong>Inspect a large browser page</strong></a></td>
      <td align="right">97,147 B<br><sub>1,999 unrelated visible</sub></td>
      <td align="right">1,378 B<br><sub>0 unrelated visible</sub></td>
      <td><strong>98.6% less</strong><br><sub>same exact page target</sub></td>
    </tr>
    <tr>
      <td><a href="./comparisons/timezone-conversion.md"><strong>Convert a meeting time to Tokyo</strong></a></td>
      <td align="right">452 B<br><sub>already bounded</sub></td>
      <td align="right">452 B<br><sub>no artifact created</sub></td>
      <td><strong>Byte-identical</strong><br><sub>same exact +9.0h answer</sub></td>
    </tr>
  </tbody>
</table>

<p align="center"><sub>1,259,328 bytes without Pinpoint vs 12,251 bytes with Pinpoint across seven pinned published MCP servers. Eight oversized results improved; two already-bounded controls stayed unchanged. Data-bearing response bytes, not token estimates. <a href="./benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json">Receipt</a> · <a href="./comparisons/README.md">Research and method</a></sub></p>

## Start here

### What is Pinpoint?

Pinpoint sits between your AI agent and an MCP server.

Normally, an MCP tool returns data to the agent. That data can enter the model's conversation even when the model only needs one row, or when another tool is the real consumer.

Pinpoint intercepts the result first. It can:

1. keep a large result local and let the agent query only the exact part it needs;
2. move an approved subset directly into another MCP tool and give the agent a signed receipt instead of the values.

You keep the same AI host, model, login, and MCP tools. You change the MCP launch command.

### A concrete example

Suppose an agent has 200 customer records and must send renewal emails to the 40 active customers.

**Without Pinpoint**

```text
Customer database -> 200 customer records -> AI model -> email tool
```

The model may receive names, email addresses, account notes, and fields it did not need.

**With Pinpoint**

```text
Customer database -> Pinpoint applies active=true and selects email
                  -> email tool receives exactly 40 addresses
                  -> AI model receives count, status, and signed receipt
```

Your operator owns the policy. The agent may invoke the approved workflow, but it cannot change the source, destination, fixed filter, selected fields, or payload limits.

This customer example is a template for your own tool names. The fastest runnable demo below uses the same 200-to-40 shape with two published filesystem and memory MCP servers.

### What changes?

Before:

```json
{
  "command": "npx",
  "args": ["-y", "your-mcp-server"]
}
```

After:

```json
{
  "command": "pinpoint",
  "args": [
    "mcp", "gateway",
    "--flow-config", "./flow-policy.json",
    "--",
    "npx", "-y", "your-mcp-server"
  ]
}
```

That is the basic integration.

## Install

<!-- PINPOINT_NPM_STATUS: unpublished -->

You need Node.js 22 or newer. Until the npm package is publicly verified, install from the repository:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint
npm ci && npm link
pinpoint --version
```

### Fastest working demo

From the source checkout above, run the real two-server demo. It does not call a
model or require an API key:

```bash
npm run bench:mcp-oss-cross-server
```

This benchmark requires the source checkout and is not shipped as an executable npm
command. After the npm release, the installed runtime smoke is:

```bash
pinpoint demo
```

It reads 200 synthetic records through the official filesystem MCP server, moves the exact 40-row approved projection into the official memory MCP server, denies four bypass attempts, and verifies that 0/600 private fixture values entered the client transcript.

Look for these fields in the final JSON:

```json
{
  "passed": true,
  "summary": {
    "bypassAttempts": 4,
    "bypassesDenied": 4,
    "exactPersistedProjection": true,
    "persistedEntities": 40,
    "privateCanariesLeaked": 0
  }
}
```

The exact gate is `benchmarks/v2/mcp_oss_cross_server_gate.mjs`; the [reproduction guide](./benchmarks/REPRODUCING.md) explains the command. Its retained result is the [cross-server receipt](./benchmarks/results/mcp-oss-cross-server.first-party-macos-arm64-20260716.json).

## Pick your mode

Pinpoint has two MCP modes. Start with the one that matches your problem.

| Your problem | Use | What the model sees |
|---|---|---|
| A tool returns too much JSON, text, logs, or traces | **Result firewall** | A compact handle and bounded query tool |
| One tool needs selected values from another tool | **Value-opaque flow** | A random capability and signed receipt |

### Mode 1: result firewall

Use this when the agent needs to inspect a large result.

```bash
pinpoint mcp gateway -- npx -y your-mcp-server
```

If a result is large enough, Pinpoint keeps the full value in bounded process memory and returns a small artifact handle. The agent can then call `pinpoint_query`:

```json
{
  "id": "vctx_...",
  "op": "json_select",
  "where": { "accountId": 733 },
  "fields": ["email"]
}
```

This is not a summary. The query returns the exact selected value. Other supported operations include `schema`, `count`, `grep`, `slice`, and strict `json_join`.

The lossless MCP result firewall for AI agents runs before host truncation and before the result reaches provider context.

### Mode 2: value-opaque flow

Use this when another tool needs the values but the model does not.

Start with [examples/mcp-opaque-flow.json](./examples/mcp-opaque-flow.json):

```json
{
  "version": 1,
  "flows": [{
    "name": "deliver_active_accounts",
    "sourceTool": "accounts_list",
    "sourceKind": "json-array",
    "destinationTool": "campaign_deliver",
    "destinationArgument": "recipients",
    "fixedDestinationArguments": { "campaign": "renewal" },
    "allowedOps": ["json_select"],
    "fixedWhere": { "active": true },
    "allowedFields": ["email"],
    "maxItems": 100,
    "maxBytes": 16384
  }]
}
```

```bash
pinpoint mcp gateway \
  --flow-config ./examples/mcp-opaque-flow.json \
  -- npx -y your-mcp-server
```

What happens:

1. The agent calls `accounts_list`.
2. Pinpoint stores the result locally and returns a random capability.
3. The agent calls `pinpoint_flow` with that capability.
4. Pinpoint always applies `active=true` and selects only `email`.
5. Pinpoint calls `campaign_deliver` internally.
6. The agent receives a signed receipt, not the email addresses or destination result.

`fixedWhere` is operator-owned. The model cannot omit or override it.

### Use a separate destination server

```bash
pinpoint mcp gateway \
  --flow-config ./examples/mcp-opaque-flow.json \
  --destination-config ./examples/mcp-opaque-destination.json \
  -- npx -y your-source-mcp-server
```

The destination stays private. Its tools are not added to the host's tool catalog.

```json
{
  "version": 1,
  "id": "crm-domain",
  "command": "npx",
  "args": ["-y", "your-crm-mcp-server"],
  "envAllowlist": ["PATH", "CRM_API_TOKEN"],
  "sharedEnvAllowlist": ["PATH"]
}
```

`envAllowlist` copies named variables to the destination. Pinpoint removes those names from the source environment unless they also appear in `sharedEnvAllowlist`.

Keep secret values in your environment, keychain, or workload identity system. Do not put them in the JSON policy, command arguments, prompt, or `fixedDestinationArguments`.

### Add operator-rooted receipts

By default, each gateway session creates a fresh receipt key. For continuity across sessions, create an operator key once:

```bash
pinpoint mcp authority init --out ./pinpoint-operator.pem
```

```bash
pinpoint mcp gateway \
  --flow-config ./examples/mcp-opaque-flow.json \
  --flow-authority-key ./pinpoint-operator.pem \
  --flow-authority-opening ./pinpoint-authority-opening.json \
  -- npx -y your-mcp-server
```

Pinpoint creates the key and opening record with file mode `0600` and refuses to overwrite existing files. Protect both files.

## What you get

### Exact policy enforcement

The flow policy controls the source, destination, fixed filters, projected fields, operations, arguments, and item/byte limits. Unknown policy fields and malformed configurations fail before the upstream process starts.

### A value-free receipt

```json
{
  "flow": "deliver_active_accounts",
  "sourceTool": "accounts_list",
  "destinationTool": "campaign_deliver",
  "whereFields": ["active"],
  "projectionFields": ["email"],
  "items": 42,
  "destinationSucceeded": true,
  "policyShapeSha256": "...",
  "receiptHash": "...",
  "signature": "..."
}
```

The receipt contains names, counts, limits, commitments, and success status. It does not contain source values, destination arguments, or destination result values.

Pinpoint returns the receipt through MCP but does not persist it. Store receipts in your existing collector if you need durable audit history.

```bash
pinpoint-verify-receipt receipt.json \
  --path firstReceipt \
  --signing-key-id <id-from-initialize>
```

With operator authority:

```bash
pinpoint-verify-receipt receipt.json \
  --path firstReceipt \
  --operator-key-id <operator-id-pinned-out-of-band> \
  --policy ./flow-policy.json \
  --authority-opening ./pinpoint-authority-opening.json
```

SDK users can call `verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier)`.

### Safe failure behavior

Configured opaque sources fail closed if Pinpoint cannot capture them exactly.

If a private destination crashes or times out after dispatch, Pinpoint returns a signed receipt with `destinationSucceeded=false`, blocks later flows, and exits nonzero. This means success was **not confirmed**. It does not prove that the side effect did not happen. Reconcile the destination or use an idempotency key before retrying.

Ordinary result-firewall optimization has separate fail-open behavior: unsupported or unprofitable results pass through unchanged.

## Where it fits

| Workflow | Source | Pinpoint policy | Destination |
|---|---|---|---|
| Customer operations | Accounts or support records | Filter eligibility and select approved contact fields | CRM or campaign tool |
| Security operations | Alerts, logs, asset inventory | Select severity, identifiers, and bounded evidence | Incident tracker |
| Finance operations | Transactions or invoices | Select approved records and reconciliation fields | ERP or reconciliation tool |
| Data platform | Warehouse or analytics results | Apply exact filters and projection | Internal workflow tool |
| Developer platform | Large JSON, logs, traces | Keep exact data local and query only what is needed | Agent context |

Pinpoint is a good fit when one tool has structured data another tool needs, the transfer can be expressed exactly, and you control the MCP launch command.

## When Pinpoint is a bad fit

- The model must read and reason over every transferred value.
- Your source already returns the exact bounded rows and fields you need.
- You need a remote HTTP/OAuth destination. The private destination is currently stdio.
- You need an OS sandbox or protection from a compromised gateway or MCP process.
- You need exactly-once writes and the destination has no idempotency or reconciliation mechanism.

## Works with your stack

| Surface | Integration | Current evidence |
|---|---|---|
| Any stdio MCP host | `pinpoint mcp gateway -- <server>` | Protocol integration suite |
| Two stdio MCP servers | Add `--destination-config <file>` | Published filesystem-to-memory gate |
| Claude Code MCP | Replace the configured server command | Live synthetic flow passed |
| GitHub Copilot CLI | Replace the configured server command | Live synthetic flow passed; zero premium requests |
| VS Code, Codex, Cursor, other MCP hosts | Same stdio wrapper pattern | Independent replication remains open |
| Node.js applications | Import `@codepal/pinpoint/mcp` | Packed consumer smoke |

Pinpoint is **Subscription-compatible at the MCP layer**. The host keeps its current model, API key, OAuth, or subscription login. No new model provider key is required.

## Evidence

The tests use synthetic data. They preserve failures and remove raw model event streams after grading.

| Gate | Result | What it establishes |
|---|---:|---|
| Cross-host opaque flow | **2/2 executed clients passed** | Claude Code and Copilot used the constrained flow; Codex was provider-401 before MCP initialization and is uncounted |
| Client event scan | **0/800 canary occurrences** | Exact string scan across executed host traces |
| Protocol gate | **30/30 destinations; 8/8 bypasses denied** | Exact same-server flow, strict source capture, signed chain |
| Operator authority | **Exact opening valid; wrong root and tampering rejected** | Session key bound to a complete hidden policy commitment |
| Bounded reference model | **2,270,040 states / 3,416,444 transitions / 0 violations** | Spin 6.5.2, ten actions per trace; abstract model, not a proof over TypeScript |
| Mutation checks | **2 deliberate bugs detected** | Value-leak and credential-copy mutations each caused an assertion violation |
| Published OSS result firewall | **1/1 server passed** | Unmodified `@modelcontextprotocol/server-filesystem@2026.7.10`; exact row recovery |
| Published OSS cross-server flow | **40/40 entities; 4/4 denials; 0/600 canaries** | Filesystem `2026.7.10` to memory `2026.7.4`; exact JSONL side effect |
| Matched HCP comparison | **Pinpoint exact; HCP 30/30 exact; both 4/4 denials and 0/600 canaries** | Byte-identical fixture and native authority comparison; No scalar winner |
| Constructed visible traffic | **31,013 -> 3,414 bytes, 89.0% lower** | Same synthetic source/destination payload with authority receipt |
| Local flow latency | **0.84 ms p95** | 30 local protocol samples, not a production load test |

<details>
<summary><strong>Detailed receipt measurements</strong></summary>

<br>

The live result-firewall fixture returned an **81,665**-character upstream result as a
**508**-character artifact response, a **99.4%** reduction for that tool result. Claude
Code **2.1.197** recovered exactly `user733@example.com` for **$0.029404**. GitHub
Copilot CLI **1.0.71-3** used `gpt-5.3-codex`; its largest complete tool event was
**2,840** characters.

The opaque-flow protocol scan found **400/400** private canaries absent. In the live
cross-host flow, Claude Code **2.1.197** and Copilot **1.0.71** both returned exactly
`VALIDATED`; Claude's observed cost was **$0.022547**.

The published cross-server path uses
`@modelcontextprotocol/server-filesystem@2026.7.10` and
`@modelcontextprotocol/server-memory@2026.7.4`.

Evidence links:

- [protocol receipt](./benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json)
- [cross-host receipt](./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json)
- [model-check receipt](./benchmarks/results/opaque-flow-model-check.first-party-macos-arm64-20260715.json)
- [OSS filesystem receipt](./benchmarks/results/mcp-oss-filesystem.first-party-macos-arm64-20260715.json)
- [OSS cross-server receipt](./benchmarks/results/mcp-oss-cross-server.first-party-macos-arm64-20260716.json)
- [HCP comparison receipt](./benchmarks/results/hcp-comparison.first-party-macos-arm64-20260716.json)
- [benchmark report](./benchmarks/REPORT.md)
- [reproduction guide](./benchmarks/REPRODUCING.md)

</details>

<details>
<summary><strong>What the HCP comparison says</strong></summary>

<br>

The closest runnable mechanism found was Handle-Capability Protocol runtime 0.3.0 at commit `e7eb50158f3d495f1dc99a2755abe08f0d0db716`.

| System | Exact result | Native denials | Canaries leaked | Stronger area |
|---|---:|---:|---:|---|
| Pinpoint | 1/1 | 4/4 | 0/600 | Unmodified MCP tools, exact row/field policy, process separation, signed receipts |
| HCP | 30/30 | 4/4 | 0/600 | Principal, grant, resource, approval, data-class policy, rich audit |

**No scalar winner.** The systems enforce different layers. HCP's public repository reports **293/296** tests passing because three readiness checks expect one README phrase that is absent. Its native data-pipe demo and matched mechanism arm pass.

Microsoft Fides Gateway was inspected but not scored. Its public gateway can evaluate and report a policy decision, but it does not bind that decision to hidden source-to-destination dispatch.

</details>

### Evidence boundary

These are first-party synthetic tests. They are not customer production traces, a formal proof over the TypeScript runtime, a prevalence estimate, or a compliance certification.

The project will not call itself independently proven while [clean-machine reproduction #14](https://github.com/CodePalAI/pinpoint/issues/14) and [unaffiliated security review #15](https://github.com/CodePalAI/pinpoint/issues/15) remain open. The [breakthrough scorecard](./planning/breakthrough_scorecard.md) lists every blocking gate.

## Security boundary

Pinpoint controls the client-facing MCP path. It is not a complete security platform.

| Pinpoint controls | Pinpoint does not provide |
|---|---|
| Source, destination, fields, filters, arguments, and limits | Proof that a policy is legally or semantically correct |
| Source/destination values on the client-facing transcript | Protection from a malicious MCP process using its own network, files, subprocesses, or timing channels |
| Separate request maps and destination-exclusive environment names | OS sandboxing or isolation from shared files, keychains, workload identity, IPC, or kernel resources |
| Signed receipts and optional operator-rooted delegation | Proof of organizational identity, human approval, hardware attestation, or transparency inclusion |
| Bounded artifacts and bounded queries | Zero retention, DLP certification, identity services, or compliance certification |
| Failure receipts after unconfirmed destination calls | Rollback or exactly-once side effects |

Observable metadata includes tool names, flow names, field names, operation, counts, sizes, limits, timing, success status, receipt sequence, and policy shape.

Read [SECURITY.md](./SECURITY.md) and the [full threat model](./planning/value_opaque_mcp_dataflow.md#threat-model) before using Pinpoint with sensitive data.

## Run a safe trial

1. Choose one source and destination with synthetic data.
2. Add canary values that must never appear in the client transcript.
3. Fix the allowed filters, fields, and maximum payload in policy.
4. Confirm the destination received the exact expected projection.
5. Review timeout, retry, metadata, storage, and network assumptions before using real data.

## Deployment fit

| Decision | Current answer |
|---|---|
| Best fit | Local or VPC-side wrapper around stdio MCP servers |
| Host change | Replace the configured MCP launch command |
| Tool change | None for wrapped source and destination tools |
| Model change | None |
| Policy owner | Operator, platform team, or security team; never the model |
| Storage | Bounded process memory; artifacts disappear at shutdown |
| Validated hosts | Claude Code and GitHub Copilot CLI on synthetic gates |
| Private destination | One separately spawned stdio destination |
| Maturity | Experimental; controlled evaluation, not automatic production approval |

Not yet supported: multiple destinations, remote HTTP/OAuth brokering, OS sandboxing, exactly-once side effects, externally witnessed operator identity, HSM/remote attestation, omission-proof transparency, or formal compliance claims.

## Configuration reference

| Environment variable | Purpose | Default |
|---|---|---|
| `PINPOINT_MCP_MIN_CHARS` | Result-firewall threshold | `16000` |
| `PINPOINT_MCP_FLOW_CONFIG` | Value-opaque flow policy | unset |
| `PINPOINT_MCP_DESTINATION_CONFIG` | Private destination process config | unset |
| `PINPOINT_MCP_FLOW_AUTHORITY_KEY` | Mode-0600 operator private key | unset |
| `PINPOINT_MCP_FLOW_AUTHORITY_OPENING` | Mode-0600 policy opening record | unset |
| `PINPOINT_CAPTURE_PATH` | Durable metadata JSONL capture | unset |
| `PINPOINT_CAPTURE_BODIES` | Include sensitive bodies for replay | `off` |
| `PINPOINT_OTLP_ENDPOINT` | OTLP/HTTP trace collector | unset |
| `PINPOINT_LOG` | `silent`, `error`, `warn`, `info`, or `debug` | `info` |

Run `pinpoint help` for the complete CLI reference.

<details>
<summary><strong>Developer integrations and secondary optimization engine</strong></summary>

<br>

## TypeScript SDK

Pinpoint also ships provider API wrappers. These are secondary to the MCP gateway.

```bash
cd /path/to/your-app
npm install /path/to/pinpoint
```

```ts
import Anthropic from '@anthropic-ai/sdk';
import { withPinpoint } from '@codepal/pinpoint/anthropic';

const client = await withPinpoint(new Anthropic());
try {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Find the failed account.' }],
  });
  console.log(message.content);
} finally {
  await client.pinpoint.close();
}
```

Pinpoint is ESM-only. TypeScript projects should use `NodeNext` module resolution.

The provider HTTP proxy remains available:

```bash
pinpoint proxy
ANTHROPIC_BASE_URL=http://127.0.0.1:8788 your-command
OPENAI_BASE_URL=http://127.0.0.1:8788/v1 your-command
```

Provider-wire QCV handles large older tool results already present in an API request. It is a secondary path because the MCP gateway intercepts data earlier.

[Headroom](https://github.com/headroomlabs-ai/headroom) supplies optional semantic compression. [pxpipe](https://github.com/teamchong/pxpipe) supplies optional optical compression. Pinpoint does not claim those algorithms as its own.

</details>

<details>
<summary><strong>Historical optimizer evidence</strong></summary>

<br>

## Provider-wire evidence

The historical provider-wire gate contains 150 deliberately eligible synthetic variants.

| Arm | Exact score | Provider input | Modeled provider cost |
|---|---:|---:|---:|
| Raw | 109/150 | 1,899,030 | $1.198998 |
| Headroom | 112/150 | 1,713,184 | $1.062131 |
| Pinpoint QCV | **150/150** | **48,439** | **$0.034462** |

Against Headroom, modeled provider cost was **96.8% lower**, with a paired bootstrap interval of **96.5%-96.9%** and a one-sided paired-harm upper bound of **1.98%**. The run made 450 paid calls and observed **$2.295591** in spend.

Against raw requests, modeled provider cost was **97.1% lower**. QCV used **97.2%**
fewer input tokens than Headroom.

All tasks were intentionally eligible. This proves conditional efficacy, not organic traffic prevalence.

<img src="./assets/qcv-evidence-gate.svg" alt="Controlled provider-wire QCV gate: 150 of 150 eligible synthetic variants exact, with modeled provider cost 96.8% lower than Headroom" width="920">

The earlier pilot reduced provider-reported input from **22,614 to 594 tokens**, modeled cost from **$0.022684 to $0.000664**, and improved exact score from **1/2 to 2/2**. A broader offline transform reduced estimated input from **49,020 to 25,093** tokens, or **48.8%**.

</details>

## Contributing

Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
PINPOINT_HEADROOM_AUTOSPAWN=0 PINPOINT_LOG=silent npm run verify
```

Security-sensitive MCP or release changes also run:

```bash
npm run formal:opaque-flow
npm run formal:opaque-flow:mutation
```

Use [GitHub Discussions](https://github.com/CodePalAI/pinpoint/discussions) for architecture questions and sanitized field reports. Report vulnerabilities through [SECURITY.md](./SECURITY.md).
Maintainers follow [RELEASING.md](./RELEASING.md) for signed tags, protected publication, SBOMs, checksums, and npm provenance.

## Status

Pinpoint is experimental and available today for controlled local or VPC-side evaluation.

Validated first-party: Claude Code and GitHub Copilot CLI passed the value-opaque flow; the protocol gate completed 30/30 destinations and denied 8/8 bypasses; the published cross-server gate persisted 40/40 exact entities with 0/600 canaries.

Still being proved: independent security review, clean-machine reproduction, broader host replication, external workflows, remote or multi-destination authority, witnessed operator identity, and customer demand.

For the strict verdict, read [planning/breakthrough_scorecard.md](./planning/breakthrough_scorecard.md).

<p align="center"><sub><strong>AI agents / LLMs:</strong> read <a href="./llms.txt"><code>/llms.txt</code></a> for the compact project index.</sub></p>

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Pinpoint is an open-source [CodePal](https://codepal.ai) project.
