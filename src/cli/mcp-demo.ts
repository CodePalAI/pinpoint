import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  MCP_FLOW_TOOL_NAME,
  MCP_QUERY_TOOL_NAME,
  runMcpGateway,
} from '../mcp/gateway.js';
import {
  verifyMcpOpaqueFlowReceipt,
  type McpOpaqueFlowReceipt,
  type McpOpaqueFlowReceiptVerifier,
} from '../mcp/flow.js';

export interface McpScenarioResult {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly sourceRecords: number;
  readonly selectedRecords: number;
  readonly bypassAttempts: number;
  readonly bypassesDenied: number;
  readonly denials: readonly McpScenarioDenial[];
  readonly privateValuesScanned: number;
  readonly privateValuesVisible: number;
  readonly destinationDispatches: number;
  readonly projectionExact: boolean;
  readonly processSeparationValid: boolean;
  readonly receiptVerifier: McpOpaqueFlowReceiptVerifier;
  readonly receipts: readonly McpOpaqueFlowReceipt[];
}

export type McpScenarioDenialId =
  | 'direct-destination'
  | 'direct-query'
  | 'artifact-read'
  | 'forged-capability'
  | 'operation-override'
  | 'projection-override'
  | 'fixed-predicate-override'
  | 'destination-argument-override';

export interface McpScenarioDenial {
  readonly id: McpScenarioDenialId;
  readonly outcome: 'denied';
}

interface McpScenarioOptions {
  readonly flowCalls: number;
  readonly extendedBypasses: boolean;
}

interface DemoResponse {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: unknown;
}

function send(stream: PassThrough, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

function minimalChildEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...extra };
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[name] != null) environment[name] = process.env[name];
  }
  return environment;
}

function responseKey(id: DemoResponse['id']): string {
  return `${typeof id}:${String(id)}`;
}

function responseReader(stream: PassThrough): (id: DemoResponse['id']) => Promise<DemoResponse> {
  let buffer = '';
  const queued = new Map<string, DemoResponse>();
  const waiting = new Map<string, {
    readonly resolve: (response: DemoResponse) => void;
    readonly reject: (cause: Error) => void;
    readonly timer: NodeJS.Timeout;
  }>();
  const fail = (cause: Error): void => {
    for (const waiter of waiting.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(cause);
    }
    waiting.clear();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let response: DemoResponse;
      try {
        response = JSON.parse(line) as DemoResponse;
      } catch {
        fail(new Error('demo gateway returned invalid JSON'));
        continue;
      }
      if (response.id === undefined) continue;
      const key = responseKey(response.id);
      const waiter = waiting.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiting.delete(key);
        waiter.resolve(response);
      } else {
        queued.set(key, response);
      }
    }
  });
  stream.once('error', (cause) => fail(cause));
  stream.once('end', () => fail(new Error('demo gateway output ended')));
  return (id) => {
    const key = responseKey(id);
    const response = queued.get(key);
    if (response) {
      queued.delete(key);
      return Promise.resolve(response);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (waiting.delete(key)) reject(new Error(`demo gateway response ${String(id)} timed out`));
      }, 5_000);
      waiting.set(key, { resolve, reject, timer });
    });
  };
}

function toolError(response: DemoResponse): string | undefined {
  const result = response.result as {
    readonly content?: ReadonlyArray<{ readonly text?: unknown }>;
    readonly isError?: unknown;
  } | undefined;
  if (result?.isError !== true || typeof result.content?.[0]?.text !== 'string') return undefined;
  try {
    const value = JSON.parse(result.content[0].text) as { error?: unknown };
    return typeof value.error === 'string' ? value.error : undefined;
  } catch {
    return undefined;
  }
}

function expectToolDenial(response: DemoResponse, id: number, message: string): void {
  if (response.id !== id || toolError(response) !== message) {
    throw new Error(`demo bypass ${id} did not return the expected denial`);
  }
}

function expectRpcDenial(response: DemoResponse, id: number, code: number, message: string): void {
  const error = response.error as { readonly code?: unknown; readonly message?: unknown } | undefined;
  if (response.id !== id || error?.code !== code || error.message !== message) {
    throw new Error(`demo bypass ${id} did not return the expected JSON-RPC denial`);
  }
}

function receiptVerifierFrom(response: DemoResponse): McpOpaqueFlowReceiptVerifier {
  const result = response.result as {
    readonly _meta?: {
      readonly pinpoint?: {
        readonly opaqueFlow?: {
          readonly receiptVerifier?: unknown;
        };
      };
    };
  } | undefined;
  const verifier = result?._meta?.pinpoint?.opaqueFlow?.receiptVerifier as
    Partial<McpOpaqueFlowReceiptVerifier> | undefined;
  if (
    verifier?.algorithm !== 'Ed25519' ||
    typeof verifier.publicKey !== 'string' ||
    typeof verifier.signingKeyId !== 'string'
  ) {
    throw new Error('demo initialize result did not pin a receipt verifier');
  }
  return verifier as McpOpaqueFlowReceiptVerifier;
}

function receiptFrom(response: DemoResponse): McpOpaqueFlowReceipt {
  const result = response.result as { content?: Array<{ text?: string }> } | undefined;
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('demo flow did not return a receipt');
  const parsed = JSON.parse(text) as { pinpointFlow?: unknown };
  if (parsed.pinpointFlow == null || typeof parsed.pinpointFlow !== 'object') {
    throw new Error('demo flow returned an invalid receipt');
  }
  return parsed.pinpointFlow as McpOpaqueFlowReceipt;
}

export async function runMcpScenario(options: McpScenarioOptions): Promise<McpScenarioResult> {
  if (!Number.isInteger(options.flowCalls) || options.flowCalls < 1 || options.flowCalls > 100) {
    throw new TypeError('MCP scenario flowCalls must be an integer from 1 to 100');
  }
  const startedAt = new Date();
  const started = performance.now();
  const root = mkdtempSync(join(tmpdir(), 'pinpoint-mcp-demo-'));
  const persistedPath = join(root, 'delivered.json');
  const destinationAuditPath = join(root, 'destination-calls.jsonl');
  const sourcePidPath = join(root, 'source.pid');
  const destinationPidPath = join(root, 'destination.pid');
  const rows = Array.from({ length: 200 }, (_, id) => ({
    id,
    active: id % 5 === 0,
    email: `demo-user-${id}@example.invalid`,
    privateCode: `DEMO_PRIVATE_${id}`,
  }));
  const selected = rows
    .filter(({ active }) => active)
    .map(({ email }) => ({ email }));
  const privateValues = [
    ...rows.flatMap(({ email, privateCode }) => [email, privateCode]),
    'DEMO_DESTINATION_PRIVATE_RESULT',
  ];
  const sourceServer = String.raw`
    import { writeFileSync } from 'node:fs';
    import { createInterface } from 'node:readline';
    const rows = ${JSON.stringify(rows)};
    writeFileSync(process.env.PINPOINT_DEMO_SOURCE_PID, String(process.pid), { mode: 0o600 });
    const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        reply(message.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pinpoint-demo-source', version: '1.0.0' },
        });
      } else if (message.method === 'tools/list') {
        reply(message.id, { tools: [{
          name: 'accounts_list',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }] });
      } else if (message.method === 'tools/call' && message.params.name === 'accounts_list') {
        reply(message.id, { content: [{ type: 'text', text: JSON.stringify(rows) }] });
      }
    }
  `;
  const destinationServer = String.raw`
    import { appendFileSync, writeFileSync } from 'node:fs';
    import { createInterface } from 'node:readline';
    writeFileSync(process.env.PINPOINT_DEMO_DESTINATION_PID, String(process.pid), { mode: 0o600 });
    const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        reply(message.id, {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'pinpoint-demo-destination', version: '1.0.0' },
        });
      } else if (message.method === 'tools/list') {
        reply(message.id, { tools: [{
          name: 'campaign_deliver',
          inputSchema: { type: 'object', properties: { recipients: { type: 'array' } } },
        }] });
      } else if (message.method === 'tools/call') {
        const recipients = message.params.arguments.recipients;
        appendFileSync(process.env.PINPOINT_DEMO_AUDIT, JSON.stringify({
          pid: process.pid,
          tool: message.params.name,
          arguments: message.params.arguments,
        }) + '\n', { mode: 0o600 });
        writeFileSync(process.env.PINPOINT_DEMO_OUTPUT, JSON.stringify(recipients), { mode: 0o600 });
        reply(message.id, {
          content: [{ type: 'text', text: 'DEMO_DESTINATION_PRIVATE_RESULT' }],
          structuredContent: { accepted: recipients.length },
        });
      }
    }
  `;
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const visible: string[] = [];
  output.on('data', (chunk) => visible.push(String(chunk)));
  const next = responseReader(output);
  const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
    input,
    output,
    error,
    env: minimalChildEnvironment({ PINPOINT_DEMO_SOURCE_PID: sourcePidPath }),
    minChars: 1,
    flows: [{
      name: 'deliver_active_accounts',
      sourceTool: 'accounts_list',
      sourceKind: 'json-array',
      destinationTool: 'campaign_deliver',
      destinationArgument: 'recipients',
      fixedDestinationArguments: { campaign: 'renewal' },
      allowedOps: ['json_select'],
      fixedWhere: { active: true },
      allowedFields: ['email'],
      maxItems: 40,
      maxBytes: 4_096,
    }],
    destination: {
      id: 'demo-destination',
      command: process.execPath,
      args: ['--input-type=module', '--eval', destinationServer],
      env: {
        PINPOINT_DEMO_OUTPUT: persistedPath,
        PINPOINT_DEMO_AUDIT: destinationAuditPath,
        PINPOINT_DEMO_DESTINATION_PID: destinationPidPath,
      },
      declaredEnvNames: [
        'PINPOINT_DEMO_OUTPUT',
        'PINPOINT_DEMO_AUDIT',
        'PINPOINT_DEMO_DESTINATION_PID',
      ],
      requestTimeoutMs: 2_000,
      shutdownGraceMs: 200,
    },
  });

  let scenarioDraft: Omit<
    McpScenarioResult,
    'completedAt' | 'durationMs' | 'privateValuesVisible'
  > | undefined;
  let scenario: McpScenarioResult | undefined;
  let failure: unknown;
  try {
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await next(1);
    if (initialized.error != null) throw new Error('demo gateway initialization failed');
    const initializedVerifier = receiptVerifierFrom(initialized);
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if ((await next(2)).error != null) throw new Error('demo gateway catalog validation failed');
    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'accounts_list', arguments: {} },
    });
    const source = await next(3);
    const artifactId = JSON.stringify(source).match(/vctx_[a-f0-9]{32}/)?.[0];
    if (!artifactId) throw new Error('demo protected source did not produce a capability');
    const denials: McpScenarioDenial[] = [];

    send(input, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'campaign_deliver', arguments: { recipients: [] } },
    });
    expectToolDenial(
      await next(4),
      4,
      `campaign_deliver is restricted to a configured ${MCP_FLOW_TOOL_NAME} flow`,
    );
    denials.push({ id: 'direct-destination', outcome: 'denied' });
    send(input, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: MCP_QUERY_TOOL_NAME, arguments: { id: artifactId, op: 'slice', limit: 1 } },
    });
    expectToolDenial(
      await next(5),
      5,
      `${MCP_QUERY_TOOL_NAME} is disabled; use a configured ${MCP_FLOW_TOOL_NAME} flow`,
    );
    denials.push({ id: 'direct-query', outcome: 'denied' });
    send(input, {
      jsonrpc: '2.0', id: 6, method: 'resources/read',
      params: { uri: `pinpoint://artifact/${artifactId}` },
    });
    expectRpcDenial(await next(6), 6, -32002, 'Pinpoint artifact not found');
    denials.push({ id: 'artifact-read', outcome: 'denied' });
    const forgedArtifactId = `vctx_${'f'.repeat(32)}`;
    send(input, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_accounts',
          id: forgedArtifactId,
          op: 'json_select',
          fields: ['email'],
        },
      },
    });
    expectToolDenial(await next(7), 7, `artifact not found: ${forgedArtifactId}`);
    denials.push({ id: 'forged-capability', outcome: 'denied' });
    if (options.extendedBypasses) {
      send(input, {
        jsonrpc: '2.0', id: 8, method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: { flow: 'deliver_active_accounts', id: artifactId, op: 'count' },
        },
      });
      expectToolDenial(
        await next(8),
        8,
        'operation not allowed by flow deliver_active_accounts: count',
      );
      denials.push({ id: 'operation-override', outcome: 'denied' });
      send(input, {
        jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: {
            flow: 'deliver_active_accounts',
            id: artifactId,
            op: 'json_select',
            fields: ['privateCode'],
          },
        },
      });
      expectToolDenial(
        await next(9),
        9,
        'projection field not allowed by flow policy: privateCode',
      );
      denials.push({ id: 'projection-override', outcome: 'denied' });
      send(input, {
        jsonrpc: '2.0', id: 10, method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: {
            flow: 'deliver_active_accounts',
            id: artifactId,
            op: 'json_select',
            where: { active: false },
            fields: ['email'],
          },
        },
      });
      expectToolDenial(
        await next(10),
        10,
        'where field not allowed by flow policy: active',
      );
      denials.push({ id: 'fixed-predicate-override', outcome: 'denied' });
      send(input, {
        jsonrpc: '2.0', id: 11, method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: {
            flow: 'deliver_active_accounts',
            id: artifactId,
            op: 'json_select',
            fields: ['email'],
            destinationArguments: { campaign: 'override' },
          },
        },
      });
      expectToolDenial(
        await next(11),
        11,
        'destination argument not allowed by flow policy: campaign',
      );
      denials.push({ id: 'destination-argument-override', outcome: 'denied' });
    }
    const bypassesDenied = denials.length;
    if (existsSync(destinationAuditPath) || existsSync(persistedPath)) {
      throw new Error('demo bypass caused an unauthorized destination side effect');
    }

    const receipts: McpOpaqueFlowReceipt[] = [];
    let previousReceiptHash = '0'.repeat(64);
    const firstFlowId = options.extendedBypasses ? 12 : 8;
    for (let index = 0; index < options.flowCalls; index += 1) {
      const id = firstFlowId + index;
      send(input, {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: {
            flow: 'deliver_active_accounts',
            id: artifactId,
            op: 'json_select',
            fields: ['email'],
          },
        },
      });
      const receipt = receiptFrom(await next(id));
      if (
        !verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier) ||
        receipt.sequence !== index + 1 ||
        receipt.previousReceiptHash !== previousReceiptHash ||
        receipt.destinationSucceeded !== true ||
        receipt.items !== selected.length
      ) {
        throw new Error(`demo receipt chain failed at sequence ${index + 1}`);
      }
      receipts.push(receipt);
      previousReceiptHash = receipt.receiptHash;
    }
    const wrongVerifierRejected = !verifyMcpOpaqueFlowReceipt(receipts[0], {
      ...initializedVerifier,
      signingKeyId: '0'.repeat(64),
    });
    const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as unknown;
    const projectionExact = JSON.stringify(persisted) === JSON.stringify(selected);
    const destinationCalls = readFileSync(destinationAuditPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        readonly pid: number;
        readonly tool: string;
        readonly arguments: Record<string, unknown>;
      });
    const sourcePid = Number(readFileSync(sourcePidPath, 'utf8'));
    const destinationPid = Number(readFileSync(destinationPidPath, 'utf8'));
    const processSeparationValid = Number.isInteger(sourcePid) &&
      Number.isInteger(destinationPid) &&
      sourcePid !== destinationPid &&
      sourcePid !== process.pid &&
      destinationPid !== process.pid;
    const destinationDispatchExact = destinationCalls.length === options.flowCalls &&
      destinationCalls.every((call) =>
        call.pid === destinationPid &&
        call.tool === 'campaign_deliver' &&
        JSON.stringify(call.arguments.recipients) === JSON.stringify(selected) &&
        call.arguments.campaign === 'renewal'
      );
    const expectedBypasses = options.extendedBypasses ? 8 : 4;
    const commitmentsDistinct = new Set(receipts.map(({ payloadCommitment }) => payloadCommitment)).size ===
      options.flowCalls;
    const passed = bypassesDenied === expectedBypasses &&
      receipts.length === options.flowCalls &&
      wrongVerifierRejected &&
      projectionExact &&
      destinationDispatchExact &&
      processSeparationValid &&
      commitmentsDistinct;
    if (!passed) throw new Error('value-opaque MCP demo failed its self-checks');

    scenarioDraft = {
      startedAt: startedAt.toISOString(),
      sourceRecords: rows.length,
      selectedRecords: selected.length,
      bypassAttempts: expectedBypasses,
      bypassesDenied,
      denials,
      privateValuesScanned: privateValues.length,
      destinationDispatches: destinationCalls.length,
      projectionExact,
      processSeparationValid,
      receiptVerifier: initializedVerifier,
      receipts,
    };
  } catch (cause) {
    failure = cause;
  }
  input.end();
  try {
    const exitCode = await running;
    if (exitCode !== 0 && failure == null) {
      failure = new Error(`demo gateway exited with code ${String(exitCode)}`);
    }
  } catch (cause) {
    if (failure == null) failure = cause;
  }
  if (failure == null && scenarioDraft != null) {
    const transcript = visible.join('');
    const privateValuesVisible = privateValues.filter((value) => transcript.includes(value)).length;
    if (privateValuesVisible !== 0) {
      failure = new Error('value-opaque MCP demo exposed a private fixture value');
    } else {
      scenario = {
        ...scenarioDraft,
        completedAt: new Date().toISOString(),
        durationMs: performance.now() - started,
        privateValuesVisible,
      };
    }
  }
  rmSync(root, { recursive: true, force: true });
  if (failure != null) throw failure;
  if (scenario == null) throw new Error('value-opaque MCP scenario did not produce a result');
  return scenario;
}

export async function runMcpDemo(): Promise<string> {
  const result = await runMcpScenario({ flowCalls: 1, extendedBypasses: false });
  return [
    'pinpoint value-opaque MCP demo (offline)',
    `source: ${result.sourceRecords} synthetic account records`,
    'policy: active=true; project email only',
    `destination: ${result.selectedRecords}/${result.selectedRecords} exact recipients persisted`,
    `bypass attempts denied: ${result.bypassesDenied}/${result.bypassAttempts}`,
    `private values in client transcript: ${result.privateValuesVisible}/${result.privateValuesScanned}`,
    `destination dispatches: ${result.destinationDispatches} authorized; 0 bypass side effects`,
    'signed receipt: valid against initialized verifier; wrong verifier rejected',
    'processes: source and destination PIDs are separate from the CLI',
    'transport: local stdio only; external services configured: none',
    'passed: true',
  ].join('\n');
}