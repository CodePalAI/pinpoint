# Changelog

All notable changes are documented here. This project follows semantic versioning once stable releases begin.

## Unreleased

## 0.2.5 - 2026-07-19

### Changed

- `pinpoint demo` now runs the core value-opaque MCP flow through separate
	synthetic source and destination processes, with exact side-effect, bypass,
	transcript-opacity, and signed-receipt self-checks. The previous QCV demo remains
	available as `pinpoint demo qcv`.
- `pinpoint doctor` now validates the core MCP gateway by default without probing
	optional compression services. Legacy pxpipe/Headroom checks moved to
	`pinpoint doctor optimizer`; Copilot readiness remains `pinpoint doctor copilot`.
- `pinpoint evidence reproduce` now runs 30 repeated calls of one packaged
	synthetic flow plus eight bypass classes as a no-model protocol gate, then writes
	a content-free, relationship-labeled, mode-0600 JSON
	bundle. `pinpoint evidence verify` separately checks strict schema, accidental-
	corruption checksum, reported results, runtime manifest, receipt signatures,
	initialized verifier, and complete chain without claiming operator authentication.

### Fixed

- Public onboarding now reflects the published npm package and no longer describes
	the QCV-only demo as the two-server opaque-flow product path.

## 0.2.4 - 2026-07-19

### Changed

- The npm package moved from inaccessible organization scopes to the user-owned
	`@codepalaiorg` scope. Public imports and install commands now use
	`@codepalaiorg/pinpoint`; the CLI remains `pinpoint`.
- First publication now requires a granular npm automation token authorized for
	the `@codepalaiorg` scope with bypass-2FA publishing enabled. The reviewer-protected
	GitHub environment remains the only place that receives the token.

### Fixed

- Copilot dashboard sessions now survive same-tab refresh, reconcile live
	request counters independently of SSE, recover ended history accurately, and
	terminate delegated process trees within a bounded shutdown window.
- Opaque-flow dispatch now reserves outstanding client ids, rejects malformed
	destination status, terminalizes surviving post-dispatch child loss with an
	unconfirmed receipt, invalidates changed or incomplete catalogs, and avoids
	spawning pre-aborted gateways. A named adversarial runtime gate covers these
	concurrency and failure paths.
- The failed `v0.2.3` candidate completed signed provenance generation but npm
	rejected the existing protected token with `E403` before package publication
	or release-asset upload. Version `0.2.4` supersedes it after credential
	remediation.

## 0.2.3 - 2026-07-18

### Fixed

- npm 12 publication now receives an absolute tarball path, avoiding ambiguous
	shorthand parsing of `release/codepal-...tgz` as a disabled Git dependency.
- Release assets upload through each verified draft's `uploads.github.com` URL;
	upload, download, byte comparison, and cleanup were rehearsed against the
	unpublished `v0.2.2` draft.
- The failed `v0.2.2` candidate published neither npm content nor release
	assets. Version `0.2.3` supersedes it.

## 0.2.2 - 2026-07-18

### Fixed

- Draft-release resolution now runs only inside the reviewer-protected publish
	job, whose scoped `contents: write` token can read drafts. The build job
	remains unprivileged with `contents: read`.
- The failed `v0.2.1` candidate stopped before protected-environment approval,
	npm publication, or release-asset upload. Version `0.2.2` supersedes it.

## 0.2.1 - 2026-07-18

### Fixed

- Release automation now resolves draft releases by verified numeric release id
	for validation, asset attachment, and publication instead of relying on
	intermittent tag-based draft lookup.
- The failed `v0.2.0` candidate stopped before npm publication or release-asset
	upload. Version `0.2.1` is the first registry publication candidate.

## 0.2.0 - 2026-07-18

### Added

- A transparent stdio MCP gateway: `pinpoint mcp gateway -- <server> [args...]` starts an unmodified upstream server without a shell and forwards bidirectional JSON-RPC traffic.
- A lossless MCP result firewall that replaces eligible oversized text or structured results with a compact `pinpoint://artifact/...` resource link and deterministic `pinpoint_query` access.
- Protocol-native artifact resources, bounded previews, exact schema/select/count/grep/slice/join operations, and a public `@codepalaiorg/pinpoint/mcp` API.
- Deterministic discovery of one unambiguous nested record array under structured wrappers such as `data.accounts`, while retaining the complete wrapper payload.
- A real Claude Code MCP gate in which an 81,665-character, 1,000-row result became a 508-character handle and Claude autonomously queried the exact email through the expected SHA-derived artifact.
- A matching GitHub Copilot CLI gate using auto-routed GPT-5.3 Codex: the same artifact id, upstream call, exact query, and final email passed with zero premium requests and no file changes.
- A content-free cross-host receipt that counts 2/2 executed clients and explicitly excludes unauthenticated Cursor and blocked Codex cells.
- Operator-configured `pinpoint_flow` dataflow: exact local projections can enter a hidden unmodified destination tool without source or destination values crossing the client-facing MCP transcript.
- Versioned flow-policy parsing with source/destination provenance, operation/filter/projection allowlists, fixed and dynamic destination-argument policy, and item/byte bounds.
- Random session capability ids, per-sequence HMAC-SHA256 value commitments, Ed25519-signed hash-chained receipts, initialization-time verifier pinning, and a public receipt verifier.
- Operator-fixed `fixedWhere` predicates that are always applied locally and cannot be omitted or overridden by the model.
- A Spin 6.5.2 bounded reference model covering 2,270,040 states and 3,416,444 transitions with zero assertion violations, including separate source/destination catalogs, credential-domain isolation, and operator-authority confinement; value-leak and credential-copy mutations are both detected.
- A `pinpoint-verify-receipt` binary with no external service dependency; it uses the packaged policy parser to verify the exact normalized same-server or private-destination policy. Valid, tampered, wrong-session, wrong-operator, and changed-policy receipts are covered.
- Optional operator-rooted receipt sessions: `pinpoint mcp authority init` creates a protected Ed25519 key that delegates fresh session keys to unlinkable commitments of complete normalized policies, with independently verifiable opening records.
- A pinned unmodified `@modelcontextprotocol/server-filesystem@2026.7.10` gate that exposed and repaired identical string-wrapper handling in structured MCP results.
- A deterministic opaque-flow property suite covering fixed predicates, repeated projections, policy hashes, byte bounds, 1,000 random capabilities, receipt opacity, wrong-session verification, 50-link chains, and value-free destination errors.
- A no-model protocol gate with 30/30 exact hidden destination acceptances, 8/8 denied bypasses, zero of 400 private canaries leaked, valid operator/policy authorization, an 89.0% constructed visible-byte reduction, and measured local flow latency on the recorded run.
- A live Claude Code and GitHub Copilot CLI gate in which both hosts completed the same exact 40-record hidden destination flow, emitted valid receipts, and exposed zero fixture values in retained event-stream grades.
- A private destination mode using `--destination-config`: one separately spawned stdio server receives internal opaque-flow calls through its own initialize/catalog/request/lifecycle path and never enters the host tool catalog.
- Deny-by-default destination environment policy: `envAllowlist` names are removed from the source process unless explicitly permitted in `sharedEnvAllowlist`; credential values remain outside JSON policy.
- A two-published-server gate composing unmodified filesystem 2026.7.10 and memory 2026.7.4 packages, with an exact 40-entity persistent side effect, 4/4 native denials, and zero of 600 source canaries in the client transcript.
- A matched Handle-Capability Protocol comparison over a byte-identical fixture: Pinpoint exact with 4/4 native denials and 0/600 canaries; HCP exact 30/30 with 4/4 different native denials and 0/600 canaries. The receipt preserves HCP's 293/296 public repository-test result and reports no scalar winner.
- A paired common-workflow gate covering 10 exact tasks across seven pinned published MCP servers: Filesystem, Memory, Git, Fetch, DBHub, Playwright, and Time. Eight oversized results reduced data-bearing response bytes by 98.6% to 99.5%; two bounded controls remained byte-identical.
- A receipt-backed public comparison gallery with one plain-language page per workflow, dated adoption research, authenticated-service exclusions, and mechanical claim synchronization.
- Canonical `npm run verify` and `npm run verify:release` gates, package file/byte budgets, a repository-pinned SSH release signer, and explicit bootstrap-token versus OIDC trusted-publishing modes.
- A pinned CodeQL and dependency-review workflow, registry signature verification, deterministic CycloneDX production SBOM generation, and durable checksum-verified GitHub Release assets.
- A strict allowlist for production dependency licenses and explicit root `types` and `sideEffects` package metadata.
- Independent packed-tarball SHA-512 verification and checksum coverage for the package integrity record.
- Draft-first release publication: npm and immutable assets complete before the GitHub Release becomes public, and tagged candidates cannot ship source-only install instructions.
- A three-business-day vulnerability acknowledgement target with explicit critical-issue triage and coordinated disclosure language.
- An opt-in local Session Recorder for provider requests, MCP exact-byte virtualization/query/flow events, and delegated GitHub Copilot usage through an allowlist-only Headroom adapter.
- `pinpoint dashboard`, plus `--dashboard`, `--dashboard-port`, and `--no-open` support for proxy, wrap, and MCP gateway workflows.
- Metadata-only mode-0600 session journals, source/unit/basis provenance, provider-reported Copilot quota, and shared-proxy attribution warnings.

### Changed

- The primary product boundary moved from the model API proxy to the MCP tool boundary, before host truncation and provider context ingestion. Provider-wire QCV remains a secondary path for eligible API-key traffic.
- Upstream MCP output schemas are advertised as an object union accepting either the original structured result or Pinpoint's artifact envelope.
- Supplying a flow policy changes configured source tools from ordinary optimization semantics to mandatory fail-closed capture at every result size. Programmatic flow users inherit strict query/resource/capability defaults.
- CI on Linux, macOS, and Windows now consumes the same canonical verification contract used by contributors and release builds.

### Safety

- MCP errors, media, mixed blocks, small results, ambiguous nested collections, unsupported values, and unprofitable transformations pass through unchanged.
- Artifact capacity is reserved atomically before a handle is emitted; insufficient storage fails open with the original result.
- Gateway query and resource outputs are bounded independently, artifacts are process-scoped, and upstream commands use `shell: false`.
- Strict flows hide direct query, resources, previews, and destination tools; scrub protected metadata/extensions and protocol errors; suppress protected stderr and unsolicited server messages; and validate configured tools against the upstream catalog before accepting calls.
- Cross-server destination startup/catalog errors fail closed. A timeout or process loss after dispatch emits one signed unconfirmed receipt, blocks further flows, and terminates nonzero rather than claiming rollback.
- The dashboard binds only to loopback, validates Host/Origin, requires a fragment-bootstrapped bearer token for read-only APIs and SSE, serves no remote assets, and structurally excludes prompts, responses, tool values, credentials, capabilities, and receipt bodies.

### Fixed

- Generated output schemas retain root `type: "object"`, as required by Claude Code's strict MCP tool validator even when `anyOf` is present.
- Idle Copilot startup samples render as connection state rather than completed zero-savings work, and all-zero Headroom lanes stay out of calibration.
- Subsecond Headroom sampling captures short-lived Copilot requests; graceful teardown no longer overwrites the last healthy usage sample with a transient disconnect.

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