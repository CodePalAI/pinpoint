# Opaque-flow formal properties

_Status: bounded reference model checked with Spin 6.5.2 on 2026-07-16._

## What was checked

`formal/opaque_flow.pml` is an independent finite-state reference model of the
security decisions at the MCP client, Pinpoint gateway, and wrapped upstream
boundary. Spin exhaustively explored every modeled action ordering up to ten actions
per trace.

The committed run reached depth 208 and explored:

- 2,270,040 stored states;
- 1,146,404 matched states;
- 3,416,444 transitions;
- zero unreached control states;
- zero assertion violations.

The model asserts these properties on every reachable state:

### P1. Client transcript value isolation

Selected protected values never become visible on the modeled client-facing channel.
Malformed source results, late upstream output, direct resource reads, and direct query
attempts cannot set the client-visible value state.

### P2. Policy confinement of destination dispatch

A destination dispatch implies all modeled predicates held simultaneously:

- the source catalog validated;
- the destination catalog validated independently;
- the operator authority binding is valid for the session key and exact policy commitment;
- the capability is valid;
- the operation is allowlisted;
- filter fields are allowlisted;
- projection fields are allowlisted;
- destination arguments are allowlisted;
- source provenance matches;
- operator-fixed predicates remain applied;
- the item bound holds;
- the byte bound holds.

### P2b. Authentication-domain isolation

Source credentials never cross into the destination authentication domain. The
implementation maps this property to destination `envAllowlist`, source removal of
destination-exclusive names, explicit `sharedEnvAllowlist`, and separate stdio request
maps. The model does not prove operating-system isolation.

### P3. Receipt completeness

Every destination dispatch emits exactly one receipt, and no rejected action emits a
successful dispatch receipt.

### P4. Receipt sequence integrity

Each emitted receipt advances the session sequence by exactly one and records the
previous sequence value. The TypeScript implementation separately signs the complete
attestation and chains the previous receipt hash.

## Hostile actions explored

The state space includes independently invalid source and destination catalogs,
credential-copy attempts, missing or tampered authority, wrong roots,
changed policy commitments, session-key swaps, direct hidden-destination calls, direct
queries, resource reads, forged capabilities, malformed protected source responses,
late upstream output, fixed-predicate override attempts, and every independent
combination of the policy predicates.

## Non-vacuity check

`npm run formal:opaque-flow:mutation` creates two temporary models with deliberate
bugs: late protected upstream output sets the client-visible value state, and a source
credential crosses into the destination domain. Spin must find at least one assertion
violation for each mutation. The committed gate detected both with one violation each.

## Relationship to the implementation

The model is not generated from TypeScript and is not a proof over Node.js. It is a
separate specification. Implementation conformance is tested at adjacent boundaries:

| Property | TypeScript owner | Executable implementation evidence |
|---|---|---|
| Protected capture and value-free errors | `src/mcp/gateway.ts` | `tests/mcp-gateway.test.ts`, hostile protocol fixture |
| Policy parsing and allowlists | `src/mcp/flow.ts` | `tests/cli.test.ts`, opaque-flow protocol gate |
| Separate catalog and credential domains | `src/mcp/destination.ts`, `src/mcp/gateway.ts` | cross-server exact, invalid-catalog, environment, timeout, and two-published-server gates |
| Capability provenance and hidden destination | `src/mcp/gateway.ts`, `src/mcp/flow.ts` | forged-capability, direct-destination, and resource bypasses |
| Item and byte confinement | `src/mcp/flow.ts` | protocol gate and query-store bounds |
| Receipt signature and session pinning | `src/mcp/flow.ts` | valid, tampered, wrong-session, concurrent-chain tests |
| Operator delegation and policy opening | `src/mcp/flow.ts` | stable-root/fresh-session, changed-fixed-policy, key-swap, wrong-root, and tamper properties |
| Standalone receipt verification | `bin/verify-receipt.js` (no runtime imports) | committed receipt and exact policy opening accepted; tampered, wrong-session, wrong-root, and changed-policy inputs rejected |
| Client event-stream absence | production gateway and host harnesses | 400 protocol canaries and 800 aggregate cross-host canary checks |
| Async dispatch and terminalization | `src/mcp/gateway.ts`, `src/mcp/destination.ts` | duplicate-id reservation, malformed-status rejection, catalog invalidation, post-dispatch child exit, timeout, and pre-aborted startup in `npm run test:mcp-adversarial` |

Receipt dispatch and emission are atomic in the Promela model. The TypeScript runtime is
not atomic: process I/O separates preparation, dispatch, completion, and receipt output.
The adversarial implementation gate checks those asynchronous boundaries directly.

## Assumptions

- Pinpoint, the reviewed policy, source process, destination process, and OS boundary are trusted.
- The model abstracts JSON parsing, cryptographic primitives, process isolation, and
  transport framing.
- Capabilities are abstract Booleans; cryptographic entropy is tested separately.
- Tool names, field names, counts, sizes, limits, timing, and success are observable.
- The search is bounded to ten actions per trace over finite predicates.

## Not proved

This gate does not prove the TypeScript implementation correct, semantic
noninterference, timing or cardinality secrecy, cryptographic security, absence of
Node/runtime defects, upstream honesty, whether the operator key belongs to a claimed
organization, key protection, omission/equivocation across sessions, or regulatory compliance.
It raises the evidence from testing alone to a checked abstract safety model whose
implementation mapping remains subject to independent review.

## Reproduce

Install Spin 6.5.2 or newer, then run:

```bash
npm run formal:opaque-flow
npm run formal:opaque-flow:mutation
pinpoint-verify-receipt benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json --path firstReceipt
```

The content-free receipt is
`benchmarks/results/opaque-flow-model-check.first-party-macos-arm64-20260715.json`.