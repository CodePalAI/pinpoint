import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { MCP_FLOW_TOOL_NAME, runMcpGateway } from '../src/mcp/gateway.js';
import { verifyMcpOpaqueFlowReceipt } from '../src/mcp/flow.js';

function send(stream: PassThrough, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

function responses(stream: PassThrough): () => Promise<Record<string, unknown>> {
  let buffer = '';
  const pending: Array<(value: Record<string, unknown>) => void> = [];
  const queued: Record<string, unknown>[] = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line) as Record<string, unknown>;
      const resolve = pending.shift();
      if (resolve) resolve(value);
      else queued.push(value);
    }
  });
  return () => {
    const value = queued.shift();
    if (value) return Promise.resolve(value);
    return new Promise((resolve) => pending.push(resolve));
  };
}

const sourceRows = [
  { active: true, email: 'cross-server-1@example.invalid', privateCode: 'SOURCE_PRIVATE_1' },
  { active: false, email: 'cross-server-2@example.invalid', privateCode: 'SOURCE_PRIVATE_2' },
  { active: true, email: 'cross-server-3@example.invalid', privateCode: 'SOURCE_PRIVATE_3' },
];

const sourceServer = String.raw`
  import { createInterface } from 'node:readline';
  const rows = ${JSON.stringify(sourceRows)};
  const environmentValid = process.env.SOURCE_DOMAIN === 'SOURCE_ENV_PRIVATE' && process.env.DESTINATION_DOMAIN == null;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      reply(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'source-domain', version: '1.0.0' },
      });
    } else if (message.method === 'tools/list') {
      reply(message.id, { tools: [{
        name: 'private_accounts',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }] });
    } else if (message.method === 'tools/call' && message.params.name === 'private_accounts') {
      reply(message.id, {
        content: [{ type: 'text', text: JSON.stringify(environmentValid ? rows : []) }],
      });
    } else if (message.method === 'tools/call') {
      reply(message.id, {
        content: [{ type: 'text', text: 'SOURCE_PROCESS_RECEIVED_FORBIDDEN_DESTINATION_CALL' }],
        isError: true,
      });
    }
  }
`;

const destinationServer = String.raw`
  import { createInterface } from 'node:readline';
  process.stderr.write('DESTINATION_STDERR_PRIVATE_VALUE\n');
  process.stdout.write('DESTINATION_NON_JSON_PRIVATE_VALUE\n');
  const expected = [
    { email: 'cross-server-1@example.invalid' },
    { email: 'cross-server-3@example.invalid' },
  ];
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      reply(message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'destination-domain', version: '1.0.0' },
      });
    } else if (message.method === 'notifications/initialized') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n');
    } else if (message.method === 'tools/list') {
      reply(message.id, { tools: [{
        name: 'private_campaign_deliver',
        inputSchema: { type: 'object', properties: { recipients: { type: 'array' } } },
      }] });
    } else if (message.method === 'tools/call') {
      const environmentValid = process.env.DESTINATION_DOMAIN === 'DESTINATION_ENV_PRIVATE' && process.env.SOURCE_DOMAIN == null;
      const payloadValid = JSON.stringify(message.params.arguments.recipients) === JSON.stringify(expected);
      const valid = environmentValid && payloadValid && message.params.arguments.campaign === 'renewal';
      reply(message.id, {
        content: [{ type: 'text', text: JSON.stringify({
          valid,
          privateResult: 'DESTINATION_RESULT_PRIVATE_VALUE',
        }) }],
        ...(valid ? {} : { isError: true }),
      });
    }
  }
`;

describe('cross-server opaque MCP flow', () => {
  it('fails closed and terminates when the private destination catalog is invalid', async () => {
    const malformedDestination = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'malformed-destination', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, { tools: [], nextCursor: 'forbidden-pagination' });
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
      input,
      output,
      error: new PassThrough(),
      flows: [{
        name: 'deliver_active_cross_server',
        sourceTool: 'private_accounts',
        destinationTool: 'private_campaign_deliver',
        destinationArgument: 'recipients',
        allowedOps: ['json_select'],
        allowedFields: ['email'],
      }],
      destination: {
        id: 'invalid-domain',
        command: process.execPath,
        args: ['--input-type=module', '--eval', malformedDestination],
        shutdownGraceMs: 100,
      },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(await next()).toMatchObject({
      id: 1,
      error: { code: -32603, message: 'opaque destination initialization failed' },
    });
    expect(await running).not.toBe(0);
    input.end();
  });

  it('moves one exact projection across isolated stdio processes without exposing either domain', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const next = responses(output);
    const visible: string[] = [];
    const diagnostics: string[] = [];
    output.on('data', (chunk) => visible.push(String(chunk)));
    error.on('data', (chunk) => diagnostics.push(String(chunk)));

    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
      input,
      output,
      error,
      env: {
        SOURCE_DOMAIN: 'SOURCE_ENV_PRIVATE',
        DESTINATION_DOMAIN: 'DESTINATION_ENV_PRIVATE',
      },
      flows: [{
        name: 'deliver_active_cross_server',
        sourceTool: 'private_accounts',
        sourceKind: 'json-array',
        destinationTool: 'private_campaign_deliver',
        destinationArgument: 'recipients',
        fixedDestinationArguments: { campaign: 'renewal' },
        allowedOps: ['json_select'],
        fixedWhere: { active: true },
        allowedFields: ['email'],
        maxItems: 10,
        maxBytes: 2048,
      }],
      destination: {
        id: 'crm-domain',
        command: process.execPath,
        args: ['--input-type=module', '--eval', destinationServer],
        env: { DESTINATION_DOMAIN: 'DESTINATION_ENV_PRIVATE' },
      },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await next();
    expect(initialized).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'pinpoint-gateway/source-domain' } },
    });

    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await next();
    expect((listed.result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)).toEqual([
      'private_accounts',
      MCP_FLOW_TOOL_NAME,
    ]);
    expect(JSON.stringify(listed)).not.toContain('destination-domain');

    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'private_accounts', arguments: {} },
    });
    const source = await next();
    const artifactId = JSON.stringify(source).match(/vctx_[a-f0-9]{32,64}/)?.[0];
    expect(artifactId).toBeDefined();

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'private_campaign_deliver', arguments: { recipients: [] } },
    });
    expect(await next()).toMatchObject({ id: 4, result: { isError: true } });

    send(input, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_cross_server',
          id: artifactId,
          op: 'json_select',
          fields: ['email'],
        },
      },
    });
    const flowed = await next();
    const receiptText = (flowed.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
    const receipt = JSON.parse(receiptText).pinpointFlow;
    expect(receipt).toMatchObject({
      destinationServer: 'crm-domain',
      destinationTool: 'private_campaign_deliver',
      destinationSucceeded: true,
      items: 2,
      projectionFields: ['email'],
    });
    expect(verifyMcpOpaqueFlowReceipt(receipt)).toBe(true);

    for (const id of [6, 7]) {
      send(input, {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: MCP_FLOW_TOOL_NAME,
          arguments: {
            flow: 'deliver_active_cross_server',
            id: artifactId,
            op: 'json_select',
            fields: ['email'],
          },
        },
      });
    }
    const concurrent = [await next(), await next()];
    expect(concurrent.map(({ id }) => id).sort()).toEqual([6, 7]);
    const concurrentReceipts = concurrent
      .map((response) => {
        const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
        return JSON.parse(text).pinpointFlow;
      })
      .sort((left, right) => left.sequence - right.sequence);
    expect(concurrentReceipts[0]).toMatchObject({
      sequence: 2,
      previousReceiptHash: receipt.receiptHash,
      destinationSucceeded: true,
    });
    expect(concurrentReceipts[1]).toMatchObject({
      sequence: 3,
      previousReceiptHash: concurrentReceipts[0].receiptHash,
      destinationSucceeded: true,
    });
    expect(concurrentReceipts.every((candidate) => verifyMcpOpaqueFlowReceipt(candidate))).toBe(true);

    const transcript = visible.join('');
    for (const row of sourceRows) {
      expect(transcript).not.toContain(row.email);
      expect(transcript).not.toContain(row.privateCode);
    }
    for (const privateValue of [
      'SOURCE_ENV_PRIVATE',
      'DESTINATION_ENV_PRIVATE',
      'DESTINATION_STDERR_PRIVATE_VALUE',
      'DESTINATION_NON_JSON_PRIVATE_VALUE',
      'DESTINATION_RESULT_PRIVATE_VALUE',
      'SOURCE_PROCESS_RECEIVED_FORBIDDEN_DESTINATION_CALL',
    ]) {
      expect(transcript).not.toContain(privateValue);
      expect(diagnostics.join('')).not.toContain(privateValue);
    }
    expect(diagnostics.join('')).toContain('destination stderr suppressed');

    input.end();
    expect(await running).toBe(0);
  });

  it('returns one signed unconfirmed receipt and fails the session when the destination times out', async () => {
    const hangingDestination = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'hanging-destination', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, { tools: [{ name: 'private_campaign_deliver', inputSchema: { type: 'object' } }] });
        } else if (message.method === 'tools/call') {
          // A side effect could have happened here; deliberately never confirm it.
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
      input,
      output,
      error: new PassThrough(),
      env: { SOURCE_DOMAIN: 'SOURCE_ENV_PRIVATE' },
      flows: [{
        name: 'deliver_active_cross_server',
        sourceTool: 'private_accounts',
        sourceKind: 'json-array',
        destinationTool: 'private_campaign_deliver',
        destinationArgument: 'recipients',
        allowedOps: ['json_select'],
        fixedWhere: { active: true },
        allowedFields: ['email'],
      }],
      destination: {
        id: 'timeout-domain',
        command: process.execPath,
        args: ['--input-type=module', '--eval', hangingDestination],
        requestTimeoutMs: 100,
        shutdownGraceMs: 100,
      },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await next();
    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'private_accounts', arguments: {} },
    });
    const source = await next();
    const artifactId = JSON.stringify(source).match(/vctx_[a-f0-9]{32,64}/)?.[0];

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_cross_server',
          id: artifactId,
          op: 'json_select',
          fields: ['email'],
        },
      },
    });
    const flowed = await next();
    const receiptText = (flowed.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
    const receipt = JSON.parse(receiptText).pinpointFlow;
    expect(receipt).toMatchObject({
      destinationServer: 'timeout-domain',
      destinationSucceeded: false,
      items: 2,
    });
    expect(verifyMcpOpaqueFlowReceipt(receipt)).toBe(true);
    expect(JSON.stringify(flowed)).not.toContain('destination request timed out');

    send(input, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_cross_server',
          id: artifactId,
          op: 'json_select',
          fields: ['email'],
        },
      },
    });
    expect(await next()).toMatchObject({ id: 5, error: { code: -32003 } });

    input.end();
    expect(await running).toBe(1);
  });

  it('fails and terminalizes an in-flight private flow when the client closes cleanly', async () => {
    const hangingDestination = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') reply(message.id, {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'closing-destination', version: '1.0.0' },
        });
        else if (message.method === 'tools/list') reply(message.id, {
          tools: [{ name: 'private_campaign_deliver', inputSchema: { type: 'object' } }],
        });
        else if (message.method === 'tools/call') {
          // A side effect could have happened; wait for the expected shutdown without replying.
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const visible: string[] = [];
    output.on('data', (chunk) => visible.push(String(chunk)));
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
      input,
      output,
      error: new PassThrough(),
      env: { SOURCE_DOMAIN: 'SOURCE_ENV_PRIVATE' },
      flows: [{
        name: 'deliver_active_cross_server',
        sourceTool: 'private_accounts',
        sourceKind: 'json-array',
        destinationTool: 'private_campaign_deliver',
        destinationArgument: 'recipients',
        allowedOps: ['json_select'],
        fixedWhere: { active: true },
        allowedFields: ['email'],
      }],
      destination: {
        id: 'closing-domain',
        command: process.execPath,
        args: ['--input-type=module', '--eval', hangingDestination],
        shutdownGraceMs: 100,
      },
    });
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await next();
    send(input, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'private_accounts', arguments: {} } });
    const source = await next();
    const artifactId = JSON.stringify(source).match(/vctx_[a-f0-9]{32,64}/)?.[0];
    send(input, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: MCP_FLOW_TOOL_NAME, arguments: {
        flow: 'deliver_active_cross_server', id: artifactId, op: 'json_select', fields: ['email'],
      } },
    });
    input.end();

    expect(await running).toBe(1);
    const responsesForFlow = visible.join('').trim().split('\n').map((line) => JSON.parse(line)).filter(({ id }) => id === 4);
    expect(responsesForFlow).toHaveLength(1);
    const receipt = JSON.parse(responsesForFlow[0].result.content[0].text).pinpointFlow;
    expect(receipt).toMatchObject({ destinationServer: 'closing-domain', destinationSucceeded: false, items: 2 });
    expect(verifyMcpOpaqueFlowReceipt(receipt)).toBe(true);
  });

  it('signs failure and terminates when the destination returns a malformed error status', async () => {
    const malformedDestination = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'malformed-status-destination', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, { tools: [{ name: 'private_campaign_deliver', inputSchema: { type: 'object' } }] });
        } else if (message.method === 'tools/call') {
          reply(message.id, {
            content: [{ type: 'text', text: 'MALFORMED_DESTINATION_PRIVATE_VALUE' }],
            isError: 'true',
          });
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const visible: string[] = [];
    output.on('data', (chunk) => visible.push(String(chunk)));
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', sourceServer], {
      input,
      output,
      error: new PassThrough(),
      env: { SOURCE_DOMAIN: 'SOURCE_ENV_PRIVATE' },
      flows: [{
        name: 'deliver_active_cross_server',
        sourceTool: 'private_accounts',
        sourceKind: 'json-array',
        destinationTool: 'private_campaign_deliver',
        destinationArgument: 'recipients',
        allowedOps: ['json_select'],
        fixedWhere: { active: true },
        allowedFields: ['email'],
      }],
      destination: {
        id: 'malformed-status-domain',
        command: process.execPath,
        args: ['--input-type=module', '--eval', malformedDestination],
        shutdownGraceMs: 100,
      },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await next();
    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'private_accounts', arguments: {} },
    });
    const source = await next();
    const artifactId = JSON.stringify(source).match(/vctx_[a-f0-9]{32,64}/)?.[0];

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_cross_server',
          id: artifactId,
          op: 'json_select',
          fields: ['email'],
        },
      },
    });
    const flowed = await next();
    const receiptText = (flowed.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
    const receipt = JSON.parse(receiptText).pinpointFlow;
    expect(receipt).toMatchObject({
      destinationServer: 'malformed-status-domain',
      destinationSucceeded: false,
      items: 2,
    });
    expect(verifyMcpOpaqueFlowReceipt(receipt)).toBe(true);
    expect(visible.join('')).not.toContain('MALFORMED_DESTINATION_PRIVATE_VALUE');

    input.end();
    expect(await running).toBe(1);
  });
});