# Query-Backed Context Virtualization

## Thesis

Compression asks which bytes can be removed while leaving enough information for the model. Query-Backed Context Virtualization (QCV) changes the contract: a large structured tool result becomes an exact local dataset, and the model receives only the answer surface needed for the current turn.

QCV handles non-recent JSON, line-oriented logs, and source-like tool results on first-party Anthropic Messages, OpenAI Chat, and OpenAI Responses PAYG traffic. Its conservative exact subset is on by default and works with streaming responses because it needs no hidden model round. The Anthropic model-driven query fallback is a separate opt-in experiment and remains non-streaming.

## Data flow

1. The `pinpoint-virtual-context` integration runs before Headroom and pxpipe.
2. Eligible `tool_result` text is inspected without retention under a 128-bit SHA-256-derived capability id.
3. A deterministic planner evaluates the current question without mutating request state or the local store.
4. A conservative planner inspects the current user question:
   - explicit field/value lookup -> exact `json_select` result;
   - explicit filtered count -> exact JSON count;
   - explicit log-level count -> boundary-aware line count;
   - explicit selector across two JSON arrays with exactly one shared primitive key and one row at each hop -> exact one-hop join projection;
   - otherwise -> no prefetch.
5. Default-on QCV selects a candidate only when exactly one single-dataset plan or one two-dataset join path yields a complete exact answer and the transformed request is smaller. Repeated selectors, ranges, negation, duplicate keys, competing datasets, and multiple valid join paths are refused.
6. The transaction validates a cloned request, atomically retains every selected dataset within entry/byte limits, commits stable manifests into Anthropic `tool_result`, OpenAI Chat `role:tool`, or Responses `function_call_output` positions, and appends escaped exact data to the current provider-native user turn.
7. Within exact-query turns, historical manifest bytes depend only on the dataset and configuration, not the selector, preserving that transformed prefix. An ambiguous turn intentionally falls back to the original and can therefore change applicability.
8. Unresolved questions fall through by default. With `PINPOINT_VIRTUAL_QUERY_FALLBACK=1`, pinpoint injects `pinpoint_query`; pure internal calls receive bounded local `schema`, `json_select`, `count`, `grep`, or `slice` results and continue transparently.
9. Headroom and pxpipe remain available for every unclaimed region. QCV owns the dedicated `virtual-context` planner region rather than all tool results.

## Why the default changed

The old `PINPOINT_VIRTUAL_CONTEXT=1` gate covered two materially different designs:

- deterministic exact prefetch, which needs no model planning and has narrow falsifiable safety conditions;
- model-driven retrieval, which adds provider rounds and can fail through planning, truncation, mixed tool ownership, or transport.

Keeping both behind one experimental switch made the safe path unnecessarily hard to adopt and made the risky path look equally validated. The controls now match the actual risk:

- exact QCV defaults on;
- `PINPOINT_VIRTUAL_CONTEXT=0` is the kill switch;
- `PINPOINT_VIRTUAL_QUERY_FALLBACK=1` enables model-driven continuation;
- `--no-qcv` and `--virtual-query-fallback` expose the same split in the CLI.

## Why the naive design failed

The first paid design always exposed a manifest and allowed one hidden model query round. It cut provider input 79.1% but regressed exact score from 2/3 to 1/3. Haiku spent the bounded output budget planning, requesting schema, or emitting incomplete tool-call JSON.

That design was rejected. The repair moved common exact operations out of model planning and into deterministic prefetch. The fallback tool remains only for questions the planner refuses to answer.

## Evidence

Paid Haiku 4.5, two structured fixtures, one randomized pair each:

| Metric | Raw | QCV |
| --- | ---: | ---: |
| Provider input | 22,614 | 594 |
| Modeled cost | $0.022684 | $0.000664 |
| Exact score | 1/2 | 2/2 |

The repaired pilot reduced input 97.4% and cost 97.1%. QCV returned the exact seven-error count where raw Haiku returned five.

The conservative offline benchmark counts an initial optimized request plus one complete uncached fallback continuation even though the safe exact cases need no second provider request. QCV still used 63.7-67.7% fewer tokens than the existing Headroom+pxpipe stack on JSON, logs, and current source text.

A separate 42-task deterministic suite spans JSON lookup, filtered counts, logs, source exports, tabular JSON, nested projections, and one-hop unique-key JSON joins. It produced 42/42 exact materializations, 42/42 virtualizations, and zero fallback tools, with dataset-region estimates reduced from 144,272 to 7,583 tokens. Twenty ambiguous-selector, competing-dataset, unsafe-join, and lossy-number controls were all refused without fallback. This is operation-breadth evidence without provider calls, not live-model quality evidence.

These are small synthetic pilots, not universal quality evidence.

### Repeated and agent evidence

A subsequent paid gate ran 30 synthetic structured-task templates with five independently parameterized variants each. Every one of the 150 variants has a distinct payload, expected answer, task ID, and fixture hash; `raw`, `headroom`, and `qcv` arm order was randomized. Claude Haiku 4.5 used Anthropic Messages; GPT-4.1 mini used OpenAI Chat Completions and Responses. QCV scored 150/150, raw 109/150, and Headroom 112/150. Against Headroom, QCV used 97.2% fewer input tokens and 96.8% lower modeled provider cost; the paired-bootstrap 95% cost-reduction interval was 96.5%-96.9%. There were zero paired harms, yielding an exact one-sided 95% harm upper bound of 1.977%. This passes the predeclared two-point non-inferiority and 25% cost gates for the fixed benchmark population under the stated exchangeability assumption; it is not an organic-traffic bound.

A separate real-agent gate ran five Claude Code and five Codex CLI sessions in disposable synthetic repositories. The grader parsed only Claude's final `result` or Codex's last `agent_message`; all returned the single correct email value. All minimized sanitized derivatives replayed hash-identically, stable cache shape and four long/join sessions were observed, and one injected provider POST failure per agent was retried successfully. Claude Code exercised QCV over sequential line-numbered `Read` output. Codex queried sub-threshold chunks locally and correctly remained pass-through. These are first-party controlled agent sessions, not customer production traces.

## Related work

- **Headroom CCR** and **pxpipe recoverable images** retain whole originals for retrieval. QCV adds bounded data operations and question-conditioned exact prefetch.
- **LeanCTX** is the closest adjacent system found. It archives exact output, exposes `ctx_expand` with JSON/search recovery, and has task/query-conditioned read modes. QCV differs in its drop-in wire behavior: it virtualizes arbitrary intercepted provider `tool_result`s, performs deterministic exact prefetch directly from the current question, suppresses the query tool when resolved, and transparently continues unresolved Anthropic calls inside a transactional multi-optimizer plan.
- **Letta/MemGPT** virtualizes long-term memory and files behind agent tools. It is an agent architecture rather than a drop-in optimizer for arbitrary existing agent traffic.
- **Mem0** retrieves semantic memories and injects them into prompts; it does not virtualize exact transient tool-result datasets.
- **RTK** and specialized context tools reduce output at the tool boundary. QCV operates on already-produced results from any tool visible on the provider wire.

The ingredients have prior art. The current claim is a distinct integration and a breakthrough-candidate result, not proof that every component is novel.

## Safety boundaries

- deterministic exact subset enabled by default; `PINPOINT_VIRTUAL_CONTEXT=0` is the kill switch;
- model-driven fallback disabled by default (`PINPOINT_VIRTUAL_QUERY_FALLBACK=1` opts in);
- PAYG only; OAuth/subscription pass through;
- deterministic exact prefetch supports streaming; model-driven fallback is non-streaming;
- minimum 6,000 and maximum 2,000,000 characters per dataset by default;
- at most 8 datasets per request, 256 retained datasets, 64 MiB retained bytes, and 12,000 characters per query result by default;
- proposal and shadow analysis retain no data; storage occurs only inside transaction commit;
- 128-bit SHA-256-derived ids with full-digest collision fallback;
- model-driven queries receive only request-scoped dataset capabilities;
- model-visible field names and exact values are delimiter-escaped and labeled as data;
- ambiguous questions do not get speculative prefetch and multiple exact candidate datasets fall through;
- exact joins require one explicit equality selector, one unique shared primitive key, one matching source row, one matching destination row, and a bounded complete projection;
- selectors or projected values containing integers outside JavaScript's exact JSON range fall through instead of returning rounded data;
- historical manifests are independent of the current question;
- hidden query rounds are capped;
- invalid query inputs are rejected structurally;
- encoded responses remain byte-faithful and are not inspected;
- mixed internal/client tool calls, continuation transport failures, invalid continuation responses, and round-cap exhaustion replay the original unvirtualized request;
- unmodified routed bodies preserve the original request bytes.

## Next evidence gates

1. Repeat at least 30 live-model structured tasks with randomized arm order and confidence intervals.
2. Demonstrate quality non-inferiority within two percentage points versus raw and Headroom-only.
3. Replay sanitized Claude Code/Codex traces with cache reads/writes, retries, and repeated turns using durable capture.
4. Validate provider conformance and soak behavior for synthesized Anthropic/OpenAI continuation streams.
5. Expand beyond one-hop one-to-one joins only when new operations preserve the current duplicate-key and competing-path refusals.