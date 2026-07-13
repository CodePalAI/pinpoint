/**
 * pixroom configuration — resolved from environment variables with safe defaults.
 *
 * pixroom follows pxpipe's "loopback-only by default" posture and headroom's
 * `HEADROOM_*` tunability. Optical model scope defaults to pxpipe's own opt-in
 * posture (Fable-5 only) rather than silently imaging weak readers
 * (planning/pxpipe_integration.md §6).
 */

import type { Provider } from './types.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface OpticalConfig {
  /** Master switch for the pxpipe optical stage. */
  readonly enabled: boolean;
  /**
   * CSV of allowed model bases for optical imaging, or `null` to keep pxpipe's
   * built-in default scope (Fable-5 only). Empty array disables optical entirely.
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
  /** Port used when pixroom spawns the sidecar itself. */
  readonly sidecarPort: number;
  /** Recent turns to protect from semantic compression (maps to CCR `protect_recent`). */
  readonly protectRecent: number;
  /** Skip semantic compression below this many tokens of compressible content. */
  readonly minTokensToCompress: number;
  /** Milliseconds to wait for a sidecar /health check before degrading. */
  readonly healthTimeoutMs: number;
  /** Milliseconds to wait for a spawned sidecar to become healthy. */
  readonly spawnReadyTimeoutMs: number;
  /**
   * Also hand headroom the large plain-text prose blocks in non-recent USER turns
   * (not just `tool_result` blocks). This routes prose to headroom's ML prose
   * compressor (Kompress) — the region pixroom otherwise passes through raw.
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
}

export interface PixroomConfig {
  readonly host: string;
  readonly port: number;
  readonly upstreams: Readonly<Record<Provider, string>>;
  readonly optical: OpticalConfig;
  readonly semantic: SemanticConfig;
  readonly ccr: CcrConfig;
  readonly logLevel: LogLevel;
}

/** Shallow-per-section overrides accepted by {@link loadConfig} / embedders. */
export interface PixroomConfigOverrides {
  host?: string;
  port?: number;
  upstreams?: Partial<Record<Provider, string>>;
  optical?: Partial<OpticalConfig>;
  semantic?: Partial<SemanticConfig>;
  ccr?: Partial<CcrConfig>;
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

/**
 * Resolve optical model scope. `PIXROOM_MODELS`:
 *   unset      → `null` (pxpipe default: Fable-5 only)
 *   'off'      → `[]`   (optical disabled)
 *   'a,b,c'    → those model bases allowed
 */
function resolveOpticalScope(): readonly string[] | null {
  const raw = process.env.PIXROOM_MODELS;
  if (raw == null || raw.trim() === '') return null;
  if (raw.trim().toLowerCase() === 'off') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveLogLevel(): LogLevel {
  const raw = (process.env.PIXROOM_LOG ?? 'info').trim().toLowerCase();
  const allowed: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];
  return (allowed as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

/** Build the pixroom config from the current environment, applying overrides last. */
export function loadConfig(overrides: PixroomConfigOverrides = {}): PixroomConfig {
  const opticalScope = resolveOpticalScope();
  const base: PixroomConfig = {
    host: envStr('PIXROOM_HOST', '127.0.0.1'),
    port: envInt('PIXROOM_PORT', 8788),
    upstreams: {
      anthropic: envStr(
        'PIXROOM_ANTHROPIC_UPSTREAM',
        envStr('ANTHROPIC_UPSTREAM', DEFAULT_ANTHROPIC_UPSTREAM),
      ),
      openai: envStr(
        'PIXROOM_OPENAI_UPSTREAM',
        envStr('OPENAI_UPSTREAM', DEFAULT_OPENAI_UPSTREAM),
      ),
    },
    optical: {
      enabled: envBool('PIXROOM_OPTICAL', true) && opticalScope?.length !== 0,
      allowedModelBases: opticalScope,
      emitRecoverable: envBool('PIXROOM_OPTICAL_RECOVERABLE', true),
      allowOnSubscription: envBool('PIXROOM_OPTICAL_ON_SUBSCRIPTION', false),
    },
    semantic: {
      enabled: envBool('PIXROOM_SEMANTIC', true),
      sidecarUrl: envStr('PIXROOM_HEADROOM_URL', 'http://127.0.0.1:8787'),
      autoSpawn: envBool('PIXROOM_HEADROOM_AUTOSPAWN', true),
      sidecarPort: envInt('PIXROOM_HEADROOM_PORT', 8787),
      protectRecent: envInt('PIXROOM_PROTECT_RECENT', 4),
      minTokensToCompress: envInt('PIXROOM_MIN_TOKENS', 250),
      healthTimeoutMs: envInt('PIXROOM_HEALTH_TIMEOUT_MS', 1500),
      spawnReadyTimeoutMs: envInt('PIXROOM_SPAWN_READY_TIMEOUT_MS', 20000),
      includeUserProse: envBool('PIXROOM_SEMANTIC_PROSE', false),
      proseMinChars: envInt('PIXROOM_SEMANTIC_PROSE_MIN_CHARS', 800),
    },
    ccr: {
      injectRetrieveTool: envBool('PIXROOM_CCR_TOOL', true),
    },
    logLevel: resolveLogLevel(),
  };

  return {
    ...base,
    ...overrides,
    upstreams: { ...base.upstreams, ...overrides.upstreams },
    optical: { ...base.optical, ...overrides.optical },
    semantic: { ...base.semantic, ...overrides.semantic },
    ccr: { ...base.ccr, ...overrides.ccr },
  };
}
