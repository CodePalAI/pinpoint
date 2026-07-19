# Pinpoint breakthrough scorecard

_Evidence date: 2026-07-19. This file defines the word "proven" for this project._

## Decision rule

Pinpoint may be described as an **internally validated candidate systems
contribution** while all locally executable gates pass.

Pinpoint may be described as an **independently reproduced systems contribution**
only after gates E1 and E2 pass.

Pinpoint may be described as a **field breakthrough** only after every blocking gate
below passes, results remain reproducible on the reviewed commit, and no unresolved
high-severity security finding remains.

No maintainer-authored fixture, benchmark, review, or model can satisfy an external
gate.

## Scorecard

| ID | Gate | Pass condition | Status | Evidence |
|---|---|---|---|---|
| L1 | Protocol correctness | 30/30 correct hidden destinations; every declared bypass denied; zero fixture canaries in client transcript | **PASS** | [protocol receipt](../benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json) |
| L2 | Operator authority | Fixed predicates cannot be omitted or overridden; fields, operations, arguments, provenance, item and byte bounds enforced | **PASS** | `fixedWhere`, 8/8 bypasses, [property tests](../tests/mcp-opaque-flow-properties.test.ts) |
| L3 | Bounded safety model | Every reachable state under the declared bound satisfies value isolation, source/destination catalog confinement, credential-domain isolation, receipt completeness, and sequence linkage | **PASS** | [Spin receipt](../benchmarks/results/opaque-flow-model-check.first-party-macos-arm64-20260715.json), [property map](./opaque_flow_formal_properties.md) |
| L4 | Model non-vacuity | Deliberate modeled value-disclosure and credential-copy bugs each produce an assertion violation | **PASS** | `npm run formal:opaque-flow:mutation` |
| L5 | Receipt verification | Runtime and standalone verifier accept valid receipt and reject tampered/wrong-session receipt | **PASS** | `verifyMcpOpaqueFlowReceipt`, `pinpoint-verify-receipt`, verifier tests |
| L5a | Operator-rooted policy authorization | Stable operator root delegates a fresh session key to an unlinkable complete-policy commitment; wrong root, key swap, changed fixed policy, and tampering fail | **PASS locally** | authority property suite, production protocol gate, standalone verifier |
| L6 | Real host behavior | At least two installed host/model families execute source + flow, never call hidden destination/query, and expose zero fixture canaries | **PASS (2 executed)** | [cross-host receipt](../benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json); Codex auth-blocked and uncounted |
| L7 | Published OSS compatibility | Production gateway preserves exact outcomes across seven pinned unmodified external MCP servers, including one exact persistent cross-server side effect, eight oversized-result workflows, and two passthrough controls | **PASS (7 servers / 10 paired workflows)** | [common-workflow receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json), [cross-server receipt](../benchmarks/results/mcp-oss-cross-server.first-party-macos-arm64-20260716.json) |
| L8 | Full regression and packaging | Full tests, docs/fingerprints, package smoke, audit, and CI formal gate pass | **PASS locally** | release validation commands; CI runs Spin on Node 24 |
| L9 | Closest runnable mechanism comparison | Byte-identical source/projection/destination workflow runs through Pinpoint and pinned HCP; task success, native denials, disclosure, authority, TCB, timing scope, and audit are reported without one scalar score | **PASS locally** | [HCP comparison receipt](../benchmarks/results/hcp-comparison.first-party-macos-arm64-20260716.json) |
| L10 | Async implementation conformance | Duplicate outstanding ids dispatch at most once; malformed error status cannot become signed success; a surviving gateway terminalizes post-dispatch child loss as unconfirmed; catalog authorization is complete and fresh; pre-aborted startup spawns no process | **PASS locally** | `npm run test:mcp-adversarial`; real stdio process fixtures and receipt verification |
| E1 | Independent reproduction | Unaffiliated operator submits clean-machine receipt with failures and relationship disclosed | **OPEN / BLOCKING** | [Issue #14](https://github.com/CodePalAI/pinpoint/issues/14) |
| E2 | Independent security review | Unaffiliated reviewer publishes findings; all high-severity findings resolved and rerun | **OPEN / BLOCKING** | [Issue #15](https://github.com/CodePalAI/pinpoint/issues/15) |
| E3 | Real workflow demand | At least three external teams evaluate real bounded workflows and one requests continued deployment | **OPEN / BLOCKING** | [Issue #17](https://github.com/CodePalAI/pinpoint/issues/17) |
| E4 | Independent comparative evaluation | An unaffiliated reviewer reproduces the matched HCP comparison or executes another faithful established alternative, preserving native strengths, failures, adapters, TCB, and incomparable dimensions | **PARTIAL / BLOCKING** | First-party HCP comparison passes; [Issue #16](https://github.com/CodePalAI/pinpoint/issues/16) remains open |
| E5 | Broader interoperability | At least three independent host/server combinations, including two published external MCP servers, pass reviewed gates | **OPEN / BLOCKING** | [Issue #18](https://github.com/CodePalAI/pinpoint/issues/18) |
| E6 | Externally durable authority | A reviewed organizational trust root is pinned outside the gateway and sessions are retained/witnessed or transparency-anchored so omission and equivocation can be detected | **OPEN / BLOCKING** | Software operator-root mechanism exists; external identity, HSM/witness, and transparency evidence do not |

## Current verdict

**Not proven as a field breakthrough.**

Pinpoint has passed every locally executable gate currently defined here and has
stronger evidence than a prototype based only on unit tests: bounded model checking,
mutation sensitivity, implementation properties, real protocol processes, two live
hosts, a standalone verifier, ten paired workflows across seven pinned external servers,
one exact cross-server composition, and a barrier-controlled asynchronous adversarial
gate. The 2026-07-19 maintainer challenge found and repaired duplicate flow dispatch,
false-success status parsing, and missing same-process crash receipts. This is stronger
local evidence, not independent review.

The remaining blockers require unaffiliated people, externally sourced workflows, or
external identity/witness infrastructure. Calling the result "proven" before those gates close
would be circular.

## Re-evaluation procedure

1. Link each new receipt or review to the relevant gate.
2. Verify source fingerprints against the reviewed commit.
3. Preserve failures, exclusions, retries, client/model versions, and compensation or
   maintainer relationships.
4. Rerun `npm run formal:opaque-flow`, `npm test`, `npm run docs:check`, and
   `npm run package:smoke` after every security-relevant change.
5. Change the current verdict only in a pull request that identifies exactly which
   blocking evidence closed.