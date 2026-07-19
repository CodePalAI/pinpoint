# Pinpoint Session Recorder

The Session Recorder is an optional read-only local dashboard for Pinpoint
provider traffic, MCP gateways, and delegated GitHub Copilot traffic. It is an
operator evidence surface, not a remote observability product or billing system.

## Launch contract

The dashboard is off unless explicitly requested:

```bash
pinpoint dashboard
pinpoint proxy --dashboard
pinpoint wrap copilot --dashboard
pinpoint mcp gateway --dashboard -- your-mcp-server
```

An explicit dashboard launch opens one browser tab. `--no-open` prints the
protected URL instead. The default dashboard address is `127.0.0.1:8790`; an
explicitly requested busy port fails, while the default may move to an available
loopback port.

## Data model

Every event is rebuilt from an exact runtime allowlist before persistence.
Provider events carry counters and stage reason codes. MCP events carry bounded
tool/flow labels, exact byte counts, timing, outcome, and receipt-emitted state.
Headroom samples carry only Copilot-class cumulative deltas, health/version,
attribution quality, provider-reported usage, optional list-price estimate, and
provider-reported quota.

The schema has no fields for prompts, responses, tool arguments/results,
headers, credentials, artifact ids, capabilities, fixed predicates,
commitments, signatures, or receipt bodies. Unknown fields are rejected.

Token estimates, Headroom provider-reported tokens, MCP bytes, quota counts,
and estimated cost remain separate by source, unit, and basis. Shared Headroom
proxies are labeled partial and do not display dollar savings because no
defensible per-agent cost basis exists.

## Persistence

Dashboard-enabled sessions use one mode-0700 group directory and one mode-0600
producer journal per process under `~/.pinpoint/dashboard`. Separate producer
files avoid concurrent writes between a wrapped agent and child Pinpoint MCP
gateways. History is retained for 30 days within a 64 MiB global budget; corrupt
records are isolated rather than poisoning a session. Windows inherits the
user-profile ACLs rather than installing a custom ACL.

The internal group id is non-authorizing metadata. A wrapped agent may inspect
its environment. Pinpoint strips dashboard variables before spawning source and
destination MCP processes and never serializes the group id into MCP results.

## Loopback security

The HTTP server binds only to `127.0.0.1`. It validates the exact Host and
same-origin Origin, exposes authenticated GET APIs only, rejects mutations, has
no CORS, uses no-store responses, and serves a strict CSP with local scripts,
styles, fonts, and connections only. A random 256-bit bearer token is delivered
in the browser URL fragment, removed immediately, retained in that tab's
origin-scoped `sessionStorage` so refresh survives, and required for
snapshot/history/event/SSE APIs. Closing the tab clears it; a new protected URL
replaces a stale token when a server restarts on the same port.

SSE is the low-latency path. A visible tab also reconciles the authoritative
snapshot every two seconds and on focus, visibility, online, and back-forward
cache restoration. Reconciliation requests are single-flight, time-bounded,
and reject regressive or out-of-order snapshots.

This protects against ordinary hostile web pages and DNS rebinding. It does not
protect against another process running as the same operating-system user that
can read process state or the local journal files.