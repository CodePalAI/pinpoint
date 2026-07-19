# Pinpoint public launch checklist

This is the manual work that code cannot complete. Do the gates in order. A launch date is not a reason to skip one.

The source review and the line between observed patterns and hypotheses are documented in [oss_adoption_research.md](./oss_adoption_research.md).

## Why this launch shape

Breakout AI developer projects repeatedly reduce the path from claim to proof to a runnable result:

- Ollama made the product a command: `ollama run ...`.
- Open WebUI, browser-use, aider, Langfuse, and promptfoo showed the workflow in a short GIF or video before setup detail.
- vLLM, llama.cpp, Unsloth, SGLang, LMCache, and LLMLingua put measured output, hardware or workload scope, and reproduction paths near the claim.
- LiteLLM and mem0 led with a small primitive developers could paste into existing code.
- Mature projects turn releases, model support, integrations, and benchmark updates into repeated launches rather than betting everything on one announcement.

For Pinpoint, that now means: enterprise dataflow problem, operator-owned policy, visible signed receipt, one-command protocol gate, explicit trust boundary, then the result-firewall and provider-proxy history.

## Gate 1: independent evidence

- [ ] Give the repository, [value-opaque technical brief](./value_opaque_mcp_dataflow.md), and [reproduction guide](../benchmarks/REPRODUCING.md) to a security engineer who did not author the feature.
- [ ] Ask them to run the no-model protocol gate first, inspect the policy and verifier contract, then reproduce the flow on a clean host/client combination.
- [ ] Preserve all protocol, bypass, successful, and failed content-free receipts.
- [ ] Record commit, dependency versions, OS, CPU, region, date, model ID, pricing date, task count, run count, retries, and exclusions.
- [ ] Open a benchmark-replication issue and have a second reviewer verify the aggregate directly from raw JSON.
- [ ] Keep the first-party synthetic scope beside every zero-canary, cross-host, latency, and byte-reduction result until independent evidence exists.

Do not publish "model never sees sensitive data" without the documented metadata and process boundary, or claim "production proven," "compliant," "zero leakage," or independent validation from the current receipts.

## Gate 2: visual proof

- [x] Create a buyer-facing MCP control-boundary diagram and a 1280x640 social-preview asset. See `assets/pinpoint-policy-flow.svg` and `assets/pinpoint-social-preview.png`. Verified 2026-07-15.
- [ ] Upload `assets/pinpoint-social-preview.png` in repository Settings > General > Social preview. GitHub provides no supported API; the shared browser session was not authenticated during this pass.
- [ ] Record a 15-25 second terminal demo at 1200x750 or larger, with a readable font and no shell history, username, file path, token, or notification visible.
- [ ] Show `npm run bench:mcp-opaque-flow` from a clean checkout, then the two visible MCP calls: source capability followed by `pinpoint_flow`.
- [ ] Keep the recording to one story: generated account rows, exact approved projection, hidden local validator, signed receipt, zero fixture values in the client transcript.
- [ ] Export an MP4 for GitHub upload and a compressed GIF/WebP fallback under 8 MB.
- [ ] Upload the MP4 by dragging it into a temporary GitHub issue comment, copy the `user-attachments` URL, then close the issue.
- [ ] Add the hosted recording beside the enterprise evidence table. Keep the protocol receipt as the static fallback.
- [ ] Add alt text that states what happens; do not use "demo" as the whole alt text.

Recommended tools: VHS for deterministic terminal capture, or Screen Studio/QuickTime for a real shell recording. Use the real command, not a composited animation.

## Gate 3: public package and repository

- [x] Make `CodePalAI/pinpoint` public before publishing npm so provenance and repository links resolve. Verified public on 2026-07-14.
- [ ] Confirm Apache-2.0 ownership, `NOTICE`, upstream attribution, and the security contact with counsel or the responsible owner.
- [ ] Replace `NPM_TOKEN` in the `release` environment with a granular token for npm user `codepalaiorg` that can publish to its `@codepalaiorg` scope.
- [x] Preserve signed source-only `v0.1.0`; its npm publication failed before registry upload and it is superseded by the reviewed patch release. Verified 2026-07-15.
- [ ] After required CI passes, create and push a signed annotated `v0.2.4` tag from the final reviewed commit.
- [ ] Create draft GitHub Release `v0.2.4`; dispatch the protected release workflow with tag `v0.2.4`; verify it publishes npm with provenance, attaches checksummed assets, and only then publishes the GitHub Release.
- [ ] On clean Node 22 and 24 environments across Linux, macOS, and Windows, run `npx @codepalaiorg/pinpoint@0.2.4 demo`, import every public subpath, and test `pinpoint --help`.
- [ ] Confirm `npm view @codepalaiorg/pinpoint version repository.url dist.integrity` points to this repository.
- [ ] After the registry confirms `@codepalaiorg/pinpoint@0.2.4`, configure npm Trusted Publisher, verify one manual `oidc` release, then remove `NPM_TOKEN`.
- [ ] Verify the prepared `npx @codepalaiorg/pinpoint demo`, `npm install -g @codepalaiorg/pinpoint`, and `npm install @codepalaiorg/pinpoint` commands from clean environments.
- [ ] Add npm version and weekly-download badges only after the registry data exists.
- [ ] Record the published npm tarball SHA-512/integrity value in the release notes and verify it against the attached checksum assets.

## Gate 4: GitHub conversion surface

- [x] Set the About description to: `Policy-controlled MCP dataflow. Let AI agents act on structured business data without exposing selected values to the model.` Verified 2026-07-15.
- [x] Set the homepage to `https://codepal.ai` until dedicated docs have a stable domain. Verified 2026-07-14.
- [x] Keep topics focused on the current product: `mcp`, `mcp-gateway`, `mcp-security`, `ai-security`, `agent-security`, `data-governance`, `privacy`, `ai-agents`, `claude-code`, `github-copilot`, `codepal`. Verified 2026-07-15.
- [x] Enable GitHub Discussions with `Q&A`, `Ideas`, and `Show and tell`. Verified 2026-07-14.
- [ ] Add a `Benchmarks` Discussions category in the web UI; GitHub exposes no category-creation API.
- [x] Add the Discussions link to the README. Verified 2026-07-14.
- [x] Rewrite [Discussion #2](https://github.com/CodePalAI/pinpoint/discussions/2) for enterprise evaluators, including target owners, evaluation sequence, strict data-safety rules, and a design-partner invitation. Verified 2026-07-15.
- [ ] Pin [Discussion #2](https://github.com/CodePalAI/pinpoint/discussions/2) in the web UI; GitHub exposes no pin-discussion API mutation.
- [x] Create 5 scoped `good first issue` items before launch: [#9](https://github.com/CodePalAI/pinpoint/issues/9), [#10](https://github.com/CodePalAI/pinpoint/issues/10), [#11](https://github.com/CodePalAI/pinpoint/issues/11), [#12](https://github.com/CodePalAI/pinpoint/issues/12), and [#13](https://github.com/CodePalAI/pinpoint/issues/13). Verified 2026-07-14.
- [ ] Confirm bug, optimizer, and benchmark-replication issue forms work while logged out of the maintainer account.
- [x] Add a Code of Conduct with CodePal enforcement and a private reporting channel. Verified 2026-07-14.

## Gate 5: real-world proof

- [ ] Recruit three external AI platform or security teams to evaluate one bounded source-to-destination MCP flow.
- [ ] Publish an opt-in call for traces that explains body capture risks and recommends local replay instead of uploading prompts.
- [ ] Run at least 10 sanitized Claude Code, Codex, or agent traces with cache effects, retries, retrievals, and full-session cost included.
- [ ] Report workflow fit, exact destination success, blocked bypasses, model-visible metadata, added turns, and the share of source results that require fail-closed handling.
- [ ] Report p50/p95 added latency and error rate at concurrency 1 and 10. Keep the measured concurrency-100 limitation visible.
- [ ] Obtain written permission before using any adopter name, logo, quote, or workload description.

## Gate 6: launch sequence

1. Publish the repository, npm package, release notes, and demo. Let links settle before promotion.
2. Post a technical Show HN titled around the mechanism, not the percentage: `Show HN: Pinpoint, policy-controlled dataflow between MCP tools`.
3. In the first paragraph, state the source-to-destination exposure problem, the no-model protocol command, the synthetic evidence boundary, and why this is not prompt-based redaction.
4. Share the mechanism and raw receipts in relevant technical communities where maintainers already participate. Do not cross-post generic launch copy.
5. Publish a separate engineering article after launch covering the failed manifest-only design, exact prefetch repair, transaction boundary, and evidence taxonomy.
6. Treat every meaningful integration, independent replication, and benchmark expansion as a new release with its own proof.

Product Hunt is optional and secondary. HN, GitHub, npm, agent communities, and technically credible write-ups are the better fit for this project.

## Launch-day watch

- [ ] Have one maintainer own issues and discussions for the first 12 hours.
- [ ] Watch install failures, Node versions, missing sidecar behavior, wrapper compatibility, and confusion about subscription mode.
- [ ] Answer benchmark skepticism with receipts and scope, not a larger claim.
- [ ] Patch onboarding breakage immediately and publish a point release instead of asking users to build from `main`.
- [ ] Record referral sources, README-to-install conversion where available, npm downloads, unique cloners, demo completions, issues, and independent replications.

Stars are attention, not the success metric. The useful launch outcomes are successful installs, repeated use, external traces, independent evidence, integrations, and maintainers who return.

## README package-status audit

Before launch, this command should return no unresolved placeholder whose gate is complete:

```bash
rg 'PINPOINT_NPM_STATUS' README.md
```

The command must return exactly one declared status. Use `candidate` on the signed
release commit with verified npm commands, then switch to `published` after registry
confirmation.