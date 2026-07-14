# Security policy

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** flow in the repository Security tab. Do not open a public issue with exploit details, credentials, private prompts, or raw agent traces. If private reporting is unavailable, open a minimal issue asking the maintainers to establish a private channel and omit technical details.

Expect an acknowledgement within seven days. Maintainers will confirm scope, coordinate a fix and disclosure, and credit reporters who want attribution.

## Supported versions

Security fixes target the latest published release and the `main` branch. Older prerelease versions may require upgrading.

## Deployment boundaries

- Pixroom listens on `127.0.0.1` by default. It is not an authenticated internet-facing gateway; add network isolation and authentication before exposing it beyond a trusted host.
- Provider credentials are forwarded to the configured upstream. They are not sent to the keyless Headroom compression endpoint.
- QCV retains exact tool-result bytes in process memory until LRU eviction or process exit. The default limits are 256 datasets and 64 MiB. QCV does not persist those datasets to disk.
- Exact QCV is enabled only for PAYG, non-streaming Anthropic Messages traffic. OAuth/subscription traffic passes through.
- Model-driven QCV continuation is experimental and disabled by default. Enable it only after evaluating your own traces.
- Audit logs, bug reports, and benchmark fixtures must be sanitized. Treat agent context as potentially secret even when no credential pattern is visible.