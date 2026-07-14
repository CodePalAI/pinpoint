/**
 * pixroom CLI (planning/end_product.md §6).
 *
 *   pixroom proxy              start the combined optical+semantic proxy
 *   pixroom export <paths…>    offline compress + honest savings report
 *   pixroom doctor             health: toolchain, pxpipe, headroom sidecar
 *   pixroom stats              query a running proxy's session savings
 *   pixroom mcp | wrap         distribution front doors (roadmap)
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { createProxyServer } from '../proxy/server.js';
import { createPixroom } from '../pixroom.js';
import { runMcpServer } from '../mcp/server.js';
import { runWrap, copilotPreflight } from '../wrap/runner.js';
import { describeAgents, knownAgents } from '../wrap/agents.js';
import { formatReport } from '../measurement/savings.js';
import { loadConfig, type PixroomConfigOverrides } from '../config.js';
import type { RuntimeMode } from '../kernel/types.js';

function version(): string {
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const HELP = `pixroom ${version()} — exact-context optimization runtime for agents

USAGE
  pixroom <command> [options]

COMMANDS
  proxy [options]  Start the programmable optimization proxy. Options:
                   --mode audit|shadow|optimize|enforce, --host, --port,
                   --no-qcv, --virtual-query-fallback.
                   Point your agent's
                   ANTHROPIC_BASE_URL / OPENAI_BASE_URL at it.
  demo             Run an exact QCV transformation locally. No model, API key,
                   sidecar, or network request.
  export <paths>   Offline: compress the given files and print an honest,
                   per-stage savings report. No upstream calls.
  doctor [copilot] Check the toolchain, pxpipe, and the headroom sidecar.
                   'doctor copilot' checks GitHub Copilot readiness.
  stats            Query a running proxy's session savings (GET /stats).
  integration      List active optimizer integrations and their capabilities.
  agent             List agent adapters and their actual interception level.
  mcp              MCP server over stdio (tools: pixroom_compress / _retrieve / _stats).
  wrap <agent>     Start pixroom (or delegate) and launch <agent> pointed at it.
                   Agents: claude, codex, aider, goose, openhands, opencode, vibe,
                   copilot (uses your existing login, no API key); cursor/cline/
                   continue print IDE config. Args after '--' go to the agent.
  help             Show this help.

COMMON ENV
  PIXROOM_HOST / PIXROOM_PORT        listen interface / port (default 127.0.0.1:8788)
  PIXROOM_MODE                       audit|shadow|optimize|enforce (default optimize)
  PIXROOM_MODELS                     optical model scope CSV; 'off' disables; unset = pxpipe default
  PIXROOM_OPTICAL / PIXROOM_SEMANTIC on/off master switches
  PIXROOM_VIRTUAL_CONTEXT             exact QCV switch (default on; set 0 to disable)
  PIXROOM_VIRTUAL_QUERY_FALLBACK      model-driven QCV continuation (default off)
  PIXROOM_HEADROOM_URL               headroom sidecar base URL (default http://127.0.0.1:8787)
  PIXROOM_HEADROOM_AUTOSPAWN         auto-start 'headroom proxy' if not reachable (default on)
  PIXROOM_OPTICAL_ON_SUBSCRIPTION    allow lossy optical on oauth/subscription (default off)
  PIXROOM_HEADROOM_BIN               headroom binary for 'wrap copilot' (else PATH / venv)
  PIXROOM_COPILOT_MODEL              default model for 'wrap copilot' (default gpt-4o)
  PIXROOM_LOG                        silent|error|warn|info|debug
`;

export type ProxyArgsResult =
  | { readonly ok: true; readonly overrides: PixroomConfigOverrides }
  | { readonly ok: false; readonly error: string };

export function parseProxyArgs(args: readonly string[]): ProxyArgsResult {
  const overrides: PixroomConfigOverrides = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--mode') {
      const mode = args[++index];
      if (!mode || !['audit', 'shadow', 'optimize', 'enforce'].includes(mode)) {
        return { ok: false, error: '--mode must be audit, shadow, optimize, or enforce' };
      }
      overrides.mode = mode as RuntimeMode;
    } else if (arg === '--host') {
      const host = args[++index];
      if (!host) return { ok: false, error: '--host requires a value' };
      overrides.host = host;
    } else if (arg === '--port' || arg === '-p') {
      const raw = args[++index];
      const port = raw == null ? Number.NaN : Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return { ok: false, error: '--port must be an integer from 0 to 65535' };
      }
      overrides.port = port;
    } else if (arg === '--no-qcv' || arg === '--no-virtual-context') {
      overrides.virtualContext = { ...overrides.virtualContext, enabled: false };
    } else if (arg === '--virtual-query-fallback') {
      overrides.virtualContext = { ...overrides.virtualContext, queryFallback: true };
    } else {
      return { ok: false, error: `unknown proxy option: ${arg}` };
    }
  }
  return { ok: true, overrides };
}

async function cmdProxy(args: readonly string[]): Promise<void> {
  const parsed = parseProxyArgs(args);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const server = createProxyServer(parsed.overrides);
  await server.listen();
  const shutdown = async (sig: string) => {
    server.pixroom.log.info(`received ${sig}, shutting down`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function cmdExport(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    console.error('usage: pixroom export <path> [path…]');
    process.exitCode = 1;
    return;
  }
  const pixroom = createPixroom();
  await pixroom.warmup();

  // Treat the files as the static context slab so the always-available optical
  // engine images them offline (mirrors `pxpipe export`); the semantic stage also
  // runs if a headroom sidecar is reachable. No upstream/LLM calls are made.
  const combined = paths
    .map((p) => `# ${basename(p)}\n${readFileSync(p, 'utf8')}`)
    .join('\n\n');
  const body: Record<string, unknown> = {
    model: 'claude-fable-5',
    system: [{ type: 'text', text: combined, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize the attached context.' }] }],
  };

  const routed = await pixroom.route('anthropic', 'claude-fable-5', body);
  console.log(`files: ${paths.length}   input chars: ${combined.length}`);
  console.log(formatReport(routed.report));
  console.log(`\ncache_control owned by optical: ${routed.opticalOwnsCacheControl}`);
  console.log(`reversible originals registered: ${routed.reversible.length}`);
  await pixroom.shutdown();
}

export async function runQcvDemo(): Promise<string> {
  const pixroom = createPixroom({
    virtualContext: { enabled: true, queryFallback: false, minChars: 100, protectRecent: 0 },
    semantic: { enabled: false },
    optical: { enabled: false },
    logLevel: 'silent',
  });
  const rows = Array.from({ length: 1_000 }, (_, id) => ({
    id,
    email: `user${id}@example.com`,
    active: id % 2 === 0,
  }));
  const question = 'What is the email for id 733?';
  const body = {
    model: 'claude-haiku-4-5',
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'data', name: 'read_data', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'data', content: JSON.stringify(rows) }] },
      { role: 'assistant', content: 'Data loaded.' },
      { role: 'user', content: question },
    ],
  };

  try {
    const routed = await pixroom.route('anthropic', 'claude-haiku-4-5', body, 'payg');
    const row = routed.report.rows.find((candidate) => candidate.stage === 'virtual');
    if (!row?.applied) throw new Error(`QCV demo did not apply: ${row?.reason ?? 'missing stage'}`);
    const savedPercent = row.tokensText > 0 ? (row.tokensSaved / row.tokensText) * 100 : 0;
    const serialized = JSON.stringify(routed.body);
    const exact = serialized.includes('user733@example.com');
    const queryFallback = serialized.includes('"name":"pixroom_query"');
    return [
      'pixroom QCV demo (offline)',
      `dataset: 1,000 exact JSON rows (${JSON.stringify(rows).length.toLocaleString()} chars)`,
      `question: ${question}`,
      `dataset region: ${row.tokensText.toLocaleString()} -> ${row.tokensCompressed.toLocaleString()} estimated tokens (${savedPercent.toFixed(1)}% smaller)`,
      `exact answer materialized: ${exact ? 'user733@example.com' : 'FAILED'}`,
      `model-driven fallback: ${queryFallback ? 'injected' : 'not needed'}`,
      'network requests: 0',
    ].join('\n');
  } finally {
    await pixroom.shutdown();
  }
}

async function cmdDemo(): Promise<void> {
  console.log(await runQcvDemo());
}

async function cmdDoctor(rest: string[]): Promise<void> {
  if (rest[0] === 'copilot') {
    cmdDoctorCopilot();
    return;
  }
  const cfg = loadConfig();
  const lines: string[] = [`pixroom ${version()} doctor`, ''];
  lines.push(`node:            ${process.version}`);

  let pxpipeOk = false;
  try {
    await import('pxpipe-proxy/applicability');
    pxpipeOk = true;
  } catch {
    /* not installed */
  }
  lines.push(`pxpipe-proxy:    ${pxpipeOk ? 'available (optical stage ready)' : 'MISSING — run npm install'}`);

  const pixroom = createPixroom();
  const { sidecar } = await pixroom.warmup();
  lines.push(`headroom sidecar: ${sidecar} (${cfg.semantic.sidecarUrl})`);
  lines.push('');
  lines.push(`optical enabled:  ${cfg.optical.enabled}`);
  lines.push(`semantic enabled: ${cfg.semantic.enabled}`);
  lines.push(`QCV exact:        ${cfg.virtualContext.enabled ? 'enabled (safe default)' : 'disabled'}`);
  lines.push(`QCV fallback:     ${cfg.virtualContext.queryFallback ? 'ENABLED (experimental)' : 'disabled'}`);
  lines.push(`QCV store limit:  ${cfg.virtualContext.maxEntries} datasets / ${Math.round(cfg.virtualContext.maxStoredBytes / 1024 / 1024)} MiB`);
  lines.push(`optical scope:    ${cfg.optical.allowedModelBases == null ? 'pxpipe default (Fable-5)' : `[${cfg.optical.allowedModelBases.join(', ') || 'none'}]`}`);
  lines.push('');
  lines.push(
    sidecar === 'unavailable'
      ? 'note: semantic stage is degraded (optical still active). Install headroom-ai\n      (PyPI) or set PIXROOM_HEADROOM_URL to a running proxy to enable it.'
      : 'enabled optimizer dependencies ready.',
  );
  console.log(lines.join('\n'));
  await pixroom.shutdown();
}

async function cmdStats(): Promise<void> {
  const cfg = loadConfig();
  const url = `http://${cfg.host}:${cfg.port}/stats`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    console.log(await res.text());
  } catch (err) {
    console.error(`could not reach a running pixroom proxy at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('start one with: pixroom proxy');
    process.exitCode = 1;
  }
}

async function cmdMcp(): Promise<void> {
  await runMcpServer();
}

async function cmdIntegration(args: string[]): Promise<void> {
  const action = args[0] ?? 'list';
  if (action !== 'list') {
    console.error('usage: pixroom integration list');
    process.exitCode = 1;
    return;
  }

  const pixroom = createPixroom();
  console.log('ID                  ORDER  FIDELITY    CACHE              REGIONS');
  for (const integration of pixroom.integrations.ordered()) {
    const capabilities = integration.capabilities;
    console.log(
      [
        integration.id.padEnd(19),
        String(integration.order).padEnd(6),
        capabilities.fidelity.padEnd(11),
        capabilities.cacheImpact.padEnd(18),
        capabilities.regions.join(','),
      ].join(' '),
    );
  }
  await pixroom.shutdown();
}

function cmdAgent(args: string[]): void {
  const action = args[0] ?? 'list';
  if (action !== 'list') {
    console.error('usage: pixroom agent list');
    process.exitCode = 1;
    return;
  }
  console.log('ID          INTERCEPTION  PROTOCOLS');
  for (const descriptor of describeAgents()) {
    console.log(
      `${descriptor.id.padEnd(11)} ${descriptor.interception.padEnd(13)} ${descriptor.protocols.join(',')}`,
    );
  }
}

function cmdDoctorCopilot(): void {
  const pf = copilotPreflight();
  const lines: string[] = [`pixroom ${version()} doctor: copilot`, ''];
  lines.push(
    `headroom backbone: ${pf.headroomBin ? `OK  (${pf.headroomBin})` : 'MISSING — pipx install headroom-ai, or set PIXROOM_HEADROOM_BIN'}`,
  );
  lines.push(
    `copilot CLI:       ${pf.copilotCli ? `OK  (${pf.copilotCli})` : 'MISSING — npm install -g @github/copilot'}`,
  );
  const token =
    pf.tokenFound === true
      ? 'OK  (GITHUB_COPILOT_TOKEN set)'
      : 'read from Keychain at launch (allow the one-time prompt), or set GITHUB_COPILOT_TOKEN';
  lines.push(`copilot login:     ${token}`);
  lines.push(`default model:     ${pf.model} (override with --model or PIXROOM_COPILOT_MODEL)`);
  lines.push('');
  const ready = Boolean(pf.headroomBin) && Boolean(pf.copilotCli);
  lines.push(
    ready
      ? `ready → pixroom wrap copilot -- --model ${pf.model}`
      : 'not ready — resolve the items above, then re-run `pixroom doctor copilot`.',
  );
  console.log(lines.join('\n'));
}

async function cmdWrap(args: string[]): Promise<void> {
  const agent = args[0];
  if (!agent || agent === '-h' || agent === '--help') {
    console.error('usage: pixroom wrap <agent> [--byok] [--context-tool] [-p PORT] [-v] [-- <agent args>]');
    console.error(`agents: ${knownAgents().join(', ')}`);
    process.exitCode = agent ? 0 : 1;
    return;
  }

  // Everything after `--` goes to the agent; pixroom flags come before it.
  const dd = args.indexOf('--');
  const head = dd >= 0 ? args.slice(1, dd) : args.slice(1);
  const tail = dd >= 0 ? args.slice(dd + 1) : [];

  let byok = false;
  let verbose = false;
  let contextTool = false;
  let port: number | undefined;
  const preArgs: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i]!;
    if (a === '--byok') byok = true;
    else if (a === '-v' || a === '--verbose') verbose = true;
    else if (a === '--context-tool' || a === '--rtk') contextTool = true;
    else if (a === '-p' || a === '--port') {
      const val = head[++i];
      if (val) port = Number(val);
    } else preArgs.push(a);
  }

  const code = await runWrap({
    agent,
    passthrough: [...preArgs, ...tail],
    byok,
    contextTool,
    port,
    verbose,
  });
  process.exit(code);
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'proxy':
      return cmdProxy(rest);
    case 'export':
      return cmdExport(rest);
    case 'demo':
      return cmdDemo();
    case 'doctor':
      return cmdDoctor(rest);
    case 'stats':
      return cmdStats();
    case 'integration':
    case 'integrations':
      return cmdIntegration(rest);
    case 'agent':
    case 'agents':
    case 'adapters':
      return cmdAgent(rest);
    case 'mcp':
      return cmdMcp();
    case 'wrap':
      return cmdWrap(rest);
    case 'version':
    case '--version':
    case '-v':
      console.log(version());
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}
