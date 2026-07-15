# Contributing to pinpoint

Pinpoint is developed by [CodePal](https://codepal.ai) as an open-source part of its LLM optimization work. The project accepts focused fixes, protocol adapters, optimizer integrations, adversarial fixtures, and reproducible quality evidence. A smaller honest result is more useful than an unsupported compression headline.

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). Report conduct concerns privately through the channel listed there.

## Setup

```bash
npm ci
npm run typecheck
PINPOINT_HEADROOM_AUTOSPAWN=0 npm test
npm run build
npm run package:smoke
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

External integration examples belong under `examples/integrations` and must import only published Pinpoint subpaths. At least one test must run each example with built-ins disabled.

Capture fixtures must remain metadata-only or contain synthetic bodies. Never commit real body-enabled capture files.

## Releases

Update the version in `package.json` and `package-lock.json`, move the changelog entries under a dated version heading, and validate the package with `npm test` and `npm pack --dry-run`. Publish a GitHub Release whose tag is exactly `v<package version>`; `.github/workflows/release.yml` rejects mismatched tags and publishes the package to npm from the release commit.

The first npm publication requires a granular npm token stored as the `NPM_TOKEN` secret in GitHub's `release` environment. After the package exists, configure its npm Trusted Publisher for organization `CodePalAI`, repository `pinpoint`, workflow `release.yml`, environment `release`, and the `npm publish` action. Verify one OIDC release before deleting the bootstrap token. Releases from this public repository include npm provenance.

## Pull requests

Keep changes scoped, document configuration changes, and include the command used to validate them. Run `npm pack --dry-run` when changing exports, CLI behavior, or package metadata. Security issues follow [`SECURITY.md`](./SECURITY.md), not the public issue tracker.