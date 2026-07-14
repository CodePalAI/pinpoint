# Contributing to pixroom

Pixroom accepts focused fixes, protocol adapters, optimizer integrations, adversarial fixtures, and reproducible quality evidence. A smaller honest result is more useful than an unsupported compression headline.

## Setup

```bash
npm ci
npm run typecheck
PIXROOM_HEADROOM_AUTOSPAWN=0 npm test
npm run build
```

The default suite uses fake local upstreams and does not require provider credentials. Two live-sidecar tests are skipped unless their explicit environment gate is enabled.

## Architecture contract

Request optimizers implement `ProcessorIntegration` and return typed proposals. They must declare region ownership, fidelity, and cache impact. The host validates and commits selected changes transactionally.

New optimizers must:

1. Fail open with a documented pass-through path and kill switch.
2. Avoid side effects during `propose`; external state changes belong in the transaction `commit` hook.
3. Preserve unknown protocol fields and original bytes when no request mutation is committed.
4. Include every schema, retry, retrieval, continuation, and cache cost in measurement.
5. Add a narrow falsifying regression test before broad benchmark work.

## Evidence labels

- `unit-simulation`: mechanism checks with synthetic parameters; no product-performance claim.
- `offline-real-transform`: real optimizer code, valid for transform and token accounting only.
- `live-controlled`: real provider calls with directly graded fixed tasks.
- `live-agentic`: real autonomous runs; high variance unless paired and repeated.

Paid benchmarks are disabled unless `BENCH_ALLOW_PAID=1` and explicit request and dollar caps are set. Never commit API keys. Preserve failed designs and quality regressions as evidence rather than deleting them.

External integration examples belong under `examples/integrations` and must import only published Pixroom subpaths. At least one test must run each example with built-ins disabled.

Capture fixtures must remain metadata-only or contain synthetic bodies. Never commit real body-enabled capture files.

## Pull requests

Keep changes scoped, document configuration changes, and include the command used to validate them. Run `npm pack --dry-run` when changing exports, CLI behavior, or package metadata. Security issues follow [`SECURITY.md`](./SECURITY.md), not the public issue tracker.