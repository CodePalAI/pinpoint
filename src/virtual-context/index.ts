export {
  aggregateAnthropicUsage,
  continueVirtualAnthropicTurn,
} from './anthropic.js';
export {
  VIRTUAL_QUERY_TOOL_NAME,
  VirtualContextStore,
  virtualQueryToolSchema,
} from './store.js';
export type {
  VirtualContextDescriptor,
  VirtualContextKind,
  VirtualContextInspection,
  VirtualContextPrefetch,
  VirtualContextQuery,
} from './store.js';
export {
  VIRTUAL_CONTEXT_INTEGRATION_ID,
  VirtualContextIntegration,
} from '../integrations/virtual-context.js';