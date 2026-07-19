import {
  Activity,
  Archive,
  ArrowDownToLine,
  BadgeCheck,
  Braces,
  Cable,
  CheckCircle2,
  ChevronDown,
  Database,
  EyeOff,
  Gauge,
  History,
  LockKeyhole,
  Radio,
  RefreshCw,
  Route,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  ShieldAlert,
  TerminalSquare,
  TriangleAlert,
} from 'lucide';

import type {
  DashboardEvent,
  DashboardHistorySession,
  DashboardSnapshot,
  DashboardTokenLane,
} from '../../src/dashboard/types.js';
import {
  isIdleHeadroomSample,
  selectVisibleEvidenceEvents,
  selectVisibleTokenLanes,
} from './evidence.js';
import { clearDashboardToken, readDashboardToken } from './session-auth.js';
import { compareDashboardSnapshots } from './snapshot-sync.js';

import './styles.css';

type IconNode = readonly (readonly [string, Readonly<Record<string, string | number | undefined>>])[];
type ViewName = 'live' | 'requests' | 'mcp' | 'history' | 'system';
type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'unauthorized';
type RequestProviderFilter = 'all' | 'openai' | 'anthropic';
type RequestOutcomeFilter = 'all' | 'applied' | 'passthrough' | 'negative';

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
  reconcileTimer: number | null;
  lastSynchronizedAt: number | null;
  reconcileInFlight: boolean;
  requestQuery: string;
  requestProvider: RequestProviderFilter;
  requestOutcome: RequestOutcomeFilter;
  selectedRequest: string | null;
  selectedHistoryGroup: string | null;
  historySnapshot: DashboardSnapshot | null;
  historyLoading: boolean;
  historyError: string | null;
  historyIndexError: string | null;
}

const app = document.querySelector<HTMLDivElement>('#app') ?? (() => {
  throw new Error('dashboard root not found');
})();

const unavailableTokenStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
const tokenStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return unavailableTokenStorage;
  }
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
  reconcileTimer: null,
  lastSynchronizedAt: null,
  reconcileInFlight: false,
  requestQuery: '',
  requestProvider: 'all',
  requestOutcome: 'all',
  selectedRequest: null,
  selectedHistoryGroup: null,
  historySnapshot: null,
  historyLoading: false,
  historyError: null,
  historyIndexError: null,
};

let pendingSnapshot: DashboardSnapshot | null = null;
let snapshotScheduled = false;

function readToken(): string | null {
  const result = readDashboardToken(location.hash, tokenStorage);
  if (result.consumedHash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return result.token;
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

function formatBytes(value: number): string {
  if (value < 1_000) return `${formatNumber(value)} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} KB`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)} MB`;
}

function formatDuration(value: number | null): string {
  if (value == null) return 'Unknown duration';
  if (value < 1_000) return `${Math.round(value)} ms`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
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

function eventKey(event: DashboardEvent): string {
  return `${event.type}:${event.occurredAt}`;
}

function activeSourceCount(snapshot: DashboardSnapshot): number {
  return snapshot.sources.filter(({ state }) => state === 'active').length;
}

function attentionCount(snapshot: DashboardSnapshot): number {
  const degraded = snapshot.sources.filter(({ state }) => state === 'degraded').length;
  return degraded + snapshot.corruptRecords + snapshot.mcp.failed + snapshot.negativeSavingsRoutes;
}

function sessionVerdict(snapshot: DashboardSnapshot): {
  readonly tone: 'clear' | 'attention' | 'ended';
  readonly title: string;
  readonly detail: string;
} {
  const attention = attentionCount(snapshot);
  if (attention > 0) {
    return {
      tone: 'attention',
      title: `${snapshot.state === 'ended' ? 'Session ended with' : 'Session has'} ${attention} signal${attention === 1 ? '' : 's'} requiring review`,
      detail: 'Inspect degraded sources, failed MCP operations, corrupt records, and negative-savings routes below.',
    };
  }
  if (snapshot.state === 'ended') {
    return {
      tone: 'ended',
      title: 'Session closed with evidence intact',
      detail: `${snapshot.requests} provider requests and ${snapshot.eventCount} metadata events remain available locally.`,
    };
  }
  return {
    tone: 'clear',
    title: 'All observed paths are clear',
    detail: `${activeSourceCount(snapshot)} sources reporting. No failed MCP operation, corrupt record, or negative-savings route observed.`,
  };
}

interface TapeEntry {
  readonly title: string;
  readonly detail: string;
  readonly measure: string;
  readonly basis: string;
  readonly tone: 'clear' | 'info' | 'attention' | 'muted';
  readonly icon: IconNode;
}

function describeEvent(event: DashboardEvent): TapeEntry {
  if (event.type === 'provider.route') {
    const applied = event.stages.filter(({ applied }) => applied).map(({ stage }) => stage);
    const negative = event.tokensSaved.value < 0;
    return {
      title: `${event.provider === 'openai' ? 'OpenAI' : 'Anthropic'} route ${applied.length > 0 ? 'optimized' : 'passed through'}`,
      detail: `${event.model ?? 'Unknown model'} · ${applied.join(' + ') || event.stages.map(({ reason }) => reason).join(' + ') || 'no transform'}`,
      measure: `${formatNumber(event.tokensText.value)} → ${formatNumber(event.tokensCompressed.value)} tokens`,
      basis: event.tokensSaved.basis,
      tone: negative ? 'attention' : applied.length > 0 ? 'clear' : 'muted',
      icon: applied.length > 0 ? ArrowDownToLine : Route,
    };
  }
  if (event.type === 'mcp.result') {
    const retained = event.bytesBefore.value - event.bytesVisible.value;
    return {
      title: event.virtualized ? `${event.tool} held outside context` : `${event.tool} passed through`,
      detail: `${event.artifactKind ?? 'result'}${event.artifactItems == null ? '' : ` · ${formatNumber(event.artifactItems)} items`}`,
      measure: event.virtualized ? `${formatBytes(retained)} retained` : formatBytes(event.bytesVisible.value),
      basis: 'exact bytes',
      tone: event.outcome === 'succeeded' ? 'clear' : 'attention',
      icon: EyeOff,
    };
  }
  if (event.type === 'mcp.query') {
    return {
      title: `${event.operation} answered locally`,
      detail: 'Bounded exact artifact query',
      measure: formatBytes(event.resultBytes.value),
      basis: `${event.durationMs.toFixed(1)} ms`,
      tone: event.outcome === 'succeeded' ? 'info' : 'attention',
      icon: Search,
    };
  }
  if (event.type === 'mcp.flow') {
    return {
      title: `${event.flow} dispatched under policy`,
      detail: `${event.sourceTool} → ${event.destinationTool}${event.receiptEmitted ? ' · signed receipt emitted' : ''}`,
      measure: `${formatNumber(event.items)} items`,
      basis: formatBytes(event.payloadBytes.value),
      tone: event.outcome === 'succeeded' ? 'clear' : 'attention',
      icon: Send,
    };
  }
  if (event.type === 'mcp.tool') {
    return {
      title: `${event.tool} ${event.outcome}`,
      detail: 'Tool arguments excluded from recorder',
      measure: `${event.durationMs.toFixed(1)} ms`,
      basis: 'measured',
      tone: event.outcome === 'succeeded' ? 'info' : 'attention',
      icon: Cable,
    };
  }
  if (event.type === 'mcp.lifecycle') {
    return {
      title: `MCP gateway ${event.state}`,
      detail: `${event.flowsConfigured} configured flow${event.flowsConfigured === 1 ? '' : 's'}${event.privateDestination ? ' · private destination' : ''}`,
      measure: 'Gateway',
      basis: 'lifecycle',
      tone: event.state === 'failed' ? 'attention' : 'muted',
      icon: Cable,
    };
  }
  if (isIdleHeadroomSample(event)) {
    return {
      title: event.healthy ? 'Copilot connected' : 'Copilot proxy starting',
      detail: `${event.attribution === 'shared' ? 'Shared proxy' : 'Dedicated proxy'} · waiting for first request`,
      measure: event.healthy ? 'Ready' : 'Starting',
      basis: 'connection state',
      tone: event.healthy ? 'info' : 'muted',
      icon: TerminalSquare,
    };
  }
  return {
    title: event.requests.value > 0
      ? `Copilot session reached ${formatNumber(event.requests.value)} request${event.requests.value === 1 ? '' : 's'}`
      : event.healthy ? 'Copilot usage updated' : 'Copilot telemetry unavailable',
    detail: `${event.model ?? 'Model not reported'} · ${event.attribution === 'shared' ? 'shared proxy attribution' : 'dedicated session'}`,
    measure: `${formatNumber(event.tokensText.value)} → ${formatNumber(event.tokensSent.value)} input tokens`,
    basis: `${formatNumber(event.outputTokens.value)} output · ${formatNumber(event.tokensSaved.value)} saved`,
    tone: event.healthy ? 'info' : 'attention',
    icon: TerminalSquare,
  };
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

function mountShell(): void {
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
            <strong data-session-label>${escapeHtml(statusLabel())}</strong>
            <span data-session-time>Waiting for local telemetry</span>
          </div>
        </div>
      </header>
      ${renderNavigation()}
      <main id="main" tabindex="-1"></main>
    </div>
  `;
}

function updateChrome(snapshot: DashboardSnapshot | null): void {
  const session = app.querySelector<HTMLElement>('.session-state');
  if (session) session.dataset.tone = statusTone();
  const label = app.querySelector<HTMLElement>('[data-session-label]');
  if (label) label.textContent = statusLabel();
  const time = app.querySelector<HTMLElement>('[data-session-time]');
  if (time) time.textContent = snapshot && state.lastSynchronizedAt != null
    ? `${formatNumber(snapshot.requests)} request${snapshot.requests === 1 ? '' : 's'} · synced ${formatTime(new Date(state.lastSynchronizedAt).toISOString())}`
    : 'Waiting for local telemetry';
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    const selected = button.dataset.view === state.view;
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

interface RenderContinuity {
  readonly focus?: {
    readonly attribute: string;
    readonly value: string;
    readonly selectionStart?: number | null;
    readonly selectionEnd?: number | null;
  };
  readonly scrollAreas: readonly { readonly top: number; readonly left: number }[];
  readonly pageY: number;
}

const SCROLL_AREA_SELECTOR = '.table-wrap, .request-list, .session-index';
const FOCUS_ATTRIBUTES = [
  'data-request-search',
  'data-outcome-filter',
  'data-provider-filter',
  'data-request-key',
  'data-history-group',
  'data-action',
] as const;

function captureRenderContinuity(main: HTMLElement): RenderContinuity {
  const active = document.activeElement;
  let focus: RenderContinuity['focus'];
  if (active instanceof HTMLElement && main.contains(active)) {
    const attribute = FOCUS_ATTRIBUTES.find((candidate) => active.hasAttribute(candidate));
    if (attribute) {
      focus = {
        attribute,
        value: active.getAttribute(attribute) ?? '',
        ...(active instanceof HTMLInputElement
          ? { selectionStart: active.selectionStart, selectionEnd: active.selectionEnd }
          : {}),
      };
    }
  }
  return {
    ...(focus ? { focus } : {}),
    scrollAreas: [...main.querySelectorAll<HTMLElement>(SCROLL_AREA_SELECTOR)]
      .map(({ scrollTop: top, scrollLeft: left }) => ({ top, left })),
    pageY: window.scrollY,
  };
}

function restoreRenderContinuity(main: HTMLElement, continuity: RenderContinuity): void {
  [...main.querySelectorAll<HTMLElement>(SCROLL_AREA_SELECTOR)].forEach((element, index) => {
    const saved = continuity.scrollAreas[index];
    if (!saved) return;
    element.scrollTop = saved.top;
    element.scrollLeft = saved.left;
  });
  if (continuity.focus) {
    const target = [...main.querySelectorAll<HTMLElement>(`[${continuity.focus.attribute}]`)]
      .find((element) => element.getAttribute(continuity.focus!.attribute) === continuity.focus!.value);
    target?.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement) {
      target.setSelectionRange(continuity.focus.selectionStart ?? null, continuity.focus.selectionEnd ?? null);
    }
  }
  window.scrollTo(0, continuity.pageY);
}

function render(): void {
  const snapshot = state.snapshot;
  updateChrome(snapshot);
  const main = app.querySelector<HTMLElement>('#main');
  if (!main) return;
  const continuity = captureRenderContinuity(main);
  main.innerHTML = `
    ${state.error ? renderAlert(state.error) : ''}
    ${snapshot ? renderView(snapshot) : renderWaiting()}
  `;
  restoreRenderContinuity(main, continuity);
}

function renderNavigation(): string {
  return `
    <nav class="view-nav" aria-label="Dashboard views">
      <div class="view-tabs">
        ${views.map(({ id, label, icon: iconNode }) => `
          <button type="button"${state.view === id ? ' aria-current="page"' : ''} data-view="${id}" class="view-tab${state.view === id ? ' is-active' : ''}">
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
  const verdict = sessionVerdict(snapshot);
  const mcpRetained = snapshot.byteLanes.reduce((total, lane) => total + lane.bytesRetained, 0);
  const visibleEvidence = selectVisibleEvidenceEvents(snapshot.recentEvents);
  const tokenLanes = selectVisibleTokenLanes(snapshot.tokenLanes);
  const tape = visibleEvidence.slice(-14).reverse();
  const latestActivity = snapshot.sources.reduce<string | null>(
    (latest, source) => latest == null || (source.lastActivityAt ?? '') > latest
      ? source.lastActivityAt
      : latest,
    null,
  );
  return `
    <section class="live-console" aria-labelledby="live-title">
      <header class="operator-brief" data-tone="${verdict.tone}">
        <div class="verdict-mark" aria-hidden="true">
          ${icon(verdict.tone === 'attention' ? ShieldAlert : verdict.tone === 'ended' ? Archive : BadgeCheck)}
        </div>
        <div class="verdict-copy">
          <span>Session verdict</span>
          <h2 id="live-title">${escapeHtml(verdict.title)}</h2>
          <p>${escapeHtml(verdict.detail)}</p>
        </div>
        <dl class="brief-facts">
          <div><dt>Exact bytes held out</dt><dd>${formatBytes(mcpRetained)}</dd></div>
          <div><dt>Session requests</dt><dd>${formatNumber(snapshot.requests)}</dd></div>
          <div><dt>Last evidence</dt><dd>${escapeHtml(formatTime(latestActivity))}</dd></div>
        </dl>
      </header>

      <div class="live-workbench">
        <section class="tape-panel" aria-labelledby="tape-title">
          <div class="panel-heading">
            <div>
              <h3 id="tape-title">Evidence tape</h3>
              <p>One chronological record across provider, MCP, and Copilot paths.</p>
            </div>
            <span>Latest ${tape.length} visible · ${snapshot.eventCount} recorded</span>
          </div>
          ${renderEvidenceTape(tape)}
        </section>

        <aside class="calibration-panel" aria-labelledby="calibration-title">
          <div class="panel-heading compact">
            <div>
              <h3 id="calibration-title">Calibration</h3>
              <p>Never summed across counting bases.</p>
            </div>
          </div>
          <div class="calibration-lanes">
            ${tokenLanes.length > 0
              ? tokenLanes.map(renderCalibrationLane).join('')
              : '<div class="inline-empty">No token-bearing route events yet.</div>'}
          </div>
          ${snapshot.byteLanes.map(renderByteCalibration).join('')}
          ${renderSourceRegister(snapshot)}
        </aside>
      </div>

      ${snapshot.headroom ? renderCopilotNotice(snapshot) : ''}
    </section>
  `;
}

function renderEvidenceTape(events: readonly DashboardEvent[]): string {
  if (events.length === 0) {
    return '<div class="domain-empty compact-empty"><h3>No evidence yet</h3><p>The tape begins with the first provider route or MCP operation.</p></div>';
  }
  return `
    <ol class="evidence-tape">
      ${events.map((event, index) => {
        const described = describeEvent(event);
        return `<li class="tape-entry" data-tone="${described.tone}">
          <div class="tape-time"><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatTime(event.occurredAt))}</time><span>${index === 0 ? 'latest' : ''}</span></div>
          <div class="tape-node" aria-hidden="true">${icon(described.icon)}</div>
          <div class="tape-copy"><strong>${escapeHtml(described.title)}</strong><span>${escapeHtml(described.detail)}</span></div>
          <div class="tape-measure"><strong>${escapeHtml(described.measure)}</strong><span>${escapeHtml(described.basis)}</span></div>
        </li>`;
      }).join('')}
    </ol>
  `;
}

function renderCalibrationLane(lane: DashboardTokenLane): string {
  const sentPercent = lane.tokensText > 0
    ? Math.max(0, Math.min(100, lane.tokensSent / lane.tokensText * 100))
    : 0;
  const savedPercent = lane.tokensText > 0 ? lane.tokensSaved / lane.tokensText * 100 : 0;
  return `
    <article class="calibration-lane">
      <div><strong>${escapeHtml(sourceLabel(lane.source))}</strong><span>${escapeHtml(lane.basis)}</span></div>
      <div class="calibration-values"><span>${formatNumber(lane.tokensText)}</span><i>→</i><span>${formatNumber(lane.tokensSent)}</span></div>
      <progress value="${sentPercent.toFixed(2)}" max="100" aria-label="${escapeHtml(sourceLabel(lane.source))}: ${formatNumber(lane.tokensSent)} of ${formatNumber(lane.tokensText)} tokens sent"></progress>
      <p><strong>${lane.tokensSaved >= 0 ? '+' : ''}${formatNumber(lane.tokensSaved)}</strong><span>${formatPercent(savedPercent)} retained</span></p>
    </article>
  `;
}

function renderByteCalibration(lane: DashboardSnapshot['byteLanes'][number]): string {
  const visiblePercent = lane.bytesBefore > 0
    ? Math.max(0, Math.min(100, lane.bytesVisible / lane.bytesBefore * 100))
    : 0;
  return `
    <article class="calibration-lane byte-lane">
      <div><strong>MCP result boundary</strong><span>${escapeHtml(lane.basis)}</span></div>
      <div class="calibration-values"><span>${formatBytes(lane.bytesBefore)}</span><i>→</i><span>${formatBytes(lane.bytesVisible)}</span></div>
      <progress value="${visiblePercent.toFixed(2)}" max="100" aria-label="${formatBytes(lane.bytesVisible)} of ${formatBytes(lane.bytesBefore)} visible to the host"></progress>
      <p><strong>${formatBytes(lane.bytesRetained)}</strong><span>held outside context</span></p>
    </article>
  `;
}

function renderSourceRegister(snapshot: DashboardSnapshot): string {
  return `
    <div class="source-register compact-register">
      <div class="register-heading"><strong>Source register</strong><span>${snapshot.sources.length} attached</span></div>
      ${snapshot.sources.map((source) => `
        <div class="source-row"><i data-state="${source.state}"></i><strong>${escapeHtml(sourceLabel(source.source))}</strong><small>${escapeHtml(source.state)}</small></div>
      `).join('')}
    </div>
  `;
}

function renderCopilotNotice(snapshot: DashboardSnapshot): string {
  const headroom = snapshot.headroom;
  if (!headroom) return '';
  const hasUsage = selectVisibleTokenLanes(snapshot.tokenLanes).some((lane) => lane.source === 'headroom');
  const quota = headroom.quota.find((item) => item.category === 'premium_interactions') ?? headroom.quota[0];
  if (!hasUsage) {
    return `
      <aside class="copilot-notice" data-attribution="${headroom.attribution}">
        <div>${icon(TerminalSquare)}<span>Copilot / Headroom</span><strong>Awaiting first request</strong></div>
        <p>${headroom.healthy
          ? 'The proxy is connected. Usage appears after Copilot completes its first model request.'
          : 'The proxy is still starting. Usage will appear after Headroom connects and Copilot completes a request.'}</p>
        <dl>
          <div><dt>Connection</dt><dd>${headroom.healthy ? 'Ready' : 'Starting'}</dd></div>
          <div><dt>Attribution</dt><dd>${headroom.attribution === 'shared' ? 'Shared proxy' : 'Dedicated session'}</dd></div>
          <div><dt>Coverage</dt><dd>Waiting for usage</dd></div>
        </dl>
      </aside>
    `;
  }
  return `
    <aside class="copilot-notice" data-attribution="${headroom.attribution}">
      <div>${icon(TerminalSquare)}<span>Copilot / Headroom</span><strong>${escapeHtml(headroom.model ?? 'Model not reported')}</strong></div>
      <p>${headroom.attribution === 'shared'
        ? 'Shared proxy attribution: Copilot-class traffic since attach, not process-exact billing.'
        : 'Dedicated proxy attribution: counters are scoped to this wrapped session.'}</p>
      <dl>
        <div><dt>Output</dt><dd>${formatNumber(headroom.outputTokens)} tokens</dd></div>
        <div><dt>Cost basis</dt><dd>${headroom.costSaved == null ? 'Unavailable' : formatCurrency(headroom.costSaved.value)}</dd></div>
        <div><dt>Premium quota</dt><dd>${quota?.unlimited ? 'Unlimited' : quota?.remaining == null ? 'Not reported' : `${formatNumber(quota.remaining)} remaining`}</dd></div>
      </dl>
    </aside>
  `;
}

function renderEvidenceValue(label: string, value: string | number, note: string): string {
  return `<div class="evidence-value"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

function renderLedgerHeading(title: string, count: number): string {
  return `<div class="section-heading compact"><div><p class="eyebrow">CHRONOLOGICAL / CONTENT-FREE</p><h2>${escapeHtml(title)}</h2></div><span class="count-label">${count} event${count === 1 ? '' : 's'}</span></div>`;
}

function renderRequests(snapshot: DashboardSnapshot): string {
  const allEvents = snapshot.recentEvents
    .filter((event): event is Extract<DashboardEvent, { type: 'provider.route' }> => event.type === 'provider.route')
    .slice()
    .reverse();
  const query = state.requestQuery.trim().toLowerCase();
  const filtered = allEvents.filter((event) => {
    if (state.requestProvider !== 'all' && event.provider !== state.requestProvider) return false;
    const applied = event.stages.some(({ applied }) => applied);
    if (state.requestOutcome === 'applied' && !applied) return false;
    if (state.requestOutcome === 'passthrough' && applied) return false;
    if (state.requestOutcome === 'negative' && event.tokensSaved.value >= 0) return false;
    if (!query) return true;
    return [event.provider, event.model ?? '', ...event.stages.flatMap(({ stage, reason }) => [stage, reason])]
      .some((value) => value.toLowerCase().includes(query));
  });
  const appliedCount = allEvents.filter((event) => event.stages.some(({ applied }) => applied)).length;
  const negativeCount = allEvents.filter((event) => event.tokensSaved.value < 0).length;
  const selected = filtered.find((event) => eventKey(event) === state.selectedRequest) ?? null;
  return `
    <section class="request-explorer" aria-labelledby="requests-title">
      <header class="page-heading">
        <div><h2 id="requests-title">Provider routes</h2><p>Inspect the latest retained decision window without opening prompt or response content.</p></div>
        <dl class="page-facts"><div><dt>Window</dt><dd>${allEvents.length}</dd></div><div><dt>Transformed</dt><dd>${appliedCount}</dd></div><div data-tone="${snapshot.negativeSavingsRoutes > 0 ? 'attention' : 'clear'}"><dt>Session negatives</dt><dd>${snapshot.negativeSavingsRoutes}</dd></div></dl>
      </header>
      <div class="request-toolbar" role="search">
        <label class="search-field" for="request-search">${icon(Search)}<span class="sr-only">Search requests</span><input id="request-search" name="request-search" type="search" data-request-search value="${escapeHtml(state.requestQuery)}" placeholder="Search model, provider, or stage"></label>
        <div class="filter-group" aria-label="Provider filter">
          ${(['all', 'openai', 'anthropic'] as const).map((value) => `<button type="button" data-provider-filter="${value}" aria-pressed="${state.requestProvider === value}">${value === 'all' ? 'All providers' : value === 'openai' ? 'OpenAI' : 'Anthropic'}</button>`).join('')}
        </div>
        <label class="select-field" for="request-outcome"><span>Outcome</span><select id="request-outcome" name="request-outcome" data-outcome-filter><option value="all"${state.requestOutcome === 'all' ? ' selected' : ''}>All outcomes</option><option value="applied"${state.requestOutcome === 'applied' ? ' selected' : ''}>Transformed</option><option value="passthrough"${state.requestOutcome === 'passthrough' ? ' selected' : ''}>Pass-through</option><option value="negative"${state.requestOutcome === 'negative' ? ' selected' : ''}>Negative savings</option></select>${icon(ChevronDown)}</label>
        <span class="filter-result">${filtered.length} of ${allEvents.length}</span>
      </div>
      <div class="request-workbench">
        <ul class="request-list">
          ${filtered.length > 0 ? filtered.map(renderRequestRow).join('') : '<li class="domain-empty compact-empty"><h3>No matching routes</h3><p>Adjust the provider, outcome, or search filters.</p></li>'}
        </ul>
        <aside class="request-detail" aria-live="polite" tabindex="-1">
          ${selected ? renderRequestDetail(selected) : renderRequestPrompt(filtered[0] ?? null)}
        </aside>
      </div>
    </section>
  `;
}

function renderRequestRow(event: Extract<DashboardEvent, { type: 'provider.route' }>): string {
  const applied = event.stages.filter(({ applied }) => applied);
  const selected = eventKey(event) === state.selectedRequest;
  const ratio = event.tokensText.value > 0
    ? event.tokensSaved.value / event.tokensText.value * 100
    : 0;
  return `<li><button type="button" class="request-row${selected ? ' is-selected' : ''}" data-request-key="${escapeHtml(eventKey(event))}" aria-pressed="${selected}">
    <time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatTime(event.occurredAt))}</time>
    <span class="provider-glyph" data-provider="${event.provider}">${event.provider === 'openai' ? 'O' : 'A'}</span>
    <span class="request-route"><strong>${escapeHtml(event.model ?? 'Unknown model')}</strong><small>${escapeHtml(event.provider)} · ${escapeHtml(applied.map(({ stage }) => stage).join(' + ') || 'pass-through')}</small></span>
    <span class="request-volume"><strong>${formatNumber(event.tokensText.value)} → ${formatNumber(event.tokensCompressed.value)}</strong><small>${escapeHtml(event.tokensSaved.basis)}</small></span>
    <span class="request-saving" data-tone="${event.tokensSaved.value < 0 ? 'attention' : applied.length > 0 ? 'clear' : 'muted'}"><strong>${event.tokensSaved.value >= 0 ? '+' : ''}${formatNumber(event.tokensSaved.value)}</strong><small>${formatPercent(ratio)}</small></span>
    ${icon(ChevronDown)}
  </button></li>`;
}

function renderRequestPrompt(event: Extract<DashboardEvent, { type: 'provider.route' }> | null): string {
  if (!event) return '<div class="detail-empty">No route available for inspection.</div>';
  return `<div class="detail-empty">${icon(Route)}<h3>Select a route</h3><p>Review stage decisions, timing, basis, and reversibility for ${escapeHtml(event.model ?? event.provider)}.</p></div>`;
}

function renderRequestDetail(event: Extract<DashboardEvent, { type: 'provider.route' }>): string {
  return `
    <div class="detail-heading"><div class="provider-glyph" data-provider="${event.provider}">${event.provider === 'openai' ? 'O' : 'A'}</div><div><span>${escapeHtml(event.provider)}</span><h3>${escapeHtml(event.model ?? 'Unknown model')}</h3></div><time>${escapeHtml(formatTime(event.occurredAt))}</time></div>
    <dl class="detail-facts">
      <div><dt>Mode</dt><dd>${escapeHtml(event.mode)}</dd></div>
      <div><dt>Auth</dt><dd>${escapeHtml(event.authMode)}</dd></div>
      <div><dt>Duration</dt><dd>${event.durationMs.toFixed(1)} ms</dd></div>
      <div><dt>Reversible</dt><dd>${event.reversibleCount}</dd></div>
    </dl>
    <div class="route-equation"><span>${formatNumber(event.tokensText.value)}<small>before</small></span><i>→</i><span>${formatNumber(event.tokensCompressed.value)}<small>sent</small></span><strong data-tone="${event.tokensSaved.value < 0 ? 'attention' : 'clear'}">${event.tokensSaved.value >= 0 ? '+' : ''}${formatNumber(event.tokensSaved.value)}<small>saved</small></strong></div>
    <div class="stage-ledger"><h4>Stage evidence</h4>${event.stages.map((stage) => `<div data-outcome="${stage.applied ? 'applied' : stage.reason}"><span>${icon(stage.applied ? CheckCircle2 : Braces)}<strong>${escapeHtml(stage.stage)}</strong></span><span>${stage.applied ? `${formatNumber(stage.tokensText)} → ${formatNumber(stage.tokensCompressed)}` : escapeHtml(stage.reason)}</span><small>${escapeHtml(stage.basis)}</small></div>`).join('')}</div>
    <p class="detail-privacy">${icon(LockKeyhole)} Request and response content were never written to this recorder.</p>
  `;
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
  const selectedSummary = state.history.find(({ groupId }) => groupId === state.selectedHistoryGroup) ?? state.history[0] ?? null;
  const selectedIndex = selectedSummary
    ? state.history.findIndex(({ groupId }) => groupId === selectedSummary.groupId)
    : -1;
  const baseline = selectedIndex >= 0
    ? state.history[selectedIndex + 1] ?? null
    : null;
  const detail = state.historySnapshot;
  return `
    <section class="history-atlas" aria-labelledby="history-title">
      <header class="page-heading"><div><h2 id="history-title">Session atlas</h2><p>Compare source-qualified evidence across the local retention window.</p></div><span class="retention-note">30 days · 64 MiB bounded</span></header>
      ${state.historyIndexError
        ? `<div class="detail-empty history-error">${icon(TriangleAlert)}<h3>Session index unavailable</h3><p>${escapeHtml(state.historyIndexError)}</p><button type="button" data-action="retry-history-index">Retry</button></div>`
        : state.history.length > 0 ? `<div class="history-workbench">
        <nav class="session-index" aria-label="Recorded sessions">
          ${state.history.map((session) => renderHistoryButton(session, session.groupId === selectedSummary?.groupId)).join('')}
        </nav>
        <section class="history-detail" aria-live="polite" tabindex="-1">
          ${state.historyLoading
            ? '<div class="history-loading" role="status"><span class="sr-only">Loading session evidence</span><i></i><i></i><i></i></div>'
            : state.historyError
              ? `<div class="detail-empty history-error">${icon(TriangleAlert)}<h3>Session evidence unavailable</h3><p>${escapeHtml(state.historyError)}</p><button type="button" data-action="retry-history">Retry</button></div>`
              : detail ? renderHistoricalSnapshot(detail, selectedSummary, baseline) : '<div class="detail-empty">Select a recorded session.</div>'}
        </section>
      </div>` : '<div class="domain-empty">' + icon(Archive) + '<h3>No durable history yet</h3><p>Dashboard-enabled sessions appear here after their first metadata event.</p></div>'}
    </section>
  `;
}

function renderHistoryButton(session: DashboardHistorySession, selected: boolean): string {
  const bytes = session.byteLanes.reduce((total, lane) => total + lane.bytesRetained, 0);
  return `<button type="button" class="session-button${selected ? ' is-selected' : ''}" data-history-group="${escapeHtml(session.groupId)}" aria-current="${selected ? 'true' : 'false'}">
    <span class="history-status" data-state="${session.state}"></span>
    <span><strong>${escapeHtml(formatDateTime(session.startedAt))}</strong><small>${escapeHtml(session.sources.map(sourceLabel).join(' + ') || 'No sources')}</small></span>
    <span><strong>${formatNumber(session.requests)}</strong><small>requests</small></span>
    <span><strong>${formatBytes(bytes)}</strong><small>held out</small></span>
    <span><strong>${formatDuration(session.durationMs)}</strong><small>duration</small></span>
    ${icon(ChevronDown)}
  </button>`;
}

function renderHistoricalSnapshot(
  snapshot: DashboardSnapshot,
  summary: DashboardHistorySession | null,
  baseline: DashboardHistorySession | null,
): string {
  const verdict = sessionVerdict(snapshot);
  const tokenLanes = selectVisibleTokenLanes(snapshot.tokenLanes);
  return `
    <div class="historical-header" data-tone="${verdict.tone}" tabindex="-1"><div>${icon(verdict.tone === 'attention' ? TriangleAlert : BadgeCheck)}<span>${escapeHtml(verdict.title)}</span></div><code>${escapeHtml(snapshot.groupId.slice(0, 22))}</code></div>
    ${renderHistoryComparison(summary, baseline)}
    <div class="history-calibration">
      ${tokenLanes.map(renderCalibrationLane).join('') || '<p>No token lanes recorded.</p>'}
      ${snapshot.byteLanes.map(renderByteCalibration).join('')}
    </div>
    <dl class="history-facts"><div><dt>Started</dt><dd>${escapeHtml(formatDateTime(summary?.startedAt ?? null))}</dd></div><div><dt>Duration</dt><dd>${formatDuration(summary?.durationMs ?? null)}</dd></div><div><dt>Events</dt><dd>${snapshot.eventCount}</dd></div><div><dt>MCP receipts</dt><dd>${snapshot.mcp.receiptsEmitted}</dd></div></dl>
    <div class="history-tape"><h3>Latest session evidence <span>${Math.min(8, selectVisibleEvidenceEvents(snapshot.recentEvents).length)} visible · ${snapshot.eventCount} recorded</span></h3>${renderEvidenceTape(selectVisibleEvidenceEvents(snapshot.recentEvents).slice(-8).reverse())}</div>
  `;
}

function renderHistoryComparison(
  current: DashboardHistorySession | null,
  baseline: DashboardHistorySession | null,
): string {
  if (!current || !baseline) {
    return '<div class="comparison-empty">No older session is available for comparison.</div>';
  }
  const currentBytes = current.byteLanes.reduce((total, lane) => total + lane.bytesRetained, 0);
  const baselineBytes = baseline.byteLanes.reduce((total, lane) => total + lane.bytesRetained, 0);
  const currentSignals = current.mcp.failed + current.corruptRecords;
  const baselineSignals = baseline.mcp.failed + baseline.corruptRecords;
  const matchingLaneDeltas = current.tokenLanes.flatMap((lane) => {
    const previous = baseline.tokenLanes.find(
      (candidate) => candidate.source === lane.source && candidate.basis === lane.basis,
    );
    return previous ? [{ label: sourceLabel(lane.source), value: lane.tokensSaved - previous.tokensSaved }] : [];
  });
  const comparisons = [
    { label: 'Requests', value: current.requests - baseline.requests, format: formatSignedNumber, semantic: false },
    { label: 'Exact bytes held out', value: currentBytes - baselineBytes, format: formatSignedBytes, semantic: false },
    { label: 'Adverse signals', value: currentSignals - baselineSignals, format: formatSignedNumber, inverse: true },
    ...(current.durationMs != null && baseline.durationMs != null
      ? [{ label: 'Duration', value: current.durationMs - baseline.durationMs, format: formatSignedDuration, semantic: false }]
      : []),
    ...matchingLaneDeltas.slice(0, 2).map(({ label, value }) => ({
      label: `${label} tokens saved`,
      value,
      format: formatSignedNumber,
      semantic: false,
    })),
  ];
  return `
    <section class="session-comparison" aria-label="Comparison with older session">
      <div><span>Compared with</span><strong>${escapeHtml(formatDateTime(baseline.startedAt))}</strong></div>
      ${comparisons.map(({ label, value, format, inverse, semantic }) => {
        const tone = !semantic && !inverse
          ? 'neutral'
          : value === 0 ? 'neutral' : inverse ? value < 0 ? 'positive' : 'negative' : value > 0 ? 'positive' : 'negative';
        return `<div data-tone="${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(format(value))}</strong></div>`;
      }).join('')}
    </section>
  `;
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
}

function formatSignedBytes(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatBytes(Math.abs(value))}`;
}

function formatSignedDuration(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatDuration(Math.abs(value))}`;
}

function focusMobileDetail(selector: string): void {
  if (!matchMedia('(max-width: 700px)').matches) return;
  requestAnimationFrame(() => {
    const detail = document.querySelector<HTMLElement>(selector);
    detail?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    detail?.focus({ preventScroll: true });
  });
}

function renderSystem(snapshot: DashboardSnapshot): string {
  const tokenLanes = selectVisibleTokenLanes(snapshot.tokenLanes);
  return `
    <section class="system-layout">
      <div class="section-heading"><div><p class="eyebrow">SYSTEM / TRUST BOUNDARY</p><h2>Local recorder state</h2></div><span class="basis-note">Read-only control plane</span></div>
      <div class="system-grid">
        <article>${icon(TerminalSquare)}<span>Session</span><strong>${escapeHtml(snapshot.groupId.slice(0, 22))}</strong><small>${snapshot.state}</small></article>
        <article>${icon(Database)}<span>Metadata records</span><strong>${formatNumber(snapshot.recentEvents.length)}</strong><small>${snapshot.corruptRecords} isolated corrupt records</small></article>
        <article>${icon(Gauge)}<span>Counting lanes</span><strong>${formatNumber(tokenLanes.length)}</strong><small>Never merged across bases</small></article>
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
  app.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const view = target?.closest<HTMLButtonElement>('[data-view]');
    if (view?.dataset.view) {
      setView(view.dataset.view as ViewName);
      return;
    }
    if (target?.closest('[data-action="retry"]')) {
      state.retryMs = 1_000;
      void connect();
      return;
    }
    if (target?.closest('[data-action="retry-history"]')) {
      if (state.selectedHistoryGroup) void selectHistory(state.selectedHistoryGroup);
      return;
    }
    if (target?.closest('[data-action="retry-history-index"]')) {
      state.historyIndexError = null;
      render();
      void loadHistory(true);
      return;
    }
    const provider = target?.closest<HTMLButtonElement>('[data-provider-filter]');
    if (provider?.dataset.providerFilter) {
      state.requestProvider = provider.dataset.providerFilter as RequestProviderFilter;
      state.selectedRequest = null;
      render();
      return;
    }
    const request = target?.closest<HTMLButtonElement>('[data-request-key]');
    if (request) {
      const key = request.dataset.requestKey ?? null;
      state.selectedRequest = state.selectedRequest === key ? null : key;
      render();
      if (state.selectedRequest) focusMobileDetail('.request-detail');
      return;
    }
    const historyGroup = target?.closest<HTMLButtonElement>('[data-history-group]');
    if (historyGroup?.dataset.historyGroup) void selectHistory(historyGroup.dataset.historyGroup);
  });
  app.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-request-search]')) return;
    state.requestQuery = event.target.value;
    render();
  });
  app.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLSelectElement) || !event.target.matches('[data-outcome-filter]')) return;
    state.requestOutcome = event.target.value as RequestOutcomeFilter;
    state.selectedRequest = null;
    render();
  });
}

function setView(view: ViewName): void {
  state.view = view;
  const url = new URL(location.href);
  if (view === 'live') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  history.replaceState(null, '', `${url.pathname}${url.search}`);
  render();
  if (view === 'history') void loadHistory(true);
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

function acceptSnapshot(snapshot: DashboardSnapshot): boolean {
  const comparison = compareDashboardSnapshots(state.snapshot, snapshot);
  if (comparison === 'rejected') return false;
  const connectionChanged = state.connection !== 'live' || state.error != null;
  if (comparison === 'changed') state.snapshot = snapshot;
  state.connection = 'live';
  state.error = null;
  state.retryMs = 1_000;
  state.lastSynchronizedAt = Date.now();
  return comparison === 'changed' || connectionChanged;
}

async function reconcileSnapshot(): Promise<void> {
  if (document.hidden || !state.token || state.reconcileInFlight) return;
  state.reconcileInFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const snapshot = await api<DashboardSnapshot>('/api/v1/snapshot', controller.signal);
    if (acceptSnapshot(snapshot)) render();
    else updateChrome(state.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unauthorized' || message === 'missing_access_token') {
      clearDashboardToken(tokenStorage);
      state.token = null;
      state.connection = 'unauthorized';
      state.error = null;
      render();
      return;
    }
    const staleFor = state.lastSynchronizedAt == null
      ? Number.POSITIVE_INFINITY
      : Date.now() - state.lastSynchronizedAt;
    if (state.connection === 'live' && staleFor >= 8_000) {
      state.connection = 'reconnecting';
      state.error = 'Live reconciliation paused. Recorded evidence remains visible while Pinpoint reconnects.';
      render();
    }
  } finally {
    window.clearTimeout(timeout);
    state.reconcileInFlight = false;
  }
}

function startReconciliation(): void {
  if (state.reconcileTimer != null) return;
  state.reconcileTimer = window.setInterval(() => void reconcileSnapshot(), 2_000);
}

async function loadHistory(selectLatest = false): Promise<void> {
  try {
    const payload = await api<{ sessions: DashboardHistorySession[] }>('/api/v1/history');
    state.history = payload.sessions;
    state.historyIndexError = null;
    const selectedStillExists = state.selectedHistoryGroup != null &&
      payload.sessions.some(({ groupId }) => groupId === state.selectedHistoryGroup);
    if (selectLatest || !selectedStillExists) {
      const next = payload.sessions[0]?.groupId ?? null;
      if (next && next !== state.selectedHistoryGroup) {
        state.selectedHistoryGroup = next;
        state.historySnapshot = null;
        if (state.view === 'history') render();
        await loadHistoricalSnapshot(next);
        return;
      }
    }
    if (state.view === 'history') render();
  } catch {
    state.historyIndexError = 'The local session index could not be read. Live evidence remains available.';
    if (state.view === 'history') render();
  }
}

async function selectHistory(groupId: string): Promise<void> {
  if (state.selectedHistoryGroup === groupId && state.historySnapshot) return;
  state.selectedHistoryGroup = groupId;
  state.historySnapshot = null;
  state.historyLoading = true;
  state.historyError = null;
  render();
  await loadHistoricalSnapshot(groupId);
  focusMobileDetail('.history-detail');
}

async function loadHistoricalSnapshot(groupId: string): Promise<void> {
  try {
    const payload = await api<{ session: DashboardSnapshot }>(
      `/api/v1/history?group=${encodeURIComponent(groupId)}`,
    );
    if (state.selectedHistoryGroup !== groupId) return;
    state.historySnapshot = payload.session;
    state.historyError = null;
  } catch {
    if (state.selectedHistoryGroup === groupId) {
      state.historySnapshot = null;
      state.historyError = 'The local history record could not be read. Existing live evidence is unaffected.';
    }
  } finally {
    if (state.selectedHistoryGroup === groupId) {
      state.historyLoading = false;
      if (state.view === 'history') render();
    }
  }
}

function scheduleReconnect(): void {
  if (state.connection === 'unauthorized') return;
  state.connection = 'reconnecting';
  render();
  if (state.retryTimer != null || document.hidden) return;
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
        pendingSnapshot = JSON.parse(data.join('\n')) as DashboardSnapshot;
        if (!snapshotScheduled) {
          snapshotScheduled = true;
          queueMicrotask(() => {
            snapshotScheduled = false;
            if (signal.aborted || !pendingSnapshot) return;
            const changed = acceptSnapshot(pendingSnapshot);
            pendingSnapshot = null;
            if (changed) render();
            else updateChrome(state.snapshot);
          });
        }
      }
    }
  }
}

async function connect(): Promise<void> {
  state.streamController?.abort();
  snapshotScheduled = false;
  pendingSnapshot = null;
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
    const response = await fetch('/api/v1/stream', {
      headers: { authorization: `Bearer ${state.token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('unauthorized');
    if (!response.ok) throw new Error(`stream_failed_${response.status}`);
    if (state.view === 'history') void loadHistory(true);
    await readSse(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unauthorized' || message === 'missing_access_token') {
      clearDashboardToken(tokenStorage);
      state.token = null;
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
  void reconcileSnapshot();
  if (state.connection !== 'live') void connect();
});

window.addEventListener('focus', () => void reconcileSnapshot());
window.addEventListener('online', () => {
  void reconcileSnapshot();
  if (state.connection !== 'live') void connect();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    void reconcileSnapshot();
    void connect();
  }
});

window.addEventListener('popstate', () => {
  state.view = readView();
  render();
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const editing = target?.matches('input, select, textarea, [contenteditable="true"]') === true;
  if (!editing && /^[1-5]$/.test(event.key)) {
    const view = views[Number(event.key) - 1]?.id;
    if (view) {
      event.preventDefault();
      setView(view);
    }
    return;
  }
  if (!editing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const focusedView = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-view]');
    if (focusedView) {
      event.preventDefault();
      const current = views.findIndex(({ id }) => id === focusedView.dataset.view);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = views[(current + direction + views.length) % views.length];
      if (next) {
        setView(next.id);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-view="${next.id}"]`)?.focus());
      }
      return;
    }
  }
  if (!editing && event.key === '/') {
    event.preventDefault();
    if (state.view !== 'requests') setView('requests');
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-request-search]')?.focus());
    return;
  }
  if (event.key === 'Escape') {
    state.selectedRequest = null;
    if (editing) (target as HTMLElement).blur();
    if (state.view === 'requests') render();
  }
});

mountShell();
bindInteractions();
render();
startReconciliation();
void connect();