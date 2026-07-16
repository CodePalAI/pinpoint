## What changed

<!-- Describe the behavior, not only the files. -->

## Evidence

<!-- Include the narrow test/benchmark and its evidence level. -->

- [ ] `npm run typecheck`
- [ ] `PINPOINT_HEADROOM_AUTOSPAWN=0 npm test`
- [ ] `PINPOINT_HEADROOM_AUTOSPAWN=0 PINPOINT_LOG=silent npm run verify`
- [ ] New behavior has a regression test or a documented reason it cannot.
- [ ] Flow-policy changes preserve operator authority, strict defaults, and the documented model-visible metadata boundary.
- [ ] Receipt changes verify against the verifier pinned during MCP initialization.
- [ ] Token/cost claims include all known overhead and preserve negative results.
- [ ] No credentials, private traces, or generated paid-call artifacts were added.
- [ ] User-facing behavior and configuration are documented.
- [ ] Package/release changes stay within the reviewed tarball budgets and follow `RELEASING.md`.