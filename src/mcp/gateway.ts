import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import {
  VIRTUAL_QUERY_TOOL_NAME,
  VirtualContextStore,
  type VirtualContextDescriptor,
  type VirtualContextJoinQuery,
  type VirtualContextQuery,
} from '../virtual-context/store.js';
import {
  MCP_FLOW_TOOL_NAME,
  McpOpaqueFlowEngine,
  type McpOpaqueFlowPolicy,
  type PreparedMcpOpaqueFlow,
} from './flow.js';

export const MCP_QUERY_TOOL_NAME = VIRTUAL_QUERY_TOOL_NAME;
export const MCP_ARTIFACT_URI_PREFIX = 'pinpoint://artifact/';
export const DEFAULT_MCP_VIRTUALIZE_CHARS = 16_000;
export { MCP_FLOW_TOOL_NAME };
export type { McpOpaqueFlowPolicy };

type JsonPrimitive = string | number | boolean | null;

export interface McpContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly uri?: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly [key: string]: unknown;
}

export interface McpCallToolResult {
  readonly content: readonly McpContentBlock[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface McpResultFirewallOptions {
  readonly minChars?: number;
  readonly maxResultChars?: number;
  readonly maxEntries?: number;
  readonly maxStoredBytes?: number;
  readonly exposeQueryTool?: boolean;
  readonly exposeArtifactResources?: boolean;
  readonly opaqueArtifactIds?: boolean;
  readonly flowToolAvailable?: boolean;
  readonly protectedSourceTools?: readonly string[];
}

export interface McpGatewayOptions extends McpResultFirewallOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly error?: Writable;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly shutdownGraceMs?: number;
  readonly flows?: readonly McpOpaqueFlowPolicy[];
}

export interface McpResultTransformation {
  readonly result: McpCallToolResult;
  readonly virtualized: boolean;
  readonly descriptor?: VirtualContextDescriptor;
}

export const MCP_QUERY_TOOL = {
  name: MCP_QUERY_TOOL_NAME,
  description:
    'Query an exact Pinpoint artifact without loading the full upstream MCP result. ' +
    'Use schema first when needed, then json_select, count, grep, slice, or json_join. ' +
    'Results are deterministic and bounded; narrow the query instead of requesting the full artifact.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        pattern: '^vctx_[a-f0-9]{32,64}$',
        description: 'Artifact id from a virtualized MCP result. Do not call this tool before receiving one.',
      },
      op: {
        type: 'string',
        enum: ['schema', 'json_select', 'count', 'grep', 'slice', 'json_join'],
      },
      where: {
        type: 'object',
        description: 'Exact field/value equality filters for JSON rows.',
        additionalProperties: {
          anyOf: [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'null' },
          ],
        },
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fields to return from matching JSON rows.',
      },
      query: { type: 'string', description: 'Literal text for grep or line counts.' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 0, maximum: 100 },
      joinId: {
        type: 'string',
        pattern: '^vctx_[a-f0-9]{32,64}$',
        description: 'Destination artifact id for json_join.',
      },
      on: { type: 'string', description: 'Shared key-shaped field for json_join.' },
    },
    required: ['id', 'op'],
    additionalProperties: false,
  },
} as const;

const MCP_ARTIFACT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pinpointArtifact: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sourceTool: { type: 'string' },
        kind: { type: 'string', enum: ['json-array', 'json-object', 'lines'] },
        bytes: { type: 'integer', minimum: 0 },
        items: { type: 'integer', minimum: 0 },
        fields: { type: 'array', items: { type: 'string' } },
        dataPath: { type: 'array', items: { type: 'string' } },
        queryTool: { type: 'string' },
        flowTool: { type: 'string' },
      },
      required: ['id', 'sourceTool', 'kind', 'bytes', 'items', 'fields'],
      additionalProperties: false,
    },
  },
  required: ['pinpointArtifact'],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
  );
}

function exactWhere(value: unknown): Readonly<Record<string, JsonPrimitive>> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new TypeError('where must be an object of exact JSON primitive values');
  const entries = Object.entries(value);
  if (entries.length > 16 || entries.some(([, item]) => !isJsonPrimitive(item))) {
    throw new TypeError('where must contain at most 16 exact JSON primitive values');
  }
  return Object.fromEntries(entries) as Readonly<Record<string, JsonPrimitive>>;
}

function stringList(value: unknown, field: string): readonly string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 256)
  ) {
    throw new TypeError(`${field} must contain at most 32 non-empty strings`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function parseQuery(args: Record<string, unknown>): VirtualContextQuery | VirtualContextJoinQuery {
  const id = args.id;
  const op = args.op;
  if (typeof id !== 'string' || !/^vctx_[a-f0-9]{32,64}$/.test(id)) {
    throw new TypeError('id must be a Pinpoint artifact id');
  }
  if (!['schema', 'json_select', 'count', 'grep', 'slice', 'json_join'].includes(String(op))) {
    throw new TypeError('unsupported artifact operation');
  }

  const where = exactWhere(args.where);
  const fields = stringList(args.fields, 'fields');
  const query = args.query;
  if (query != null && (typeof query !== 'string' || query.length === 0 || query.length > 512)) {
    throw new TypeError('query must be a non-empty string of at most 512 characters');
  }

  if (op === 'json_join') {
    if (
      typeof args.joinId !== 'string' ||
      !/^vctx_[a-f0-9]{32,64}$/.test(args.joinId) ||
      typeof args.on !== 'string' ||
      !where ||
      !fields?.length
    ) {
      throw new TypeError('json_join requires joinId, on, where, and fields');
    }
    return { id, op, joinId: args.joinId, on: args.on, where, fields };
  }

  return {
    id,
    op: op as VirtualContextQuery['op'],
    ...(where ? { where } : {}),
    ...(fields ? { fields } : {}),
    ...(typeof query === 'string' ? { query } : {}),
    ...(args.offset != null ? { offset: optionalInteger(args.offset, 'offset') } : {}),
    ...(args.limit != null ? { limit: optionalInteger(args.limit, 'limit') } : {}),
  };
}

function exactPayload(result: McpCallToolResult): string | undefined {
  if (result.isError === true) return undefined;
  if (isRecord(result.structuredContent)) return JSON.stringify(result.structuredContent);
  if (!Array.isArray(result.content) || result.content.length !== 1) return undefined;
  const block = result.content[0];
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined;
  return block.text;
}

function artifactMimeType(descriptor: VirtualContextDescriptor): string {
  return descriptor.kind.startsWith('json-') ? 'application/json' : 'text/plain';
}

function displayToolName(sourceTool: string): string {
  const normalized = sourceTool.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return normalized.slice(0, 128) || 'upstream tool';
}

function virtualResult(
  sourceTool: string,
  descriptor: VirtualContextDescriptor,
  original: McpCallToolResult,
  queryToolAvailable: boolean,
  flowToolAvailable: boolean,
  resourceAvailable: boolean,
  protectedSource: boolean,
): McpCallToolResult {
  const label = displayToolName(sourceTool);
  const artifact = {
    id: descriptor.id,
    sourceTool,
    kind: descriptor.kind,
    bytes: descriptor.bytes,
    items: descriptor.items,
    fields: descriptor.fields,
    ...(descriptor.dataPath ? { dataPath: descriptor.dataPath } : {}),
    ...(queryToolAvailable ? { queryTool: MCP_QUERY_TOOL_NAME } : {}),
    ...(flowToolAvailable ? { flowTool: MCP_FLOW_TOOL_NAME } : {}),
  };
  const access = queryToolAvailable
    ? `Call ${MCP_QUERY_TOOL_NAME} with this id for bounded exact access.`
    : flowToolAvailable
      ? `Use ${MCP_FLOW_TOOL_NAME} with a configured flow to transfer an allowlisted projection without revealing it.`
      : 'The exact result is available only through its local resource handle.';
  const text = [
    `Pinpoint kept the exact ${descriptor.bytes}-byte result from ${label} outside model context.`,
    JSON.stringify(artifact),
    access,
  ].join('\n');

  return {
    ...(protectedSource ? {} : original),
    content: [
      { type: 'text', text },
      ...(resourceAvailable ? [{
        type: 'resource_link',
        uri: `${MCP_ARTIFACT_URI_PREFIX}${descriptor.id}`,
        name: `${label} result`,
        description: `Exact ${descriptor.kind} result retained by Pinpoint outside model context.`,
        mimeType: artifactMimeType(descriptor),
      }] : []),
    ],
    structuredContent: { pinpointArtifact: artifact },
    _meta: {
      ...(!protectedSource && isRecord(original._meta) ? original._meta : {}),
      pinpoint: { virtualized: true, artifact },
    },
  };
}

function artifactUri(id: string): string {
  return `${MCP_ARTIFACT_URI_PREFIX}${id}`;
}

function errorResult(message: string): McpCallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export class McpResultFirewall {
  readonly store: VirtualContextStore;
  readonly minChars: number;
  readonly exposeQueryTool: boolean;
  readonly exposeArtifactResources: boolean;
  readonly opaqueArtifactIds: boolean;
  readonly flowToolAvailable: boolean;
  private readonly protectedSourceTools: ReadonlySet<string>;
  private readonly descriptors = new Map<string, {
    descriptor: VirtualContextDescriptor;
    sourceTool: string;
    storeId: string;
  }>();

  constructor(options: McpResultFirewallOptions = {}) {
    this.minChars = Math.max(1, Math.trunc(options.minChars ?? DEFAULT_MCP_VIRTUALIZE_CHARS));
    this.exposeQueryTool = options.exposeQueryTool ?? true;
    this.exposeArtifactResources = options.exposeArtifactResources ?? this.exposeQueryTool;
    this.opaqueArtifactIds = options.opaqueArtifactIds ?? !this.exposeQueryTool;
    this.flowToolAvailable = options.flowToolAvailable ?? false;
    this.protectedSourceTools = new Set(options.protectedSourceTools ?? []);
    this.store = new VirtualContextStore(
      options.maxResultChars,
      options.maxEntries,
      options.maxStoredBytes,
    );
  }

  get tools(): readonly (typeof MCP_QUERY_TOOL)[] {
    return this.exposeQueryTool ? [MCP_QUERY_TOOL] : [];
  }

  private pruneDescriptors(): void {
    for (const [id, artifact] of this.descriptors) {
      if (!this.store.has(artifact.storeId)) this.descriptors.delete(id);
    }
  }

  private artifactId(storeId: string): string {
    if (!this.opaqueArtifactIds) return storeId;
    let id: string;
    do id = `vctx_${randomBytes(16).toString('hex')}`;
    while (this.descriptors.has(id));
    return id;
  }

  private resolveQuery(query: VirtualContextQuery | VirtualContextJoinQuery): VirtualContextQuery | VirtualContextJoinQuery {
    const source = this.descriptors.get(query.id);
    if (!source) return query;
    if (query.op !== 'json_join') return { ...query, id: source.storeId };
    const destination = this.descriptors.get(query.joinId);
    return {
      ...query,
      id: source.storeId,
      ...(destination ? { joinId: destination.storeId } : {}),
    };
  }

  isProtectedSourceTool(name: string): boolean {
    return this.protectedSourceTools.has(name);
  }

  private refusedProtectedResult(sourceTool: string, reason: string): McpResultTransformation {
    return {
      result: errorResult(`Pinpoint blocked the protected result from ${displayToolName(sourceTool)}: ${reason}`),
      virtualized: false,
    };
  }

  transformResult(sourceTool: string, result: McpCallToolResult): McpResultTransformation {
    const protectedSource = this.isProtectedSourceTool(sourceTool);
    try {
      const raw = exactPayload(result);
      if (raw == null) {
        return protectedSource
          ? this.refusedProtectedResult(sourceTool, 'the response was not an eligible exact text or JSON payload')
          : { result, virtualized: false };
      }
      if (!protectedSource && raw.length < this.minChars) return { result, virtualized: false };

      const inspected = this.store.inspect(raw, '').descriptor;
      if ((inspected.recordCollections ?? 0) > 1) {
        return protectedSource
          ? this.refusedProtectedResult(sourceTool, 'the response contained ambiguous record collections')
          : { result, virtualized: false };
      }
      const exposedDescriptor = { ...inspected, id: this.artifactId(inspected.id) };
      const candidate = virtualResult(
        sourceTool,
        exposedDescriptor,
        result,
        this.exposeQueryTool,
        this.flowToolAvailable,
        this.exposeArtifactResources,
        protectedSource,
      );
      if (!protectedSource && JSON.stringify(candidate).length >= JSON.stringify(result).length) {
        return { result, virtualized: false };
      }

      let descriptor: VirtualContextDescriptor;
      try {
        descriptor = this.store.putMany([raw], new Set([inspected.id]))[0]!;
      } catch {
        return protectedSource
          ? this.refusedProtectedResult(sourceTool, 'bounded local storage could not retain it')
          : { result, virtualized: false };
      }
      if (!this.store.has(descriptor.id)) {
        return protectedSource
          ? this.refusedProtectedResult(sourceTool, 'the exact artifact was not committed')
          : { result, virtualized: false };
      }
      this.pruneDescriptors();
      const exposed = { ...descriptor, id: exposedDescriptor.id };
      this.descriptors.set(exposed.id, { descriptor: exposed, sourceTool, storeId: descriptor.id });
      return {
        result: candidate,
        virtualized: true,
        descriptor: exposed,
      };
    } catch {
      return protectedSource
        ? this.refusedProtectedResult(sourceTool, 'exact capture failed')
        : { result, virtualized: false };
    }
  }

  callTool(name: string, args: Record<string, unknown>): McpCallToolResult {
    if (name !== MCP_QUERY_TOOL_NAME) return errorResult(`unknown Pinpoint tool: ${name}`);
    try {
      const query = parseQuery(args);
      const text = this.store.query(this.resolveQuery(query));
      const parsed = JSON.parse(text) as unknown;
      const failed = isRecord(parsed) && typeof parsed.error === 'string';
      return {
        content: [{ type: 'text', text }],
        ...(failed ? { isError: true } : {}),
        ...(isRecord(parsed) ? { structuredContent: parsed } : {}),
      };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  artifactInfo(id: string): { descriptor: VirtualContextDescriptor; sourceTool: string } | undefined {
    this.pruneDescriptors();
    const artifact = this.descriptors.get(id);
    return artifact && this.store.has(artifact.storeId) ? artifact : undefined;
  }

  queryArtifact(query: VirtualContextQuery): string {
    return this.store.query(this.resolveQuery(query));
  }

  listResources(): readonly Record<string, unknown>[] {
    if (!this.exposeArtifactResources) return [];
    this.pruneDescriptors();
    return [...this.descriptors.values()]
      .filter(({ storeId }) => this.store.has(storeId))
      .map(({ descriptor, sourceTool }) => ({
        uri: artifactUri(descriptor.id),
        name: `${sourceTool} result`,
        description: `Exact ${descriptor.kind} result retained by Pinpoint; query with ${MCP_QUERY_TOOL_NAME}.`,
        mimeType: artifactMimeType(descriptor),
        size: descriptor.bytes,
      }));
  }

  readResource(uri: string): Record<string, unknown> | undefined {
    if (!this.exposeArtifactResources) return undefined;
    if (!uri.startsWith(MCP_ARTIFACT_URI_PREFIX)) return undefined;
    const id = uri.slice(MCP_ARTIFACT_URI_PREFIX.length);
    const artifact = this.descriptors.get(id);
    if (!artifact || !this.store.has(artifact.storeId)) return undefined;
    const preview = this.store.query({ id: artifact.storeId, op: 'slice', offset: 0, limit: 20 });
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            artifact: artifact.descriptor,
            sourceTool: artifact.sourceTool,
            preview: JSON.parse(preview) as unknown,
            queryTool: MCP_QUERY_TOOL_NAME,
            note: 'This is a bounded preview. Query the artifact instead of loading it in full.',
          }),
        },
      ],
    };
  }
}

interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PendingRequest {
  readonly method: string;
  readonly toolName?: string;
  readonly firstPage?: boolean;
  readonly opaqueFlow?: {
    readonly clientId: JsonRpcMessage['id'];
    readonly plan: PreparedMcpOpaqueFlow;
  };
  readonly protectedSource?: boolean;
}

function rpcKey(id: JsonRpcMessage['id']): string {
  return `${typeof id}:${String(id)}`;
}

function parseRpc(line: string): JsonRpcMessage | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (!isRecord(value) || value.jsonrpc !== '2.0') return undefined;
    return value as unknown as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

function writeRpc(output: Writable, message: JsonRpcMessage): void {
  output.write(`${JSON.stringify(message)}\n`);
}

function rpcResult(id: JsonRpcMessage['id'], result: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcMessage['id'], code: number, message: string): JsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function firstPage(params: unknown): boolean {
  return !isRecord(params) || params.cursor == null;
}

function callParams(params: unknown): { name: string; arguments: Record<string, unknown> } | undefined {
  if (!isRecord(params) || typeof params.name !== 'string') return undefined;
  return {
    name: params.name,
    arguments: isRecord(params.arguments) ? params.arguments : {},
  };
}

function localResources(firewall: McpResultFirewall): Record<string, unknown> {
  return { resources: firewall.listResources() };
}

function localResourceTemplates(firewall?: McpResultFirewall): Record<string, unknown> {
  return {
    resourceTemplates: firewall?.exposeArtifactResources === false ? [] : [
      {
        uriTemplate: `${MCP_ARTIFACT_URI_PREFIX}{id}`,
        name: 'Pinpoint exact MCP artifact',
        description: `A losslessly retained upstream result. Use ${MCP_QUERY_TOOL_NAME} for bounded exact access.`,
        mimeType: 'application/json',
      },
    ],
  };
}

function mergeInitialize(
  result: unknown,
  exposeLocalResources: boolean,
  flowEngine?: McpOpaqueFlowEngine,
): unknown {
  if (!isRecord(result)) return result;
  const capabilities = isRecord(result.capabilities) ? result.capabilities : {};
  const upstreamResources = isRecord(capabilities.resources) ? capabilities.resources : undefined;
  const serverInfo = isRecord(result.serverInfo) ? result.serverInfo : {};
  const meta = isRecord(result._meta) ? result._meta : {};
  return {
    ...result,
    capabilities: {
      ...capabilities,
      tools: isRecord(capabilities.tools) ? capabilities.tools : {},
      ...(upstreamResources || exposeLocalResources
        ? { resources: upstreamResources ?? {} }
        : {}),
    },
    serverInfo: {
      ...serverInfo,
      name: `pinpoint-gateway/${typeof serverInfo.name === 'string' ? serverInfo.name : 'upstream'}`,
    },
    ...(flowEngine ? {
      _meta: {
        ...meta,
        pinpoint: {
          opaqueFlow: {
            receiptVerifier: flowEngine.receiptVerifier,
          },
        },
      },
    } : {}),
  };
}

function mergeTools(
  result: unknown,
  firewall: McpResultFirewall,
  flowEngine: McpOpaqueFlowEngine | undefined,
  includeLocal: boolean,
): unknown {
  if (!isRecord(result) || !Array.isArray(result.tools)) return result;
  const tools = result.tools.filter(isRecord);
  const reserved = new Set([MCP_QUERY_TOOL_NAME, ...(flowEngine ? [MCP_FLOW_TOOL_NAME] : [])]);
  const collision = tools.find(({ name }) => typeof name === 'string' && reserved.has(name));
  if (collision) {
    throw new Error(`upstream MCP server uses reserved tool name ${String(collision.name)}`);
  }
  const visible = flowEngine
    ? tools.filter(({ name }) => typeof name !== 'string' || !flowEngine.hiddenDestinationTools.has(name))
    : tools;
  const wrapped = visible.map((tool) =>
    isRecord(tool.outputSchema) && tool.outputSchema.type === 'object'
      ? {
          ...tool,
          outputSchema: {
            type: 'object',
            anyOf: [tool.outputSchema, MCP_ARTIFACT_OUTPUT_SCHEMA],
          },
        }
      : tool,
  );
  const local = [...firewall.tools, ...(flowEngine ? [flowEngine.tool] : [])];
  return { ...result, tools: includeLocal ? [...wrapped, ...local] : wrapped };
}

function mergeResources(result: unknown, firewall: McpResultFirewall, includeLocal: boolean): unknown {
  if (
    !isRecord(result) ||
    !Array.isArray(result.resources) ||
    !includeLocal ||
    !firewall.exposeArtifactResources
  ) return result;
  return { ...result, resources: [...result.resources, ...firewall.listResources()] };
}

function mergeResourceTemplates(
  result: unknown,
  firewall: McpResultFirewall,
  includeLocal: boolean,
): unknown {
  if (
    !isRecord(result) ||
    !Array.isArray(result.resourceTemplates) ||
    !includeLocal ||
    !firewall.exposeArtifactResources
  ) return result;
  const local = localResourceTemplates(firewall).resourceTemplates as unknown[];
  return { ...result, resourceTemplates: [...result.resourceTemplates, ...local] };
}

function asToolResult(result: unknown): McpCallToolResult | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
  return result as unknown as McpCallToolResult;
}

function queueLine(
  current: Promise<void>,
  work: () => Promise<void> | void,
  onError: (error: unknown) => void,
): Promise<void> {
  return current.then(work).catch(onError);
}

/**
 * Transparently proxy one stdio MCP server while virtualizing oversized text
 * results before they enter the host agent's conversation history.
 */
export async function runMcpGateway(
  command: string,
  args: readonly string[] = [],
  options: McpGatewayOptions = {},
): Promise<number | null> {
  if (!command.trim()) throw new TypeError('upstream MCP command is required');

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const flows = options.flows ?? [];
  const exposeQueryTool = options.exposeQueryTool ?? flows.length === 0;
  const exposeArtifactResources = options.exposeArtifactResources ?? flows.length === 0;
  const opaqueArtifactIds = options.opaqueArtifactIds ?? flows.length > 0;
  const firewall = new McpResultFirewall({
    ...options,
    exposeQueryTool,
    exposeArtifactResources,
    opaqueArtifactIds,
    flowToolAvailable: flows.length > 0,
    protectedSourceTools: flows.map(({ sourceTool }) => sourceTool),
  });
  const flowEngine = flows.length > 0 ? new McpOpaqueFlowEngine(firewall, flows) : undefined;
  if (!firewall.exposeQueryTool && !flowEngine) {
    throw new TypeError('disabling pinpoint_query requires at least one opaque flow policy');
  }
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  const pending = new Map<string, PendingRequest>();
  const shutdownGraceMs = Math.max(0, Math.trunc(options.shutdownGraceMs ?? 2_000));
  let upstreamHasResources = false;
  let clientQueue = Promise.resolve();
  let upstreamQueue = Promise.resolve();
  let forceKillTimer: NodeJS.Timeout | undefined;
  let activeOpaqueFlows = 0;
  let activeProtectedSources = 0;
  let protectedDataHandled = false;
  let flowPoliciesValidated = flowEngine == null;
  let suppressedSensitiveStderr = false;
  const sensitiveOperationActive = (): boolean => activeOpaqueFlows + activeProtectedSources > 0;
  const resetSensitiveStderr = (): void => {
    if (!sensitiveOperationActive()) suppressedSensitiveStderr = false;
  };

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (!sensitiveOperationActive() && !protectedDataHandled) {
      error.write(chunk);
    } else if (!suppressedSensitiveStderr) {
      suppressedSensitiveStderr = true;
      error.write('[pinpoint mcp gateway] suppressed upstream stderr during protected dataflow\n');
    }
  });
  child.stdin.on('error', (cause) => {
    error.write(`[pinpoint mcp gateway] upstream stdin: ${cause.message}\n`);
  });

  const failGateway = (id: JsonRpcMessage['id'], cause: unknown): void => {
    writeRpc(output, rpcError(id, -32603, cause instanceof Error ? cause.message : String(cause)));
  };

  const handleClient = async (line: string): Promise<void> => {
    const message = parseRpc(line.trim());
    if (!message) {
      writeRpc(output, rpcError(null, -32700, 'invalid JSON-RPC message'));
      return;
    }

    if (message.method === 'tools/call' && message.id !== undefined) {
      const call = callParams(message.params);
      if (flowEngine && !flowPoliciesValidated) {
        writeRpc(output, rpcError(message.id, -32003, 'opaque flow policies require a successful tools/list first'));
        return;
      }
      if (call?.name === MCP_QUERY_TOOL_NAME) {
        const result = firewall.exposeQueryTool
          ? firewall.callTool(call.name, call.arguments)
          : errorResult(`${MCP_QUERY_TOOL_NAME} is disabled; use a configured ${MCP_FLOW_TOOL_NAME} flow`);
        writeRpc(output, rpcResult(message.id, result));
        return;
      }
      if (call?.name === MCP_FLOW_TOOL_NAME && flowEngine) {
        try {
          const plan = flowEngine.prepare(call.arguments);
          const internalId = `pinpoint-flow:${randomUUID()}`;
          pending.set(rpcKey(internalId), {
            method: 'tools/call',
            toolName: plan.policy.destinationTool,
            opaqueFlow: { clientId: message.id, plan },
          });
          protectedDataHandled = true;
          activeOpaqueFlows += 1;
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: internalId,
            method: 'tools/call',
            params: {
              name: plan.policy.destinationTool,
              arguments: plan.destinationArguments,
            },
          })}\n`);
        } catch (cause) {
          writeRpc(output, rpcResult(message.id, flowEngine.error(cause)));
        }
        return;
      }
      if (call && flowEngine?.hiddenDestinationTools.has(call.name)) {
        writeRpc(
          output,
          rpcResult(message.id, errorResult(`${call.name} is restricted to a configured ${MCP_FLOW_TOOL_NAME} flow`)),
        );
        return;
      }
    }

    if (message.method === 'resources/read' && message.id !== undefined) {
      const uri = isRecord(message.params) && typeof message.params.uri === 'string' ? message.params.uri : '';
      if (uri.startsWith(MCP_ARTIFACT_URI_PREFIX)) {
        const result = firewall.readResource(uri);
        writeRpc(
          output,
          result ? rpcResult(message.id, result) : rpcError(message.id, -32002, 'Pinpoint artifact not found'),
        );
        return;
      }
      if (!upstreamHasResources) {
        writeRpc(output, rpcError(message.id, -32002, 'upstream resource not found'));
        return;
      }
    }

    if (message.method === 'resources/list' && message.id !== undefined && !upstreamHasResources) {
      writeRpc(output, rpcResult(message.id, localResources(firewall)));
      return;
    }
    if (
      message.method === 'resources/templates/list' &&
      message.id !== undefined &&
      !upstreamHasResources
    ) {
      writeRpc(output, rpcResult(message.id, localResourceTemplates(firewall)));
      return;
    }

    if (message.id !== undefined && message.method) {
      const call = message.method === 'tools/call' ? callParams(message.params) : undefined;
      const protectedSource = call != null && firewall.isProtectedSourceTool(call.name);
      pending.set(rpcKey(message.id), {
        method: message.method,
        ...(call ? { toolName: call.name } : {}),
        ...(protectedSource ? { protectedSource: true } : {}),
        ...(['tools/list', 'resources/list', 'resources/templates/list'].includes(message.method)
          ? { firstPage: firstPage(message.params) }
          : {}),
      });
      if (protectedSource) {
        protectedDataHandled = true;
        activeProtectedSources += 1;
      }
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const handleUpstream = async (line: string): Promise<void> => {
    const message = parseRpc(line.trim());
    if (!message) {
      error.write(`[pinpoint mcp gateway] ignored non-JSON upstream stdout: ${line.slice(0, 200)}\n`);
      return;
    }
    if (message.method && (sensitiveOperationActive() || protectedDataHandled)) {
      if (message.id !== undefined) {
        child.stdin.write(`${JSON.stringify(rpcError(message.id, -32601, 'server requests are disabled during opaque flows'))}\n`);
      }
      return;
    }
    if (message.id === undefined || message.method) {
      writeRpc(output, message);
      return;
    }

    const request = pending.get(rpcKey(message.id));
    if (!request) {
      writeRpc(output, message);
      return;
    }
    pending.delete(rpcKey(message.id));
    if (request.opaqueFlow) {
      activeOpaqueFlows = Math.max(0, activeOpaqueFlows - 1);
      resetSensitiveStderr();
      const destinationResult = message.error != null
        ? errorResult('destination returned a JSON-RPC error')
        : asToolResult(message.result) ?? errorResult('destination returned an invalid MCP tool result');
      const result = flowEngine?.complete(request.opaqueFlow.plan, destinationResult) ??
        errorResult('opaque flow engine unavailable');
      writeRpc(output, rpcResult(request.opaqueFlow.clientId, result));
      return;
    }
    if (request.protectedSource) {
      activeProtectedSources = Math.max(0, activeProtectedSources - 1);
      resetSensitiveStderr();
    }
    if (message.error != null) {
      writeRpc(
        output,
        request.protectedSource
          ? rpcError(message.id, -32603, 'protected source returned a JSON-RPC error')
          : message,
      );
      return;
    }

    try {
      let result = message.result;
      if (request.method === 'initialize') {
        if (isRecord(result) && isRecord(result.capabilities)) {
          upstreamHasResources = isRecord(result.capabilities.resources);
        }
        result = mergeInitialize(result, firewall.exposeArtifactResources, flowEngine);
      } else if (request.method === 'tools/list') {
        if (flowEngine && request.firstPage === true) {
          if (!isRecord(result) || !Array.isArray(result.tools)) {
            throw new TypeError('opaque flow policy validation requires a complete first tools/list page');
          }
          flowEngine.validateToolCatalog(new Set(
            result.tools
              .filter(isRecord)
              .map(({ name }) => name)
              .filter((name): name is string => typeof name === 'string'),
          ));
          flowPoliciesValidated = true;
        }
        result = mergeTools(result, firewall, flowEngine, request.firstPage === true);
      } else if (request.method === 'resources/list') {
        result = mergeResources(result, firewall, request.firstPage === true);
      } else if (request.method === 'resources/templates/list') {
        result = mergeResourceTemplates(result, firewall, request.firstPage === true);
      } else if (request.method === 'tools/call' && request.toolName) {
        const toolResult = asToolResult(result);
        if (toolResult) result = firewall.transformResult(request.toolName, toolResult).result;
      }
      writeRpc(output, rpcResult(message.id, result));
    } catch (cause) {
      failGateway(message.id, cause);
    }
  };

  const clientLines = createInterface({ input, crlfDelay: Infinity });
  const upstreamLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  clientLines.on('line', (line) => {
    clientQueue = queueLine(clientQueue, () => handleClient(line), (cause) => failGateway(null, cause));
  });
  upstreamLines.on('line', (line) => {
    upstreamQueue = queueLine(
      upstreamQueue,
      () => handleUpstream(line),
      (cause) => error.write(`[pinpoint mcp gateway] ${cause instanceof Error ? cause.message : String(cause)}\n`),
    );
  });
  clientLines.once('close', () => child.stdin.end());

  const abort = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, shutdownGraceMs);
    forceKillTimer.unref();
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  options.signal?.removeEventListener('abort', abort);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  clientLines.close();
  upstreamLines.close();
  await Promise.all([clientQueue, upstreamQueue]);
  return exitCode;
}