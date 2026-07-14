# Changelog

All notable changes are documented here. This project follows semantic versioning once stable releases begin.

## Unreleased

### Added

- Query-Backed Context Virtualization (QCV) for exact historical JSON, log, and source tool results.
- Deterministic exact current-question prefetch with cache-stable historical manifests across exact selectors.
- Optional bounded Anthropic `pixroom_query` continuation with aggregate usage accounting.
- Transaction commit hooks for optimizer-owned external state.
- Request-scoped QCV capabilities, entry/byte/request limits, and store health metrics.
- Audit, shadow, optimize, and enforce runtime modes with typed proposal traces.
- CI, security, contribution, issue, and benchmark evidence policies.
- Exact QCV for OpenAI Chat and OpenAI Responses, including streaming requests.
- Server-owned `headroom_retrieve` continuation for Anthropic and OpenAI JSON/SSE clients.
- Fsynced JSONL decision capture and offline `pixroom replay` evaluation.
- Content-free bounded OTLP/HTTP optimization spans.
- Two external integration examples using only public exports.
- A 36-task exact-QCV breadth suite and isolated three-process latency profile.

### Changed

- Safe exact QCV now defaults on. `PIXROOM_VIRTUAL_CONTEXT=0` or `--no-qcv` disables it.
- Model-driven query fallback is independently gated by `PIXROOM_VIRTUAL_QUERY_FALLBACK=1` or `--virtual-query-fallback`.
- Unchanged routed requests preserve their original wire bytes.
- QCV-only requests smaller than the minimum eligible dataset stream without inspection.

### Safety

- Provider validation now occurs before QCV storage commits.
- Shadow, rejected, and rolled-back proposals retain no QCV data.
- Mixed tools, failed continuations, invalid responses, and exhausted query rounds replay the original request.
- Model-visible QCV metadata and exact values escape prompt delimiters.
- Body capture is separately gated, stored mode `0600`, and disabled by default.
- Pure internal continuation is required; mixed client/Pixroom tools replay the original request.