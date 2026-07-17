/**
 * pinpoint core assembly — wires config, logger, the headroom sidecar, both
 * compressor stages, the unified CCR store, and the ContentRouter into one object.
 * This is the embeddable core the SDK, proxy, MCP, and CLI all build on
 * (planning/end_product.md §6).
 */

import { loadConfig, type PinpointConfig, type PinpointConfigOverrides } from './config.js';
import { CaptureWriter } from './capture/store.js';
import { OtlpHttpExporter } from './telemetry/otlp.js';
import { createLogger, type Logger } from './logger.js';
import { CcrStore } from './ccr/store.js';
import { OpticalCompressor } from './compressors/optical.js';
import { SemanticCompressor } from './compressors/semantic.js';
import {
  HEADROOM_SEMANTIC_INTEGRATION_ID,
  LegacyCompressorIntegration,
  PXPIPE_OPTICAL_INTEGRATION_ID,
} from './integrations/legacy-compressor.js';
import { VirtualContextIntegration } from './integrations/virtual-context.js';
import { IntegrationPipeline } from './kernel/pipeline.js';
import { IntegrationRegistry } from './kernel/registry.js';
import { PolicyStore } from './policy/store.js';
import { StoreBackedRecorder } from './policy/retrieval-recorder.js';
import { CrossModalController, DEFAULT_CONTROLLER_CONFIG } from './policy/controller.js';
import { HeadroomSidecar, type SidecarState } from './sidecar/headroom-sidecar.js';
import { VirtualContextStore } from './virtual-context/store.js';
import { ContentRouter, type RouteResult } from './router/content-router.js';
import type { ProcessorIntegration } from './kernel/types.js';
import type { ProposalValidation } from './kernel/types.js';
import type { AuthMode, Provider, SavingsReport } from './types.js';
import {
  DASHBOARD_SCHEMA_VERSION,
  sanitizeDashboardLabel,
  type DashboardMetricBasis,
  type DashboardObserver,
  type DashboardProviderRouteEvent,
} from './dashboard/types.js';

/** Running session totals for the `stats` view. */
export interface SessionStats {
  requests: number;
  tokensTextTotal: number;
  tokensCompressedTotal: number;
  tokensSavedTotal: number;
  reversibleTotal: number;
  opticalApplied: number;
  semanticApplied: number;
  virtualApplied: number;
}

export interface Pinpoint {
  readonly config: PinpointConfig;
  readonly log: Logger;
  readonly router: ContentRouter;
  readonly ccr: CcrStore;
  /** Durable request-decision capture, disabled unless a path is configured. */
  readonly capture: CaptureWriter;
  /** Content-free OTLP/HTTP optimization spans, disabled unless configured. */
  readonly telemetry: OtlpHttpExporter;
  readonly sidecar: HeadroomSidecar;
  /** Exact local datasets offloaded by the virtual-context integration. */
  readonly virtualContext: VirtualContextStore;
  /** Request-side optimizer integrations active in this runtime. */
  readonly integrations: IntegrationRegistry;
  /** False means the proxy can forward matched request bytes without decoding. */
  readonly requestOptimizationEnabled: boolean;
  /** Minimum request inspection needed for a provider under the resolved integration set. */
  requestInspection(provider: Provider): 'none' | 'tool-results' | 'full';
  /** Persistent cross-modal policy store, when the adaptive path is enabled. */
  readonly policy?: PolicyStore;
  /** Compress + route a parsed provider request body. Never throws (degrades). */
  route(
    provider: Provider,
    model: string | null,
    body: Record<string, unknown>,
    authMode?: AuthMode,
    validate?: ProposalValidation,
  ): Promise<RouteResult>;
  /** Retrieve an offloaded original by CCR hash / rec_ id. */
  retrieve(id: string): Promise<string | null>;
  /** Ensure the semantic sidecar is up (or degrade). Safe to call repeatedly. */
  warmup(): Promise<{ sidecar: SidecarState }>;
  /** Snapshot of running session savings. */
  stats(): SessionStats;
  /** Stop any managed sidecar child. */
  shutdown(): Promise<void>;
}

export interface RuntimeOptions {
  /** Existing environment/config override surface. */
  readonly config?: PinpointConfigOverrides;
  /** Additional request-side optimizer integrations. */
  readonly integrations?: readonly ProcessorIntegration[];
  /** Disable pxpipe/headroom registration to build a standalone custom runtime. */
  readonly includeBuiltinIntegrations?: boolean;
  /** Optional content-free observer for local dashboard and embedding surfaces. */
  readonly observer?: DashboardObserver;
}

/** Generic integration-host assembly. `createPinpoint` is the built-in compatibility facade. */
export function createRuntime(options: RuntimeOptions = {}): Pinpoint {
  const config = loadConfig(options.config);
  const log = createLogger(config.logLevel);
  const capture = new CaptureWriter(config.capture, (error) =>
    log.warn(`capture degraded: ${error instanceof Error ? error.message : String(error)}`),
  );
  const telemetry = new OtlpHttpExporter(config.telemetry, (error) =>
    log.warn(`telemetry degraded: ${error instanceof Error ? error.message : String(error)}`),
  );

  const sidecar = new HeadroomSidecar(config.semantic, log.child('sidecar'));
  const semantic = new SemanticCompressor(config.semantic, sidecar, log.child('semantic'));
  const optical = new OpticalCompressor(config.optical, log.child('optical'));
  const virtualContext = new VirtualContextStore(
    Math.max(256, config.virtualContext.maxResultChars),
    Math.max(1, config.virtualContext.maxEntries),
    Math.max(1, config.virtualContext.maxStoredBytes),
  );
  const integrations = new IntegrationRegistry();
  if (options.includeBuiltinIntegrations !== false) {
    integrations
      .register(new VirtualContextIntegration(config.virtualContext, virtualContext))
      .register(
        new LegacyCompressorIntegration(semantic, {
          id: HEADROOM_SEMANTIC_INTEGRATION_ID,
          version: 'builtin',
          order: 10,
          regions: ['tool-result', 'history', 'current-turn'],
          fidelity: 'reversible',
          cacheImpact: 'preserve',
        }),
      )
      .register(
        new LegacyCompressorIntegration(optical, {
          id: PXPIPE_OPTICAL_INTEGRATION_ID,
          version: '0.8.0',
          order: 20,
          regions: ['system', 'tools'],
          fidelity: 'reversible',
          cacheImpact: 'move-breakpoint',
        }),
      );
  }
  for (const integration of options.integrations ?? []) {
    integrations.register(integration);
  }
  const requestOptimizationEnabled =
    (options.includeBuiltinIntegrations !== false &&
      (config.semantic.enabled || config.optical.enabled)) ||
      (options.includeBuiltinIntegrations !== false && config.virtualContext.enabled) ||
    (options.integrations?.length ?? 0) > 0;
  const hasCustomIntegrations = (options.integrations?.length ?? 0) > 0;
  function requestInspection(provider: Provider): 'none' | 'tool-results' | 'full' {
    if (hasCustomIntegrations || config.semantic.enabled || config.optical.enabled) return 'full';
    if (config.virtualContext.enabled) return 'tool-results';
    return 'none';
  }

  // Cross-modal policy: only stand up the store + recorder when the adaptive path
  // is enabled or in observe-only mode. Otherwise the recorder is absent and the
  // store contributes zero overhead — behavior is byte-identical to the static path.
  const policyActive = config.adaptive.enabled || config.adaptive.logOnly;
  const policy = policyActive
    ? new PolicyStore(config.adaptive.storePath || undefined).load()
    : undefined;
  const policyLog = log.child('policy');
  const recorder = policy ? new StoreBackedRecorder(policy, (m) => policyLog.debug(m)) : undefined;

  // The controller only changes routing when the adaptive path is fully enabled.
  // In log-only mode the recorder still gathers evidence, but routing is untouched.
  const controller =
    policy && config.adaptive.enabled && (config.mode === 'optimize' || config.mode === 'enforce')
      ? new CrossModalController(policy, DEFAULT_CONTROLLER_CONFIG, Math.random, (m) => policyLog.debug(m))
      : undefined;

  // The semantic compressor doubles as the CCR retriever for headroom hashes.
  const ccr = new CcrStore(semantic, recorder, {
    maxEntries: config.ccr.maxEntries,
    maxStoredBytes: config.ccr.maxStoredBytes,
    ttlMs: config.ccr.ttlMs,
  });
  const pipeline = new IntegrationPipeline(integrations);
  const router = new ContentRouter(
    pipeline,
    ccr,
    log.child('router'),
    config.mode,
    controller,
    config.ccr,
  );

  const totals: SessionStats = {
    requests: 0,
    tokensTextTotal: 0,
    tokensCompressedTotal: 0,
    tokensSavedTotal: 0,
    reversibleTotal: 0,
    opticalApplied: 0,
    semanticApplied: 0,
    virtualApplied: 0,
  };

  function accumulate(report: SavingsReport): void {
    totals.requests += 1;
    totals.tokensTextTotal += report.tokensTextTotal;
    totals.tokensCompressedTotal += report.tokensCompressedTotal;
    totals.tokensSavedTotal += report.tokensSavedTotal;
    totals.reversibleTotal += report.reversibleCount;
    for (const row of report.rows) {
      if (!row.applied) continue;
      if (row.stage === 'optical') totals.opticalApplied += 1;
      else if (row.stage === 'semantic') totals.semanticApplied += 1;
      else totals.virtualApplied += 1;
    }
  }

  function observe(event: DashboardProviderRouteEvent): void {
    if (!options.observer) return;
    try {
      const pending = options.observer.onEvent(event);
      if (pending) void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Observability must never change request behavior.
    }
  }

  return {
    config,
    log,
    router,
    ccr,
    capture,
    telemetry,
    sidecar,
    virtualContext,
    integrations,
    requestOptimizationEnabled,
    requestInspection,
    policy,
    async route(provider, model, body, authMode, validate) {
      const observed = capture.enabled || telemetry.enabled || options.observer != null;
      const startedAtUnixMs = observed ? Date.now() : 0;
      const started = observed ? performance.now() : 0;
      const resolvedAuthMode = authMode ?? 'payg';
      const originalBody = capture.enabled ? structuredClone(body) : undefined;
      const result = await router.route(provider, model, body, authMode, validate);
      accumulate(result.report);
      const durationMs = observed ? performance.now() - started : 0;
      if (telemetry.enabled) {
        telemetry.enqueue({
          startedAtUnixMs,
          durationMs,
          provider,
          model,
          authMode: resolvedAuthMode,
          mode: config.mode,
          report: result.report,
          pipeline: result.pipeline,
        });
      }
      if (originalBody) {
        capture.record({
          durationMs,
          provider,
          model,
          authMode: resolvedAuthMode,
          mode: config.mode,
          originalBody,
          transformedBody: result.body,
          report: result.report,
          pipeline: result.pipeline,
        });
      }
      if (options.observer) {
        const occurredAt = new Date(startedAtUnixMs).toISOString();
        const metric = (value: number, basis: DashboardMetricBasis) => ({
          value,
          unit: 'tokens' as const,
          source: 'pinpoint' as const,
          basis,
          scope: 'request' as const,
        });
        const bases = new Set(result.report.rows.map((row) => row.basis));
        const aggregateBasis: DashboardMetricBasis = bases.size === 1
          ? result.report.rows[0]!.basis
          : 'mixed-token-bases';
        observe({
          schemaVersion: DASHBOARD_SCHEMA_VERSION,
          type: 'provider.route',
          source: 'pinpoint',
          occurredAt,
          provider,
          model: sanitizeDashboardLabel(model),
          authMode: resolvedAuthMode,
          mode: config.mode,
          durationMs,
          tokensText: metric(result.report.tokensTextTotal, aggregateBasis),
          tokensCompressed: metric(result.report.tokensCompressedTotal, aggregateBasis),
          tokensSaved: metric(result.report.tokensSavedTotal, aggregateBasis),
          reversibleCount: result.report.reversibleCount,
          stages: result.report.rows.map((row) => ({ ...row })),
        });
      }
      return result;
    },
    retrieve: (id) => ccr.retrieve(id),
    async warmup() {
      if (config.semantic.enabled) await sidecar.ensureHealthy();
      return { sidecar: sidecar.status };
    },
    stats: () => ({ ...totals }),
    shutdown: async () => {
      policy?.save();
      await telemetry.flush();
      await sidecar.stop();
      ccr.clear();
    },
  };
}

export function createPinpoint(overrides: PinpointConfigOverrides = {}): Pinpoint {
  return createRuntime({ config: overrides });
}
