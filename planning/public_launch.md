# Pixroom public launch checklist

This is the manual work that code cannot complete. Do the gates in order. A launch date is not a reason to skip one.

The source review and the line between observed patterns and hypotheses are documented in [oss_adoption_research.md](./oss_adoption_research.md).

## Why this launch shape

Breakout AI developer projects repeatedly reduce the path from claim to proof to a runnable result:

- Ollama made the product a command: `ollama run ...`.
- Open WebUI, browser-use, aider, Langfuse, and promptfoo showed the workflow in a short GIF or video before setup detail.
- vLLM, llama.cpp, Unsloth, SGLang, LMCache, and LLMLingua put measured output, hardware or workload scope, and reproduction paths near the claim.
- LiteLLM and mem0 led with a small primitive developers could paste into existing code.
- Mature projects turn releases, model support, integrations, and benchmark updates into repeated launches rather than betting everything on one announcement.

For Pixroom, that means: exact-context position, visible receipt, offline one-command win, explicit boundaries, then SDK and proxy depth.

## Gate 1: independent evidence

- [ ] Give the repository and [reproduction guide](../benchmarks/REPRODUCING.md) to someone who did not author QCV.
- [ ] Ask them to use a clean machine, a separate Anthropic account if possible, the pinned model ID, and at least five seeds.
- [ ] Preserve all labeled preflight, canary, successful, and failed receipts.
- [ ] Record commit, dependency versions, OS, CPU, region, date, model ID, pricing date, task count, run count, retries, and exclusions.
- [ ] Open a benchmark-replication issue and have a second reviewer verify the aggregate directly from raw JSON.
- [ ] Keep the current two-task scope beside the 97.4% number until broader repeated evidence exists.

Do not publish "no quality loss," "97% cheaper," "production proven," or a competitor comparison from the current pilot.

## Gate 2: visual proof

- [ ] Record a 15-25 second terminal demo at 1200x750 or larger, with a readable font and no shell history, username, file path, token, or notification visible.
- [ ] Show `npx pixroom demo` after npm is live. Before npm, show the cloned-checkout install followed by `pixroom demo`.
- [ ] Keep the recording to one story: 1,000 rows, query for ID 733, 13,821 to 171 estimated dataset tokens, exact email, zero model/network calls.
- [ ] Export an MP4 for GitHub upload and a compressed GIF/WebP fallback under 8 MB.
- [ ] Upload the MP4 by dragging it into a temporary GitHub issue comment, copy the `user-attachments` URL, then close the issue.
- [ ] Replace `LAUNCH(demo-video)` in the README with the hosted video URL. Keep `assets/qcv-paid-pilot.svg` as the static preview.
- [ ] Add alt text that states what happens; do not use "demo" as the whole alt text.

Recommended tools: VHS for deterministic terminal capture, or Screen Studio/QuickTime for a real shell recording. Use the real command, not a composited animation.

## Gate 3: public package and repository

- [x] Make `CodePalAI/pixroom` public before publishing npm so provenance and repository links resolve. Verified public on 2026-07-14.
- [ ] Confirm Apache-2.0 ownership, `NOTICE`, upstream attribution, and the security contact with counsel or the responsible owner.
- [x] Add `NPM_TOKEN` to the `release` environment for the bootstrap publication. Verified 2026-07-14.
- [ ] Publish GitHub Release `v0.1.0`; verify the release workflow publishes `pixroom@0.1.0` with provenance.
- [ ] On a clean Node 18, 20, and 22 environment, run `npx pixroom@0.1.0 demo`, import every public subpath, and test `pixroom --help`.
- [ ] Confirm `npm view pixroom version repository.url dist.integrity` points to this repository.
- [ ] Replace all `LAUNCH(npm)` comments in the README. Switch install commands to `npx pixroom demo`, `npm install -g pixroom`, and `npm install pixroom`.
- [ ] Add npm version and weekly-download badges only after the registry data exists.
- [ ] Create a signed `v0.1.0` tag and attach the npm tarball SHA-512/integrity value to the release notes.

## Gate 4: GitHub conversion surface

- [x] Set the About description to: `Exact local context virtualization for AI agents. Stop resending giant JSON, logs, and tool output.` Verified 2026-07-14.
- [x] Set the homepage to `https://codepal.ai` until dedicated docs have a stable domain. Verified 2026-07-14.
- [x] Keep topics focused: `llm`, `ai-agents`, `context-optimization`, `context-compression`, `token-optimization`, `claude-code`, `openai`, `anthropic`, `developer-tools`, `codepal`. Verified 2026-07-14.
- [x] Enable GitHub Discussions with `Q&A`, `Ideas`, and `Show and tell`. Verified 2026-07-14.
- [ ] Add a `Benchmarks` Discussions category in the web UI; GitHub exposes no category-creation API.
- [x] Add the Discussions link to the README. Verified 2026-07-14.
- [x] Publish a welcome discussion with the demo, supported operations, current limits, and a request for sanitized traces and independent replications: [Discussion #2](https://github.com/CodePalAI/pixroom/discussions/2).
- [ ] Pin [Discussion #2](https://github.com/CodePalAI/pixroom/discussions/2) in the web UI; GitHub exposes no pin-discussion API mutation.
- [ ] Create 5-10 scoped `good first issue` items before launch. Prefer protocol fixtures, docs, adapters, and adversarial cases over architecture rewrites.
- [ ] Confirm bug, optimizer, and benchmark-replication issue forms work while logged out of the maintainer account.
- [ ] Add a Code of Conduct only if CodePal is prepared to enforce it and names a private reporting channel.

## Gate 5: real-world proof

- [ ] Recruit three external teams to run shadow mode on sanitized or private traces.
- [ ] Publish an opt-in call for traces that explains body capture risks and recommends local replay instead of uploading prompts.
- [ ] Run at least 10 sanitized Claude Code, Codex, or agent traces with cache effects, retries, retrievals, and full-session cost included.
- [ ] Report match rate: what share of real requests QCV changes, not only savings on changed requests.
- [ ] Report p50/p95 added latency and error rate at concurrency 1 and 10. Keep the measured concurrency-100 limitation visible.
- [ ] Obtain written permission before using any adopter name, logo, quote, or workload description.

## Gate 6: launch sequence

1. Publish the repository, npm package, release notes, and demo. Let links settle before promotion.
2. Post a technical Show HN titled around the mechanism, not the percentage: `Show HN: Pixroom, exact local context virtualization for AI agents`.
3. In the first paragraph, state the problem, two-task scope, offline command, and why this is not summarization.
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

## README placeholder audit

Before launch, this command should return no unresolved placeholder whose gate is complete:

```bash
rg 'LAUNCH\(' README.md
```

An unresolved placeholder is acceptable only when its corresponding capability is still unavailable. Hidden comments are intentional; visible `TODO`, fake badge, fake testimonial, or blank image is not.