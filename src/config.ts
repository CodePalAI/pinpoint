/**
 * pinpoint configuration — resolved from environment variables with safe defaults.
 *
 * pinpoint follows pxpipe's "loopback-only by default" posture and headroom's
 * `HEADROOM_*` tunability. Optical model scope defaults to pxpipe's own opt-in
 * posture (Fable-5 only) rather than silently imaging weak readers
 * (planning/pxpipe_integration.md §6).
 */

import type { Provider } from './types.js';
import type { RuntimeMode } from './kernel/types.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface OpticalConfig {
  /** Master switch for the pxpipe optical stage. */
  readonly enabled: boolean;
  /**
    * Model bases allowed for optical imaging. `null` uses Pinpoint's reviewed
    * Fable-5-only default. Empty array disables optical entirely.
   */
  readonly allowedModelBases: readonly string[] | null;
  /** Emit pxpipe `recoverable` originals and register them into the CCR store. */
  readonly emitRecoverable: boolean;
  /**
   * Allow lossy optical imaging on oauth/subscription auth. Default false: imaging
   * rewrites the system prompt into an image, which is too aggressive for stealth
   * (subscription/OAuth) traffic. Opt in only if you accept pxpipe's always-image bet.
   */
  readonly allowOnSubscription: boolean;
}

export interface SemanticConfig {
  /** Master switch for the headroom semantic stage. */
  readonly enabled: boolean;
  /** Base URL of the headroom sidecar (loopback). */
  readonly sidecarUrl: string;
  /** Auto-spawn `headroom proxy` when the sidecar is not reachable. */
  readonly autoSpawn: boolean;
  /** Port used when pinpoint spawns the sidecar itself. */
  readonly sidecarPort: number;
  /** Recent turns to protect from semantic compression (maps to CCR `protect_recent`). */
  readonly protectRecent: number;
  /** Skip semantic compression below this many tokens of compressible content. */
  readonly minTokensToCompress: number;
  /** Milliseconds to wait for a sidecar /health check before degrading. */
  readonly healthTimeoutMs: number;
  /** Milliseconds to wait for a spawned sidecar to become healthy. */
  readonly spawnReadyTimeoutMs: number;
  /** Milliseconds to wait for a sidecar compression or retrieval request. */
  readonly requestTimeoutMs: number;
  /**
   * Also hand headroom the large plain-text prose blocks in non-recent USER turns
   * (not just `tool_result` blocks). This routes prose to headroom's ML prose
   * compressor (Kompress) — the region pinpoint otherwise passes through raw.
   * Off by default: recent turns and model output are never touched, but user
   * prose is content, so it stays opt-in. Reversible via CCR when offloaded.
   */
  readonly includeUserProse: boolean;
  /** Per-block floor (chars) for a user prose block to be worth compressing. */
  readonly proseMinChars: number;
}

export interface CcrConfig {
  /** Inject the `headroom_retrieve` tool when compression offloads content. */
  readonly injectRetrieveTool: boolean;
  /** Execute pure retrieval tool calls inside the proxy instead of leaking them to the client. */
  readonly continueToolCalls: boolean;
  /** Maximum hidden retrieval continuation rounds. */
  readonly maxContinuationRounds: number;
  /** Maximum reversible handles retained in process memory. */
  readonly maxEntries: number;
  /** Maximum inline original bytes retained in process memory. */
  readonly maxStoredBytes: number;
  /** Time-to-live for retained handles in milliseconds. */
  readonly ttlMs: number;
}

export interface CaptureConfig {
  /** JSONL destination. Empty disables capture. */
  readonly path: string;
  /** Include original/transformed request bodies. Required for replay; explicit due sensitivity. */
  readonly includeBodies: boolean;
  /** Flush every record to durable storage before returning. */
  readonly fsync: boolean;
  /** Rotate before the active JSONL file exceeds this many bytes. */
  readonly maxBytes: number;
  /** Total active plus rotated files retained. */
  readonly maxFiles: number;
}

export interface TelemetryConfig {
  /** OTLP/HTTP traces endpoint. Empty disables export. */
  readonly endpoint: string;
  /** Additional collector headers, commonly used for authentication. */
  readonly headers: Readonly<Record<string, string>>;
  readonly serviceName: string;
  readonly timeoutMs: number;
  readonly maxQueue: number;
}

export interface VirtualContextConfig {
  /** Replace safely answerable structured tool results with exact local manifests. */
  readonly enabled: boolean;
  /** Allow unresolved questions to use model-driven pinpoint_query continuation. */
  readonly queryFallback: boolean;
  /** Recent messages protected from virtualization. */
  readonly protectRecent: number;
  /** Per-tool-result character floor. */
  readonly minChars: number;
  /** Per-tool-result character ceiling; larger results fall through. */
  readonly maxChars: number;
  /** Maximum characters returned by one local query. */
  readonly maxResultChars: number;
  /** Maximum exact datasets retained in one runtime process. */
  readonly maxEntries: number;
  /** Maximum exact dataset bytes retained in one runtime process. */
  readonly maxStoredBytes: number;
  /** Maximum datasets virtualized by one provider request. */
  readonly maxDatasetsPerRequest: number;
  /** Maximum hidden model continuation rounds for local queries. */
  readonly maxQueryRounds: number;
}

export interface AdaptiveConfig {
  /**
   * Master switch for the adaptive cross-modal controller. When on, the router may
   * override the fixed region→engine rules using learned per-(contentType × engine)
   * retrieval-regret. OFF by default: cold-start priors equal today's static rules,
   * but the path stays opt-in so current flows are untouched unless requested.
   */
  readonly enabled: boolean;
  /**
   * Observe-only mode: record the retrieval-regret signal (offers + retrievals) and
   * persist the policy store, but DO NOT change routing. Lets a deployment gather
   * evidence safely before enabling the controller.
   */
  readonly logOnly: boolean;
  /** Path to the persistent policy-store JSON. Empty ⇒ in-memory only (no persistence). */
  readonly storePath: string;
}

export interface PinpointConfig {
  readonly mode: RuntimeMode;
  readonly host: string;
  readonly port: number;
  /** Maximum request bytes buffered for optimization inspection. */
  readonly maxInspectionBytes: number;
  readonly upstreams: Readonly<Record<Provider, string>>;
  readonly optical: OpticalConfig;
  readonly semantic: SemanticConfig;
  readonly virtualContext: VirtualContextConfig;
  readonly ccr: CcrConfig;
  readonly capture: CaptureConfig;
  readonly telemetry: TelemetryConfig;
  readonly adaptive: AdaptiveConfig;
  readonly logLevel: LogLevel;
}

/** Shallow-per-section overrides accepted by {@link loadConfig} / embedders. */
export interface PinpointConfigOverrides {
  mode?: RuntimeMode;
  host?: string;
  port?: number;
  maxInspectionBytes?: number;
  upstreams?: Partial<Record<Provider, string>>;
  optical?: Partial<OpticalConfig>;
  semantic?: Partial<SemanticConfig>;
  virtualContext?: Partial<VirtualContextConfig>;
  ccr?: Partial<CcrConfig>;
  capture?: Partial<CaptureConfig>;
  telemetry?: Partial<TelemetryConfig>;
  adaptive?: Partial<AdaptiveConfig>;
  logLevel?: LogLevel;
}

const DEFAULT_ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
const DEFAULT_OPENAI_UPSTREAM = 'https://api.openai.com';

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw == null || raw === '' ? fallback : raw;
}

function envHeaders(name: string, fallbackName: string): Readonly<Record<string, string>> {
  const raw = process.env[name] ?? process.env[fallbackName] ?? '';
  const headers: Record<string, string> = {};
  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function resolveOtlpEndpoint(): string {
  const direct = process.env.PINPOINT_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (direct?.trim()) return direct.trim();
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return base ? `${base.replace(/\/+$/, '')}/v1/traces` : '';
}

/**
 * Resolve optical model scope. `PINPOINT_MODELS`:
 *   unset      → Fable-5 only
 *   'off'      → `[]`   (optical disabled)
 *   'a,b,c'    → those model bases allowed
 */
function resolveOpticalScope(): readonly string[] | null {
  const raw = process.env.PINPOINT_MODELS;
  if (raw == null || raw.trim() === '') return ['claude-fable-5'];
  if (raw.trim().toLowerCase() === 'off') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveLogLevel(): LogLevel {
  const raw = (process.env.PINPOINT_LOG ?? 'info').trim().toLowerCase();
  const allowed: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];
  return (allowed as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

function resolveMode(): RuntimeMode {
  const raw = (process.env.PINPOINT_MODE ?? 'optimize').trim().toLowerCase();
  return ['audit', 'shadow', 'optimize', 'enforce'].includes(raw)
    ? (raw as RuntimeMode)
    : 'optimize';
}

/** Build the pinpoint config from the current environment, applying overrides last. */
export function loadConfig(overrides: PinpointConfigOverrides = {}): PinpointConfig {
  const opticalScope = resolveOpticalScope();
  const base: PinpointConfig = {
    mode: resolveMode(),
    host: envStr('PINPOINT_HOST', '127.0.0.1'),
    port: envInt('PINPOINT_PORT', 8788),
    maxInspectionBytes: envInt('PINPOINT_MAX_INSPECTION_BYTES', 32 * 1024 * 1024),
    upstreams: {
      anthropic: envStr(
        'PINPOINT_ANTHROPIC_UPSTREAM',
        envStr('ANTHROPIC_UPSTREAM', DEFAULT_ANTHROPIC_UPSTREAM),
      ),
      openai: envStr(
        'PINPOINT_OPENAI_UPSTREAM',
        envStr('OPENAI_UPSTREAM', DEFAULT_OPENAI_UPSTREAM),
      ),
    },
    optical: {
      enabled: envBool('PINPOINT_OPTICAL', true) && opticalScope?.length !== 0,
      allowedModelBases: opticalScope,
      emitRecoverable: envBool('PINPOINT_OPTICAL_RECOVERABLE', true),
      allowOnSubscription: envBool('PINPOINT_OPTICAL_ON_SUBSCRIPTION', false),
    },
    semantic: {
      enabled: envBool('PINPOINT_SEMANTIC', true),
      sidecarUrl: envStr('PINPOINT_HEADROOM_URL', 'http://127.0.0.1:8787'),
      autoSpawn: envBool('PINPOINT_HEADROOM_AUTOSPAWN', true),
      sidecarPort: envInt('PINPOINT_HEADROOM_PORT', 8787),
      protectRecent: envInt('PINPOINT_PROTECT_RECENT', 4),
      minTokensToCompress: envInt('PINPOINT_MIN_TOKENS', 250),
      healthTimeoutMs: envInt('PINPOINT_HEALTH_TIMEOUT_MS', 1500),
      spawnReadyTimeoutMs: envInt('PINPOINT_SPAWN_READY_TIMEOUT_MS', 20000),
      requestTimeoutMs: envInt('PINPOINT_HEADROOM_REQUEST_TIMEOUT_MS', 60000),
      includeUserProse: envBool('PINPOINT_SEMANTIC_PROSE', false),
      proseMinChars: envInt('PINPOINT_SEMANTIC_PROSE_MIN_CHARS', 800),
    },
    virtualContext: {
      enabled: envBool('PINPOINT_VIRTUAL_CONTEXT', true),
      queryFallback: envBool('PINPOINT_VIRTUAL_QUERY_FALLBACK', false),
      protectRecent: envInt('PINPOINT_VIRTUAL_PROTECT_RECENT', 1),
      minChars: envInt('PINPOINT_VIRTUAL_MIN_CHARS', 6_000),
      maxChars: envInt('PINPOINT_VIRTUAL_MAX_CHARS', 2_000_000),
      maxResultChars: envInt('PINPOINT_VIRTUAL_MAX_RESULT_CHARS', 12_000),
      maxEntries: envInt('PINPOINT_VIRTUAL_MAX_ENTRIES', 256),
      maxStoredBytes: envInt('PINPOINT_VIRTUAL_MAX_STORED_BYTES', 64 * 1024 * 1024),
      maxDatasetsPerRequest: envInt('PINPOINT_VIRTUAL_MAX_DATASETS_PER_REQUEST', 8),
      maxQueryRounds: envInt('PINPOINT_VIRTUAL_MAX_QUERY_ROUNDS', 4),
    },
    ccr: {
      injectRetrieveTool: envBool('PINPOINT_CCR_TOOL', true),
      continueToolCalls: envBool('PINPOINT_CCR_CONTINUATION', true),
      maxContinuationRounds: envInt('PINPOINT_CCR_MAX_CONTINUATION_ROUNDS', 3),
      maxEntries: envInt('PINPOINT_CCR_MAX_ENTRIES', 1000),
      maxStoredBytes: envInt('PINPOINT_CCR_MAX_STORED_BYTES', 64 * 1024 * 1024),
      ttlMs: envInt('PINPOINT_CCR_TTL_MS', 30 * 60 * 1000),
    },
    capture: {
      path: envStr('PINPOINT_CAPTURE_PATH', ''),
      includeBodies: envBool('PINPOINT_CAPTURE_BODIES', false),
      fsync: envBool('PINPOINT_CAPTURE_FSYNC', true),
      maxBytes: envInt('PINPOINT_CAPTURE_MAX_BYTES', 256 * 1024 * 1024),
      maxFiles: envInt('PINPOINT_CAPTURE_MAX_FILES', 3),
    },
    telemetry: {
      endpoint: resolveOtlpEndpoint(),
      headers: envHeaders('PINPOINT_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_HEADERS'),
      serviceName: envStr('PINPOINT_OTLP_SERVICE_NAME', 'pinpoint'),
      timeoutMs: envInt('PINPOINT_OTLP_TIMEOUT_MS', 2_000),
      maxQueue: envInt('PINPOINT_OTLP_MAX_QUEUE', 1_024),
    },
    adaptive: {
      enabled: envBool('PINPOINT_ADAPTIVE', false),
      logOnly: envBool('PINPOINT_ADAPTIVE_LOG', false),
      storePath: envStr('PINPOINT_ADAPTIVE_STORE', ''),
    },
    logLevel: resolveLogLevel(),
  };

  return {
    ...base,
    ...overrides,
    upstreams: { ...base.upstreams, ...overrides.upstreams },
    optical: { ...base.optical, ...overrides.optical },
    semantic: { ...base.semantic, ...overrides.semantic },
    virtualContext: { ...base.virtualContext, ...overrides.virtualContext },
    ccr: { ...base.ccr, ...overrides.ccr },
    capture: { ...base.capture, ...overrides.capture },
    telemetry: { ...base.telemetry, ...overrides.telemetry },
    adaptive: { ...base.adaptive, ...overrides.adaptive },
  };
}
