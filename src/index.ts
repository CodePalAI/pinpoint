/**
 * pinpoint SDK — the embeddable core (planning/end_product.md §6).
 *
 * `createPinpoint()` returns the composed engine; `createProxyServer()` is the
 * standalone front door. Both consume pxpipe (optical, in-process) and headroom
 * (semantic, via the loopback sidecar) as pinned, unmodified dependencies.
 */

export { createPinpoint, createRuntime } from './pinpoint.js';
export type { Pinpoint, RuntimeOptions, SessionStats } from './pinpoint.js';
export {
  DASHBOARD_SCHEMA_VERSION,
  normalizeDashboardEvent,
  sanitizeDashboardLabel,
} from './dashboard/types.js';
export type {
  DashboardEvent,
  DashboardByteLane,
  DashboardHeadroomAttribution,
  DashboardHeadroomCoverage,
  DashboardHeadroomSampleEvent,
  DashboardHeadroomSummary,
  DashboardMetricBasis,
  DashboardMetricScope,
  DashboardMetricUnit,
  DashboardMetricValue,
  DashboardMcpFlowEvent,
  DashboardMcpLifecycleEvent,
  DashboardMcpOutcome,
  DashboardMcpQueryEvent,
  DashboardMcpResultEvent,
  DashboardMcpSummary,
  DashboardMcpToolEvent,
  DashboardObserver,
  DashboardProviderRouteEvent,
  DashboardProviderQuota,
  DashboardHistorySession,
  DashboardSnapshot,
  DashboardSource,
  DashboardSourceState,
  DashboardSourceSummary,
  DashboardStageOutcome,
  DashboardTokenLane,
} from './dashboard/types.js';
export {
  createDashboardGroupId,
  createDashboardProducerId,
  buildDashboardSnapshot,
  dashboardRootFromEnvironment,
  DashboardJournal,
  listDashboardHistory,
  pruneDashboardHistory,
  readDashboardGroup,
} from './dashboard/journal.js';
export type {
  DashboardGroupReadResult,
  DashboardJournalOptions,
  DashboardProducerState,
  DashboardPruneResult,
} from './dashboard/journal.js';
export { createDashboardServer, DEFAULT_DASHBOARD_PORT } from './dashboard/server.js';
export type {
  DashboardServer,
  DashboardServerAddress,
  DashboardServerOptions,
} from './dashboard/server.js';
export { dashboardOpenCommand, openDashboardInBrowser } from './dashboard/browser.js';
export type { DashboardOpenCommand, DashboardSpawn } from './dashboard/browser.js';
export { HeadroomDashboardAdapter } from './dashboard/headroom.js';
export type { HeadroomDashboardAdapterOptions } from './dashboard/headroom.js';

export { withPinpoint as withPinpointAnthropic } from './sdk/anthropic.js';
export { withPinpoint as withPinpointOpenAI } from './sdk/openai.js';
export type {
  PinpointClientHandle,
  ProviderSdkClient,
  WrappedPinpointClient,
  WithPinpointOptions,
} from './sdk/client.js';

export { createProxyServer } from './proxy/server.js';
export type { ProxyServer, ProxyServerOptions } from './proxy/server.js';

export { CcrRetrievalOutputIntegration } from './output/ccr.js';
export { OutputIntegrationRegistry } from './output/registry.js';
export type { OutputEventContext, OutputIntegration, ResponseEvent } from './output/types.js';

export { createBuiltinProtocolRegistry } from './protocols/json.js';
export { ProtocolRegistry } from './protocols/registry.js';
export { createResponseEventDecoder } from './protocols/response-events.js';
export type { ProtocolAdapter, ProtocolMatchInput } from './protocols/types.js';

export {
  DEFAULT_MCP_VIRTUALIZE_CHARS,
  MCP_ARTIFACT_URI_PREFIX,
  MCP_FLOW_TOOL_NAME,
  MCP_QUERY_TOOL,
  MCP_QUERY_TOOL_NAME,
  McpDestinationPeer,
  parseMcpOpaqueFlowDestinationConfig,
  McpResultFirewall,
  runMcpGateway,
  runMcpServer,
  parseMcpOpaqueFlowConfig,
  verifyMcpOpaqueFlowAuthorityBinding,
  verifyMcpOpaqueFlowPolicyOpening,
  verifyMcpOpaqueFlowReceipt,
} from './mcp/index.js';
export type {
  McpCallToolResult,
  McpDestinationState,
  McpDestinationStdioConfig,
  McpOpaqueFlowDestinationConfig,
  McpContentBlock,
  McpGatewayOptions,
  McpResultFirewallOptions,
  McpResultTransformation,
  McpOpaqueFlowConfig,
  McpOpaqueFlowAuthorityBinding,
  McpOpaqueFlowAuthorityRecord,
  McpOpaqueFlowAuthorityVerifier,
  McpOpaqueFlowOperation,
  McpOpaqueFlowPolicy,
  McpOpaqueFlowReceipt,
  McpOpaqueFlowReceiptVerifier,
  McpOpaqueFlowPolicyOpening,
} from './mcp/index.js';

export {
  AgentRegistry,
  BUILTIN_AGENT_REGISTRY,
  createBuiltinAgentRegistry,
  describeAgents,
  knownAgents,
} from './wrap/agents.js';
export type { AgentDescriptor, AgentInterception, WrapAgent } from './wrap/agents.js';

export { ContentRouter } from './router/content-router.js';
export type { RouteResult } from './router/content-router.js';

export { IntegrationPipeline } from './kernel/pipeline.js';
export type { PipelineHooks, PipelineResult } from './kernel/pipeline.js';
export { DeterministicPlanner } from './kernel/planner.js';
export { IntegrationRegistry } from './kernel/registry.js';
export { cloneRequestContext, transactProposal } from './kernel/transaction.js';
export type {
  CacheImpact,
  ContextPatch,
  FidelityClass,
  IntegrationCapabilities,
  IntegrationId,
  PlanDecision,
  ProcessorIntegration,
  ProposalEstimate,
  ProposalCommit,
  ProposalValidation,
  RegionKind,
  RuntimeMode,
  TransactionResult,
  TransformProposal,
} from './kernel/types.js';

export { CcrStore, CCR_TOOL_NAME } from './ccr/store.js';
export type { CcrRetriever } from './ccr/store.js';

export { CaptureWriter, hashCaptureBody, readCaptureFile, replayCaptureFile } from './capture/index.js';
export type {
  CaptureInput,
  CaptureRecord,
  CaptureStats,
  ReplaySummary,
} from './capture/index.js';

export { OtlpHttpExporter } from './telemetry/index.js';
export type { OptimizationSpanInput, TelemetryStats } from './telemetry/index.js';

export { OpticalCompressor } from './compressors/optical.js';
export { SemanticCompressor } from './compressors/semantic.js';
export {
  VIRTUAL_CONTEXT_INTEGRATION_ID,
  VirtualContextIntegration,
} from './integrations/virtual-context.js';
export {
  VIRTUAL_QUERY_TOOL_NAME,
  VirtualContextStore,
  virtualQueryToolSchema,
} from './virtual-context/store.js';
export {
  aggregateAnthropicUsage,
  continueVirtualAnthropicTurn,
} from './virtual-context/anthropic.js';
export type {
  VirtualContextDescriptor,
  VirtualContextInspection,
  VirtualContextJoinInspection,
  VirtualContextJoinQuery,
  VirtualContextKind,
  VirtualContextPrefetch,
  VirtualContextQuery,
} from './virtual-context/store.js';
export { HeadroomSidecar } from './sidecar/headroom-sidecar.js';
export type { SidecarState } from './sidecar/headroom-sidecar.js';

export { loadConfig } from './config.js';
export type {
  PinpointConfig,
  PinpointConfigOverrides,
  OpticalConfig,
  SemanticConfig,
  CcrConfig,
  CaptureConfig,
  TelemetryConfig,
  VirtualContextConfig,
  AdaptiveConfig,
  LogLevel,
} from './config.js';

export {
  buildReport,
  formatReport,
  summarizeReport,
  counterfactual,
  estimateTokens,
} from './measurement/savings.js';

export type {
  Provider,
  Stage,
  ContentType,
  TokenBasis,
  CompressionReason,
  Compressor,
  Counterfactual,
  ReversibleHandle,
  RequestContext,
  StageResult,
  StageOutcome,
  SavingsReport,
  SavingsRow,
} from './types.js';
