import {
  Activity,
  Archive,
  Cable,
  Database,
  Gauge,
  History,
  LockKeyhole,
  Radio,
  RefreshCw,
  Route,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
} from 'lucide';

import type {
  DashboardEvent,
  DashboardHistorySession,
  DashboardSnapshot,
  DashboardTokenLane,
} from '../../src/dashboard/types.js';

import './styles.css';

type IconNode = readonly (readonly [string, Readonly<Record<string, string | number | undefined>>])[];
type ViewName = 'live' | 'requests' | 'mcp' | 'history' | 'system';
type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'unauthorized';

interface AppState {
  token: string | null;
  snapshot: DashboardSnapshot | null;
  history: readonly DashboardHistorySession[];
  connection: ConnectionState;
  view: ViewName;
  error: string | null;
  retryMs: number;
  retryTimer: number | null;
  streamController: AbortController | null;
}

const app = document.querySelector<HTMLDivElement>('#app') ?? (() => {
  throw new Error('dashboard root not found');
})();

const views: readonly { readonly id: ViewName; readonly label: string; readonly icon: IconNode }[] = [
  { id: 'live', label: 'Live', icon: Activity },
  { id: 'requests', label: 'Requests', icon: Route },
  { id: 'mcp', label: 'MCP', icon: Cable },
  { id: 'history', label: 'History', icon: History },
  { id: 'system', label: 'System', icon: ServerCog },
];

const state: AppState = {
  token: readToken(),
  snapshot: null,
  history: [],
  connection: 'connecting',
  view: readView(),
  error: null,
  retryMs: 1_000,
  retryTimer: null,
  streamController: null,
};

function readToken(): string | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = hash.get('access_token');
  if (token) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token;
}

function readView(): ViewName {
  const value = new URLSearchParams(location.search).get('view');
  return views.some(({ id }) => id === value) ? value as ViewName : 'live';
}

function icon(node: IconNode, label?: string): string {
  const children = node.map(([tag, attributes]) => {
    const attrs = Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`)
      .join(' ');
    return `<${tag} ${attrs}></${tag}>`;
  }).join('');
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}>${children}</svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 100_000 ? 'compact' : 'standard' })
    .format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
    .format(value);
}

function formatTime(value: string | null): string {
  if (!value) return 'No activity';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function sourceLabel(source: string): string {
  if (source === 'headroom') return 'Copilot / Headroom';
  if (source === 'mcp') return 'MCP firewall';
  return 'Pinpoint runtime';
}

function statusLabel(): string {
  if (state.connection === 'unauthorized') return 'Access required';
  if (state.connection === 'reconnecting') return 'Reconnecting';
  if (state.connection === 'connecting') return 'Connecting';
  return state.snapshot?.state === 'degraded' ? 'Degraded' : state.snapshot?.state === 'ended' ? 'Session ended' : 'Recording';
}

function statusTone(): string {
  if (state.connection === 'unauthorized') return 'danger';
  if (state.connection !== 'live' || state.snapshot?.state === 'degraded') return 'warning';
  if (state.snapshot?.state === 'ended') return 'muted';
  return 'live';
}

function render(): void {
  const snapshot = state.snapshot;
  app.innerHTML = `
    <div class="app-shell">
      <header class="masthead">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div>
            <p class="eyebrow">PINPOINT / LOCAL OPERATOR PLANE</p>
            <h1>Session Recorder</h1>
          </div>
        </div>
        <div class="session-state" data-tone="${statusTone()}">
          <span class="state-light" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(statusLabel())}</strong>
            <span>${snapshot ? `Updated ${escapeHtml(formatTime(snapshot.generatedAt))}` : 'Waiting for local telemetry'}</span>
          </div>
        </div>
      </header>
      ${renderNavigation()}
      <main id="main" tabindex="-1">
        ${state.error ? renderAlert(state.error) : ''}
        ${snapshot ? renderView(snapshot) : renderWaiting()}
      </main>
    </div>
  `;
  bindInteractions();
}

function renderNavigation(): string {
  return `
    <nav class="view-nav" aria-label="Dashboard views">
      <div class="view-tabs" role="tablist">
        ${views.map(({ id, label, icon: iconNode }) => `
          <button type="button" role="tab" aria-selected="${state.view === id}" data-view="${id}" class="view-tab${state.view === id ? ' is-active' : ''}">
            ${icon(iconNode)}<span>${label}</span>
          </button>
        `).join('')}
      </div>
      <div class="privacy-lock" title="Metadata only. No prompt, response, or tool values are stored.">
        ${icon(LockKeyhole)}<span>Metadata only</span>
      </div>
    </nav>
  `;
}

function renderAlert(message: string): string {
  return `<div class="alert" role="status">${icon(Radio)}<span>${escapeHtml(message)}</span><button type="button" data-action="retry">${icon(RefreshCw)}<span>Retry</span></button></div>`;
}

function renderWaiting(): string {
  const unauthorized = state.connection === 'unauthorized';
  return `
    <section class="waiting-state" aria-labelledby="waiting-title">
      <div class="waiting-signal">${icon(unauthorized ? LockKeyhole : Radio)}</div>
      <p class="eyebrow">${unauthorized ? 'AUTHENTICATION' : 'LOCAL STREAM'}</p>
      <h2 id="waiting-title">${unauthorized ? 'Open the protected dashboard URL again' : 'Listening for the first evidence event'}</h2>
      <p>${unauthorized
        ? 'The access token is kept only in this tab memory and was not present in the current URL.'
        : 'Pinpoint will populate this recorder when the wrapped proxy or MCP gateway handles work.'}</p>
    </section>
  `;
}

function renderView(snapshot: DashboardSnapshot): string {
  if (state.view === 'requests') return renderRequests(snapshot);
  if (state.view === 'mcp') return renderMcp(snapshot);
  if (state.view === 'history') return renderHistory();
  if (state.view === 'system') return renderSystem(snapshot);
  return renderLive(snapshot);
}

function renderLive(snapshot: DashboardSnapshot): string {
  const singleLane = snapshot.tokenLanes.length === 1 ? snapshot.tokenLanes[0] : null;
  const providerEvents = snapshot.recentEvents
    .filter((event) => event.type === 'provider.route')
    .slice(-12)
    .reverse();
  const mcpRetained = snapshot.byteLanes.reduce((total, lane) => total + lane.bytesRetained, 0);
  return `
    <section class="live-layout" aria-labelledby="live-title">
      <div class="trace-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">LIVE CONTEXT TRACE</p>
            <h2 id="live-title">What entered. What crossed.</h2>
          </div>
          <span class="basis-note">Lanes stay separate by counting basis</span>
        </div>
        <div class="trace-total">
          <div><span>${singleLane ? 'Observed before' : 'Measurement lanes'}</span><strong>${singleLane ? formatNumber(singleLane.tokensText) : formatNumber(snapshot.tokenLanes.length)}</strong><small>${singleLane ? 'tokens' : 'source-qualified'}</small></div>
          <div class="trace-direction" aria-hidden="true"><span></span>${icon(Route)}<span></span></div>
          <div><span>${singleLane ? 'Sent onward' : 'Aggregation'}</span><strong>${singleLane ? formatNumber(singleLane.tokensSent) : 'Separated'}</strong><small>${singleLane ? 'tokens' : 'by source + basis'}</small></div>
        </div>
        <div class="lane-stack">
          ${snapshot.tokenLanes.length > 0
            ? snapshot.tokenLanes.map(renderLane).join('')
            : '<div class="inline-empty">No token-bearing route events yet.</div>'}
        </div>
      </div>
      <aside class="evidence-strip" aria-label="Verified session totals">
        <p class="eyebrow">SESSION EVIDENCE</p>
        ${renderEvidenceValue('Requests', snapshot.requests, 'observed')}
        ${renderEvidenceValue('Token lanes', snapshot.tokenLanes.length, 'never merged across bases')}
        ${renderEvidenceValue('MCP bytes retained', formatNumber(mcpRetained), 'exact-byte basis')}
        ${renderEvidenceValue('Reversible handles', snapshot.reversibleCount, 'count only')}
        <div class="source-register">
          <span>Sources</span>
          ${snapshot.sources.length > 0 ? snapshot.sources.map((source) => `
            <div class="source-row"><i data-state="${source.state}"></i><strong>${escapeHtml(sourceLabel(source.source))}</strong><small>${source.producers} producer${source.producers === 1 ? '' : 's'}</small></div>
          `).join('') : '<small>No active sources</small>'}
        </div>
      </aside>
      ${snapshot.headroom ? renderCopilotPanel(snapshot) : ''}
      <div class="ledger-panel">
        ${renderLedgerHeading('Provider request ledger', providerEvents.length)}
        ${renderEventTable(providerEvents)}
      </div>
    </section>
  `;
}

function renderCopilotPanel(snapshot: DashboardSnapshot): string {
  const headroom = snapshot.headroom;
  if (!headroom) return '';
  const quota = headroom.quota.find((item) => item.category === 'premium_interactions') ?? headroom.quota[0];
  const costValue = headroom.costSaved?.value;
  return `
    <section class="copilot-panel" aria-labelledby="copilot-title">
      <div class="copilot-heading">
        <div>${icon(TerminalSquare)}<div><p class="eyebrow">COPILOT / HEADROOM SOURCE</p><h2 id="copilot-title">${escapeHtml(headroom.model ?? 'GitHub Copilot')}</h2></div></div>
        <span class="attribution-badge" data-attribution="${headroom.attribution}">${headroom.attribution === 'shared' ? 'Partial attribution / shared proxy' : 'Dedicated proxy / session delta'}</span>
      </div>
      <div class="copilot-register">
        ${renderEvidenceValue('Headroom status', headroom.healthy ? 'Healthy' : 'Unavailable', headroom.version ? `v${headroom.version}` : 'version unavailable')}
        ${renderEvidenceValue('Output usage', formatNumber(headroom.outputTokens), 'provider-reported tokens')}
        ${renderEvidenceValue('Estimated savings', costValue == null ? 'Unavailable' : formatCurrency(costValue), costValue == null ? 'no defensible per-agent cost basis' : 'Headroom list-price estimate')}
        ${renderEvidenceValue('Coverage', headroom.coverage.replaceAll('-', ' '), headroom.attribution === 'shared' ? 'Copilot-class traffic since attach' : 'fresh proxy counters')}
        ${quota
          ? renderEvidenceValue(
              quota.category.replaceAll('_', ' '),
              quota.unlimited ? 'Unlimited' : quota.remaining == null ? 'Reported' : `${formatNumber(quota.remaining)} remaining`,
              quota.usedPercent == null ? 'provider quota' : `${formatPercent(quota.usedPercent)} used`,
            )
          : renderEvidenceValue('Provider quota', 'Unavailable', 'not reported by Headroom')}
      </div>
    </section>
  `;
}

function renderLane(lane: DashboardTokenLane): string {
  const ratio = lane.tokensText > 0 ? Math.max(0, Math.min(100, lane.tokensSent / lane.tokensText * 100)) : 0;
  const saved = lane.tokensText > 0 ? lane.tokensSaved / lane.tokensText * 100 : 0;
  return `
    <article class="trace-lane">
      <div class="lane-label">
        <span>${escapeHtml(sourceLabel(lane.source))}</span>
        <small>${escapeHtml(lane.basis)}</small>
      </div>
      <progress class="lane-rail" value="${ratio.toFixed(2)}" max="100" aria-label="${escapeHtml(sourceLabel(lane.source))}: ${formatNumber(lane.tokensText)} before, ${formatNumber(lane.tokensSent)} sent"></progress>
      <div class="lane-values">
        <strong>${formatNumber(lane.tokensText)}</strong>
        <span>${formatNumber(lane.tokensSent)} sent</span>
        <em>${lane.tokensSaved >= 0 ? '+' : ''}${formatNumber(lane.tokensSaved)} / ${formatPercent(saved)}</em>
      </div>
    </article>
  `;
}

function renderEvidenceValue(label: string, value: string | number, note: string): string {
  return `<div class="evidence-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

function renderLedgerHeading(title: string, count: number): string {
  return `<div class="section-heading compact"><div><p class="eyebrow">CHRONOLOGICAL / CONTENT-FREE</p><h2>${escapeHtml(title)}</h2></div><span class="count-label">${count} event${count === 1 ? '' : 's'}</span></div>`;
}

function renderEventTable(events: readonly DashboardEvent[]): string {
  if (events.length === 0) return '<div class="table-empty">No matching evidence events.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Time</th><th scope="col">Source</th><th scope="col">Route</th><th scope="col">Before</th><th scope="col">Sent</th><th scope="col">Saved</th><th scope="col">Basis</th><th scope="col">Result</th></tr></thead>
        <tbody>${events.map((event) => {
          if (event.type !== 'provider.route') return '';
          const applied = event.stages.filter((stage) => stage.applied).map((stage) => stage.stage);
          return `<tr>
            <td><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatTime(event.occurredAt))}</time></td>
            <td><span class="source-code">${escapeHtml(event.source)}</span></td>
            <td><strong title="${escapeHtml(event.model ?? 'Unknown model')}">${escapeHtml(event.provider)}</strong><small>${escapeHtml(event.model ?? 'Unknown model')}</small></td>
            <td class="numeric">${formatNumber(event.tokensText.value)}</td>
            <td class="numeric">${formatNumber(event.tokensCompressed.value)}</td>
            <td class="numeric ${event.tokensSaved.value < 0 ? 'negative' : 'positive'}">${event.tokensSaved.value >= 0 ? '+' : ''}${formatNumber(event.tokensSaved.value)}</td>
            <td><span class="basis-chip">${escapeHtml(event.tokensSaved.basis)}</span></td>
            <td>${applied.length > 0 ? escapeHtml(applied.join(' + ')) : 'Pass-through'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderRequests(snapshot: DashboardSnapshot): string {
  const events = snapshot.recentEvents.filter((event) => event.type === 'provider.route').slice().reverse();
  return `<section class="full-panel">${renderLedgerHeading('Provider requests', events.length)}${renderEventTable(events)}</section>`;
}

function renderMcp(snapshot: DashboardSnapshot): string {
  const mcp = snapshot.sources.find((source) => source.source === 'mcp');
  const byteLane = snapshot.byteLanes.find((lane) => lane.source === 'mcp');
  const retainedPercent = byteLane && byteLane.bytesBefore > 0
    ? byteLane.bytesRetained / byteLane.bytesBefore * 100
    : 0;
  const events = snapshot.recentEvents
    .filter((event) => event.type.startsWith('mcp.'))
    .slice(-20)
    .reverse();
  return `
    <section class="mcp-layout">
      <div class="section-heading"><div><p class="eyebrow">MCP RESULT FIREWALL</p><h2>MCP evidence boundary</h2></div><span class="basis-note">No tool values, capabilities, or receipts stored</span></div>
      ${mcp ? `
        <div class="mcp-trace">
          <div class="mcp-byte-hero">
            <p class="eyebrow">MODEL-VISIBLE RESULT BYTES</p>
            <div class="mcp-byte-values">
              <div><span>Upstream produced</span><strong>${formatNumber(byteLane?.bytesBefore ?? 0)}</strong><small>exact bytes</small></div>
              <div class="trace-direction" aria-hidden="true"><span></span>${icon(Route)}<span></span></div>
              <div><span>Host received</span><strong>${formatNumber(byteLane?.bytesVisible ?? 0)}</strong><small>visible bytes</small></div>
            </div>
            <progress class="retention-rail" value="${Math.max(0, Math.min(100, retainedPercent)).toFixed(2)}" max="100" aria-label="${formatPercent(retainedPercent)} of MCP result bytes retained outside model context"></progress>
            <p>${formatNumber(byteLane?.bytesRetained ?? 0)} bytes retained outside model context / ${formatPercent(retainedPercent)}</p>
          </div>
          <div class="mcp-register">
            ${renderEvidenceValue('Tool calls', snapshot.mcp.toolCalls, `${snapshot.mcp.succeeded} succeeded`)}
            ${renderEvidenceValue('Virtualized results', byteLane?.virtualizedResults ?? 0, 'exact-byte basis')}
            ${renderEvidenceValue('Queries', snapshot.mcp.queries, `${snapshot.mcp.failed} failed`)}
            ${renderEvidenceValue('Opaque flows', snapshot.mcp.flows, `${snapshot.mcp.receiptsEmitted} signed receipts emitted`)}
            ${renderEvidenceValue('Denied actions', snapshot.mcp.denied, 'policy boundary')}
            ${renderEvidenceValue('Last activity', formatTime(mcp.lastActivityAt), mcp.state)}
          </div>
        </div>
        <div class="mcp-ledger">
          ${renderLedgerHeading('MCP evidence ledger', events.length)}
          ${renderMcpEventTable(events)}
        </div>
      ` : `
        <div class="domain-empty">
          ${icon(Cable)}<h3>No MCP gateway attached</h3>
          <p>Launch a gateway with <code>pinpoint mcp gateway --dashboard -- &lt;command&gt;</code> or inherit this session from a wrapped agent.</p>
        </div>
      `}
    </section>
  `;
}

function renderMcpEventTable(events: readonly DashboardEvent[]): string {
  if (events.length === 0) return '<div class="table-empty">No MCP evidence events yet.</div>';
  return `
    <div class="table-wrap">
      <table class="mcp-table">
        <thead><tr><th>Time</th><th>Event</th><th>Subject</th><th>Outcome</th><th>Measured</th><th>Basis</th></tr></thead>
        <tbody>${events.map((event) => {
          if (event.type === 'mcp.result') return `<tr><td>${escapeHtml(formatTime(event.occurredAt))}</td><td>Result</td><td><strong>${escapeHtml(event.tool)}</strong><small>${escapeHtml(event.artifactKind ?? 'pass-through')}</small></td><td class="${event.outcome === 'succeeded' ? 'positive' : event.outcome === 'denied' ? 'negative' : ''}">${event.outcome}</td><td class="numeric">${formatNumber(event.bytesBefore.value)} → ${formatNumber(event.bytesVisible.value)}</td><td><span class="basis-chip">exact-bytes</span></td></tr>`;
          if (event.type === 'mcp.query') return `<tr><td>${escapeHtml(formatTime(event.occurredAt))}</td><td>Query</td><td><strong>${escapeHtml(event.operation)}</strong><small>bounded local operation</small></td><td class="${event.outcome === 'succeeded' ? 'positive' : 'negative'}">${event.outcome}</td><td class="numeric">${formatNumber(event.resultBytes.value)} B</td><td><span class="basis-chip">exact-bytes</span></td></tr>`;
          if (event.type === 'mcp.flow') return `<tr><td>${escapeHtml(formatTime(event.occurredAt))}</td><td>Opaque flow</td><td><strong>${escapeHtml(event.flow)}</strong><small>${escapeHtml(event.sourceTool)} → ${escapeHtml(event.destinationTool)}</small></td><td class="${event.outcome === 'succeeded' ? 'positive' : 'negative'}">${event.outcome}</td><td class="numeric">${formatNumber(event.items)} items / ${formatNumber(event.payloadBytes.value)} B</td><td><span class="basis-chip">signed receipt</span></td></tr>`;
          if (event.type === 'mcp.tool') return `<tr><td>${escapeHtml(formatTime(event.occurredAt))}</td><td>Tool</td><td><strong>${escapeHtml(event.tool)}</strong><small>arguments excluded</small></td><td class="${event.outcome === 'succeeded' ? 'positive' : 'negative'}">${event.outcome}</td><td class="numeric">${event.durationMs.toFixed(1)} ms</td><td><span class="basis-chip">measured</span></td></tr>`;
          return `<tr><td>${escapeHtml(formatTime(event.occurredAt))}</td><td>Lifecycle</td><td><strong>${event.type === 'mcp.lifecycle' ? escapeHtml(event.state) : 'MCP'}</strong><small>local gateway</small></td><td>observed</td><td class="numeric">—</td><td><span class="basis-chip">metadata</span></td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderHistory(): string {
  return `
    <section class="history-layout">
      <div class="section-heading"><div><p class="eyebrow">LOCAL METADATA HISTORY</p><h2>Recorded sessions</h2></div><span class="basis-note">30-day bounded retention</span></div>
      ${state.history.length > 0 ? `<div class="history-list">${state.history.map((session) => `
        <article class="history-row">
          <div class="history-status" data-state="${session.state}"></div>
          <div><strong>${escapeHtml(formatDateTime(session.startedAt))}</strong><span>${escapeHtml(session.sources.map(sourceLabel).join(' + ') || 'No source')}</span></div>
          <div><strong>${formatNumber(session.requests)}</strong><span>requests</span></div>
          <div><strong>${escapeHtml(formatDateTime(session.lastActivityAt))}</strong><span>last activity</span></div>
          <div class="history-id">${escapeHtml(session.groupId.slice(0, 17))}</div>
        </article>
      `).join('')}</div>` : '<div class="domain-empty">' + icon(Archive) + '<h3>No durable history yet</h3><p>Dashboard-enabled sessions appear here after their first metadata event.</p></div>'}
    </section>
  `;
}

function renderSystem(snapshot: DashboardSnapshot): string {
  return `
    <section class="system-layout">
      <div class="section-heading"><div><p class="eyebrow">SYSTEM / TRUST BOUNDARY</p><h2>Local recorder state</h2></div><span class="basis-note">Read-only control plane</span></div>
      <div class="system-grid">
        <article>${icon(TerminalSquare)}<span>Session</span><strong>${escapeHtml(snapshot.groupId.slice(0, 22))}</strong><small>${snapshot.state}</small></article>
        <article>${icon(Database)}<span>Metadata records</span><strong>${formatNumber(snapshot.recentEvents.length)}</strong><small>${snapshot.corruptRecords} isolated corrupt records</small></article>
        <article>${icon(Gauge)}<span>Counting lanes</span><strong>${formatNumber(snapshot.tokenLanes.length)}</strong><small>Never merged across bases</small></article>
        <article>${icon(ShieldCheck)}<span>Transport</span><strong>Loopback only</strong><small>Bearer-protected, no mutation routes</small></article>
      </div>
      <div class="privacy-manifest">
        <div>${icon(ShieldCheck)}<div><p class="eyebrow">STRUCTURALLY EXCLUDED</p><h3>What this recorder never stores</h3></div></div>
        <ul>${snapshot.privacy.neverStored.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="source-table">
        <h3>Attached sources</h3>
        ${snapshot.sources.length > 0 ? snapshot.sources.map((source) => `<div><span>${escapeHtml(sourceLabel(source.source))}</span><strong>${source.state}</strong><small>${escapeHtml(formatDateTime(source.lastActivityAt))}</small></div>`).join('') : '<p>No sources attached.</p>'}
      </div>
    </section>
  `;
}

function bindInteractions(): void {
  for (const element of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    element.addEventListener('click', () => setView(element.dataset.view as ViewName));
  }
  document.querySelector<HTMLButtonElement>('[data-action="retry"]')?.addEventListener('click', () => {
    state.retryMs = 1_000;
    void connect();
  });
}

function setView(view: ViewName): void {
  state.view = view;
  const url = new URL(location.href);
  if (view === 'live') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  history.replaceState(null, '', `${url.pathname}${url.search}`);
  render();
  if (view === 'history') void loadHistory();
}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!state.token) throw new Error('missing_access_token');
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${state.token}` },
    cache: 'no-store',
    signal,
  });
  if (response.status === 401) throw new Error('unauthorized');
  if (!response.ok) throw new Error(`request_failed_${response.status}`);
  return response.json() as Promise<T>;
}

async function loadHistory(): Promise<void> {
  try {
    const payload = await api<{ sessions: DashboardHistorySession[] }>('/api/v1/history');
    state.history = payload.sessions;
    if (state.view === 'history') render();
  } catch {
    // The live recorder stays useful if history is temporarily unavailable.
  }
}

function scheduleReconnect(): void {
  if (state.retryTimer != null || document.hidden || state.connection === 'unauthorized') return;
  state.connection = 'reconnecting';
  render();
  state.retryTimer = window.setTimeout(() => {
    state.retryTimer = null;
    void connect();
  }, state.retryMs);
  state.retryMs = Math.min(15_000, state.retryMs * 2);
}

async function readSse(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error('stream_body_missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream_ended');
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) break;
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (event === 'snapshot' && data.length > 0) {
        state.snapshot = JSON.parse(data.join('\n')) as DashboardSnapshot;
        state.connection = 'live';
        state.error = null;
        state.retryMs = 1_000;
        render();
      }
    }
  }
}

async function connect(): Promise<void> {
  state.streamController?.abort();
  if (!state.token) {
    state.connection = 'unauthorized';
    state.error = null;
    render();
    return;
  }
  const controller = new AbortController();
  state.streamController = controller;
  state.connection = state.snapshot ? 'reconnecting' : 'connecting';
  state.error = null;
  render();
  try {
    state.snapshot = await api<DashboardSnapshot>('/api/v1/snapshot', controller.signal);
    state.connection = 'live';
    render();
    void loadHistory();
    const response = await fetch('/api/v1/stream', {
      headers: { authorization: `Bearer ${state.token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('unauthorized');
    if (!response.ok) throw new Error(`stream_failed_${response.status}`);
    await readSse(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unauthorized' || message === 'missing_access_token') {
      state.connection = 'unauthorized';
      state.error = null;
      render();
      return;
    }
    state.error = 'The local event stream paused. Existing evidence remains available while Pinpoint reconnects.';
    scheduleReconnect();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.retryTimer != null) window.clearTimeout(state.retryTimer);
    state.retryTimer = null;
    return;
  }
  if (state.connection !== 'live') void connect();
});

window.addEventListener('popstate', () => {
  state.view = readView();
  render();
});

render();
void connect();