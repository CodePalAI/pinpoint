# Security policy

Pinpoint is maintained by [CodePal](https://codepal.ai).

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** flow in the repository Security tab. Do not open a public issue with exploit details, credentials, private prompts, or raw agent traces. If private reporting is unavailable, email [support@codepal.ai](mailto:support@codepal.ai) to request a private channel and omit technical details from the first message.

Expect an acknowledgement within seven days. Maintainers will confirm scope, coordinate a fix and disclosure, and credit reporters who want attribution.

## Supported versions

Security fixes target the latest published release and the `main` branch. Older prerelease versions may require upgrading.

## Deployment boundaries

- Pinpoint listens on `127.0.0.1` by default. It is not an authenticated internet-facing gateway; add network isolation and authentication before exposing it beyond a trusted host.
- Provider credentials are forwarded to the configured upstream. They are not sent to the keyless Headroom compression endpoint.
- QCV retains exact tool-result bytes in process memory until LRU eviction or process exit. The default limits are 256 datasets and 64 MiB. QCV does not persist those datasets to disk.
- Inline reversible originals are independently bounded to 1,000 entries or 64 MiB, expire after 30 minutes, and are cleared at shutdown. A transform rolls back if its own reversible batch cannot fit.
- Managed Headroom children bind to `127.0.0.1`, run stateless with in-memory CCR, and do not inherit provider credential variables. An operator-configured external `PINPOINT_HEADROOM_URL` is a separate trust boundary: selected compression content is sent there and its retention policy applies.
- Exact QCV is enabled only for PAYG Anthropic Messages and OpenAI Chat/Responses traffic. OAuth/subscription traffic passes through. Exact prefetch may be used with streaming responses; model-driven fallback may not.
- Model-driven QCV continuation is experimental and disabled by default. Enable it only after evaluating your own traces.
- Durable capture is disabled by default. Metadata-only capture excludes request bodies. `PINPOINT_CAPTURE_BODIES=1` stores private prompt/tool content in a mode-0600 local file and should be used only on trusted storage.
- OTLP spans contain bounded machine codes and token counters, never request/response bodies or arbitrary integration exception text. Collector headers may contain credentials and must not be logged or committed.
- Audit logs, bug reports, and benchmark fixtures must be sanitized. Treat agent context as potentially secret even when no credential pattern is visible.