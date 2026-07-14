/**
 * pixroom SDK — the embeddable core (planning/end_product.md §6).
 *
 * `createPixroom()` returns the composed engine; `createProxyServer()` is the
 * standalone front door. Both consume pxpipe (optical, in-process) and headroom
 * (semantic, via the loopback sidecar) as pinned, unmodified dependencies.
 */

export { createPixroom, createRuntime } from './pixroom.js';
export type { Pixroom, RuntimeOptions, SessionStats } from './pixroom.js';

export { createProxyServer } from './proxy/server.js';
export type { ProxyServer, ProxyServerOptions } from './proxy/server.js';

export { CcrRetrievalOutputIntegration } from './output/ccr.js';
export { OutputIntegrationRegistry } from './output/registry.js';
export type { OutputEventContext, OutputIntegration, ResponseEvent } from './output/types.js';

export { createBuiltinProtocolRegistry } from './protocols/json.js';
export { ProtocolRegistry } from './protocols/registry.js';
export { createResponseEventDecoder } from './protocols/response-events.js';
export type { ProtocolAdapter, ProtocolMatchInput } from './protocols/types.js';

export { runMcpServer } from './mcp/server.js';

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
  VirtualContextKind,
  VirtualContextPrefetch,
  VirtualContextQuery,
} from './virtual-context/store.js';
export { HeadroomSidecar } from './sidecar/headroom-sidecar.js';
export type { SidecarState } from './sidecar/headroom-sidecar.js';

export { loadConfig } from './config.js';
export type {
  PixroomConfig,
  PixroomConfigOverrides,
  OpticalConfig,
  SemanticConfig,
  CcrConfig,
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
