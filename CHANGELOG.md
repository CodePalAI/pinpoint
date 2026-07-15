# Changelog

All notable changes are documented here. This project follows semantic versioning once stable releases begin.

## Unreleased

### Added

- A transparent stdio MCP gateway: `pinpoint mcp gateway -- <server> [args...]` starts an unmodified upstream server without a shell and forwards bidirectional JSON-RPC traffic.
- A lossless MCP result firewall that replaces eligible oversized text or structured results with a compact `pinpoint://artifact/...` resource link and deterministic `pinpoint_query` access.
- Protocol-native artifact resources, bounded previews, exact schema/select/count/grep/slice/join operations, and a public `@codepal/pinpoint/mcp` API.
- Deterministic discovery of one unambiguous nested record array under structured wrappers such as `data.accounts`, while retaining the complete wrapper payload.
- A real Claude Code MCP gate in which an 81,665-character, 1,000-row result became a 513-character handle and Claude autonomously queried the exact email through the expected SHA-derived artifact.
- A matching GitHub Copilot CLI gate using auto-routed GPT-5.3 Codex: the same artifact id, upstream call, exact query, and final email passed with zero premium requests and no file changes.
- A content-free cross-host receipt that counts 2/2 executed clients and explicitly excludes unauthenticated Cursor and blocked Codex cells.
- Operator-configured `pinpoint_flow` dataflow: exact local projections can enter a hidden unmodified destination tool without source or destination values crossing the client-facing MCP transcript.
- Versioned flow-policy parsing with source/destination provenance, operation/filter/projection allowlists, fixed and dynamic destination-argument policy, and item/byte bounds.
- Random session capability ids, per-sequence HMAC-SHA256 value commitments, Ed25519-signed hash-chained receipts, initialization-time verifier pinning, and a public receipt verifier.
- A no-model protocol gate with 30/30 exact hidden destination acceptances, 7/7 denied bypasses, zero of 400 private canaries leaked, a 91.5% constructed visible-byte reduction, and sub-millisecond p95 local flow latency on the recorded run.
- A live Claude Code and GitHub Copilot CLI gate in which both hosts completed the same exact 40-record hidden destination flow, emitted valid receipts, and exposed zero fixture values in retained event-stream grades.

### Changed

- The primary product boundary moved from the model API proxy to the MCP tool boundary, before host truncation and provider context ingestion. Provider-wire QCV remains a secondary path for eligible API-key traffic.
- Upstream MCP output schemas are advertised as an object union accepting either the original structured result or Pinpoint's artifact envelope.
- Supplying a flow policy changes configured source tools from ordinary optimization semantics to mandatory fail-closed capture at every result size. Programmatic flow users inherit strict query/resource/capability defaults.

### Safety

- MCP errors, media, mixed blocks, small results, ambiguous nested collections, unsupported values, and unprofitable transformations pass through unchanged.
- Artifact capacity is reserved atomically before a handle is emitted; insufficient storage fails open with the original result.
- Gateway query and resource outputs are bounded independently, artifacts are process-scoped, and upstream commands use `shell: false`.
- Strict flows hide direct query, resources, previews, and destination tools; scrub protected metadata/extensions and protocol errors; suppress protected stderr and unsolicited server messages; and validate configured tools against the upstream catalog before accepting calls.

### Fixed

- Generated output schemas retain root `type: "object"`, as required by Claude Code's strict MCP tool validator even when `anyOf` is present.

## 0.1.1 - 2026-07-15

### Added

- Deterministic one-hop unique-key QCV joins across two JSON tool results, with exact local projection and no model-planned retrieval.
- Expanded exact-QCV breadth evidence: 42/42 positive tasks across seven categories and 20/20 adversarial controls refused.
- A repeated paid evidence gate covering 30 task templates, 150 unique fixture variants, two models, and Anthropic Messages plus OpenAI Chat/Responses, with exact confidence bounds and hard spend/request caps.
- A ten-session real Claude Code/Codex capture, sanitization, retry, cache-shape, and hash-replay gate.
- Automated packed-consumer smoke coverage for all public exports, declarations, CLI help/version, and the offline demo.
- A project Code of Conduct, five scoped starter issues, and npm/GitHub Actions dependency automation.

### Changed

- CI now verifies maintained Node.js 22 and 24 releases, with package smoke coverage on Linux, macOS, and Windows.
- Release recovery verifies a signed existing tag, rebuilds one checksummed tarball, and supports granular npm tokens that cannot list organization membership.

### Safety

- Exact joins fall through on duplicate selector rows, duplicate destination keys, competing datasets, multiple valid join paths, missing rows, oversized projections, or insufficient atomic store capacity. Unsafe JSON integers fall through instead of being rounded.
- Evidence receipts and minimized synthetic traces reject credential patterns, omit source captures and agent output, use mode `0600`, and carry exact implementation SHA-256 fingerprints.

### Fixed

- Explicit API-key Claude Code and Codex traffic is classified as PAYG while OAuth/JWT traffic remains stealth.
- QCV recovers the latest real question across tool-only user turns, ignores standalone Claude Code system reminders, and scopes planning away from unrelated agent instructions and file paths.
- Sequential line-numbered Claude Code `Read` output is recognized as structured content without changing the stored source bytes.
- Sidecar deadlines now cover response-body parsing, and closing during proxy startup cannot leave a listening server behind.
- Third-party proposals validate nested stage and reversible-handle shapes and cannot mutate host-owned state without claiming its region.
- CCR limits retain finite minimum caps, use safe defaults for non-finite values, and roll back transforms whose reversible batch cannot fit.

## 0.1.0 - 2026-07-14

### Added

- GitHub Release-driven publication to the npm registry.
- Receipt-generated README proof graphic, executable documentation checks, and an `llms.txt` project index.
- Independent benchmark reproduction guide and structured replication issue form.
- Source-backed OSS adoption research and a gated public-launch checklist.
- Query-Backed Context Virtualization (QCV) for exact historical JSON, log, and source tool results.
- Deterministic exact current-question prefetch with cache-stable historical manifests across exact selectors.
- Optional bounded Anthropic `pinpoint_query` continuation with aggregate usage accounting.
- Transaction commit hooks for optimizer-owned external state.
- Request-scoped QCV capabilities, entry/byte/request limits, and store health metrics.
- Audit, shadow, optimize, and enforce runtime modes with typed proposal traces.
- CI, security, contribution, issue, and benchmark evidence policies.
- Exact QCV for OpenAI Chat and OpenAI Responses, including streaming requests.
- Server-owned `headroom_retrieve` continuation for Anthropic and OpenAI JSON/SSE clients.
- Fsynced JSONL decision capture and offline `pinpoint replay` evaluation.
- Content-free bounded OTLP/HTTP optimization spans.
- Two external integration examples using only public exports.
- A 36-task exact-QCV breadth suite and isolated three-process latency profile.
- Public CodePal ownership, product relationship, and support metadata.

### Changed

- Renamed the product, CLI, SDK, environment variables, npm package, and repository to Pinpoint.
- The minimum supported Node.js version is now 22.
- Optical model allowlists are now runtime-local, with a reviewed Fable-5-only default.
- Output integrations now receive events in order and are flushed during proxy shutdown.
- Safe exact QCV now defaults on. `PINPOINT_VIRTUAL_CONTEXT=0` or `--no-qcv` disables it.
- Model-driven query fallback is independently gated by `PINPOINT_VIRTUAL_QUERY_FALLBACK=1` or `--virtual-query-fallback`.
- Unchanged routed requests preserve their original wire bytes.
- QCV-only requests smaller than the minimum eligible dataset stream without inspection.

### Safety

- Proxy optimization inspection is capped at 32 MiB by default; oversized requests stream through unchanged.
- Third-party integration analysis now receives a cloned request context so direct proposal-time mutations cannot leak into live requests.
- Provider validation now occurs before QCV storage commits.
- Shadow, rejected, and rolled-back proposals retain no QCV data.
- Mixed tools, failed continuations, invalid responses, and exhausted query rounds replay the original request.
- Model-visible QCV metadata and exact values escape prompt delimiters.
- Body capture is separately gated, stored mode `0600`, and disabled by default.
- Pure internal continuation is required; mixed client/Pinpoint tools replay the original request.