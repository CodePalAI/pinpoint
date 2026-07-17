import { PassThrough } from 'node:stream';
import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  MCP_FLOW_TOOL_NAME,
  MCP_QUERY_TOOL_NAME,
  McpResultFirewall,
  runMcpGateway,
} from '../src/mcp/gateway.js';
import { verifyMcpOpaqueFlowReceipt } from '../src/mcp/flow.js';
import type { DashboardEvent } from '../src/dashboard/types.js';

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

describe('McpResultFirewall', () => {
  it('virtualizes an oversized upstream result and recovers an exact row', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const rows = Array.from({ length: 200 }, (_, accountId) => ({
      accountId,
      email: `user${accountId}@example.com`,
      active: accountId % 2 === 0,
    }));
    const raw = JSON.stringify(rows);

    const transformed = firewall.transformResult('accounts_list', {
      content: [{ type: 'text', text: raw }],
    });

    expect(transformed.virtualized).toBe(true);
    expect(transformed.descriptor).toMatchObject({
      kind: 'json-array',
      items: 200,
      fields: ['accountId', 'active', 'email'],
    });
    expect(JSON.stringify(transformed.result).length).toBeLessThan(raw.length / 5);
    expect(transformed.result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'resource_link',
          uri: `pinpoint://artifact/${transformed.descriptor?.id}`,
        }),
      ]),
    );

    const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, {
      id: transformed.descriptor?.id,
      op: 'json_select',
      where: { accountId: 73 },
      fields: ['email'],
    });

    expect(queried.isError).not.toBe(true);
    expect(JSON.parse(queried.content[0]?.text ?? '{}')).toEqual({
      matches: [{ email: 'user73@example.com' }],
      count: 1,
      truncated: false,
    });
  });

  it('leaves small and error results byte-for-byte equivalent', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const small = { content: [{ type: 'text', text: '{"ok":true}' }] };
    const error = {
      content: [{ type: 'text', text: 'ERROR '.repeat(200) }],
      isError: true,
    };

    expect(firewall.transformResult('small', small)).toEqual({
      result: small,
      virtualized: false,
    });
    expect(firewall.transformResult('error', error)).toEqual({
      result: error,
      virtualized: false,
    });
  });

  it('captures protected sources at any size and fails closed without value disclosure', () => {
    const firewall = new McpResultFirewall({
      minChars: 100_000,
      exposeQueryTool: false,
      flowToolAvailable: true,
      protectedSourceTools: ['secrets_read'],
    });
    const raw = JSON.stringify([{ email: 'tiny-private@example.com' }]);
    const protectedResult = firewall.transformResult('secrets_read', {
      content: [{ type: 'text', text: raw }],
      _meta: { diagnostic: 'meta-private-value' },
      extensionValue: 'extension-private-value',
    });

    expect(protectedResult.virtualized).toBe(true);
    expect(JSON.stringify(protectedResult.result)).not.toContain('tiny-private@example.com');
    expect(JSON.stringify(protectedResult.result)).not.toContain('meta-private-value');
    expect(JSON.stringify(protectedResult.result)).not.toContain('extension-private-value');
    expect(protectedResult.result.content).toHaveLength(1);
    expect(protectedResult.descriptor?.id).not.toBe(
      `vctx_${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`,
    );

    const protectedError = firewall.transformResult('secrets_read', {
      content: [{ type: 'text', text: 'password=error-secret' }],
      isError: true,
    });
    expect(protectedError.result.isError).toBe(true);
    expect(JSON.stringify(protectedError.result)).not.toContain('error-secret');

    const capacityBound = new McpResultFirewall({
      minChars: 1,
      maxStoredBytes: 1,
      exposeQueryTool: false,
      flowToolAvailable: true,
      protectedSourceTools: ['secrets_read'],
    });
    const refused = capacityBound.transformResult('secrets_read', {
      content: [{ type: 'text', text: raw }],
    });
    expect(refused.result.isError).toBe(true);
    expect(JSON.stringify(refused.result)).not.toContain('tiny-private@example.com');
  });

  it('finds the only nested record array in structured MCP output', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const rows = Array.from({ length: 100 }, (_, accountId) => ({
      accountId,
      email: `nested${accountId}@example.com`,
    }));
    const transformed = firewall.transformResult('accounts_search', {
      content: [{ type: 'text', text: '100 matching accounts' }],
      structuredContent: {
        requestId: 'req_123',
        data: { accounts: rows },
      },
    });

    expect(transformed.virtualized).toBe(true);
    expect(transformed.descriptor).toMatchObject({
      kind: 'json-array',
      items: 100,
      fields: ['accountId', 'email'],
      dataPath: ['data', 'accounts'],
    });
    const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, {
      id: transformed.descriptor?.id,
      op: 'json_select',
      where: { accountId: 73 },
      fields: ['email'],
    });
    expect(JSON.parse(queried.content[0]?.text ?? '{}')).toMatchObject({
      matches: [{ email: 'nested73@example.com' }],
      count: 1,
    });
  });

  it('unwraps an identical single-string structured content wrapper', () => {
    const firewall = new McpResultFirewall({ minChars: 100 });
    const rows = Array.from({ length: 40 }, (_, accountId) => ({
      accountId,
      email: `wrapped-string-${accountId}@example.invalid`,
    }));
    const raw = JSON.stringify(rows);
    const transformed = firewall.transformResult('read_text_file', {
      content: [{ type: 'text', text: raw }],
      structuredContent: { content: raw },
    });

    expect(transformed.virtualized).toBe(true);
    expect(transformed.descriptor).toMatchObject({
      kind: 'json-array',
      items: 40,
      fields: ['accountId', 'email'],
    });
    const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, {
      id: transformed.descriptor?.id,
      op: 'json_select',
      where: { accountId: 17 },
      fields: ['email'],
    });
    expect(JSON.parse(queried.content[0]?.text ?? '{}')).toMatchObject({
      count: 1,
      matches: [{ email: 'wrapped-string-17@example.invalid' }],
    });
  });

  it('fails open when the exact artifact cannot fit in local storage', () => {
    const firewall = new McpResultFirewall({ minChars: 10, maxStoredBytes: 64 });
    const original = {
      content: [{ type: 'text', text: JSON.stringify([{ id: 1, value: 'x'.repeat(500) }]) }],
    };

    expect(firewall.transformResult('oversized', original)).toEqual({
      result: original,
      virtualized: false,
    });
    expect(firewall.store.size).toBe(0);
  });

  it('fails open on structured values that cannot be serialized', () => {
    const firewall = new McpResultFirewall({ minChars: 1 });
    const original = {
      content: [{ type: 'text', text: 'structured result' }],
      structuredContent: { unsupported: 1n },
    };

    expect(firewall.transformResult('unsupported', original)).toEqual({
      result: original,
      virtualized: false,
    });
  });

  it('fails open on competing nested record collections', () => {
    const firewall = new McpResultFirewall({ minChars: 100 });
    const records = Array.from({ length: 20 }, (_, id) => ({ id, value: 'x'.repeat(20) }));
    const original = {
      content: [{ type: 'text', text: 'two collections' }],
      structuredContent: { data: { accounts: records, orders: records } },
    };

    expect(firewall.transformResult('ambiguous', original)).toEqual({
      result: original,
      virtualized: false,
    });
    expect(firewall.store.size).toBe(0);
  });

  it('uses query access as LRU recency and prunes evicted resource metadata', () => {
    const firewall = new McpResultFirewall({ minChars: 100, maxEntries: 2 });
    const payload = (marker: string) => ({
      content: [{
        type: 'text',
        text: JSON.stringify(Array.from({ length: 30 }, (_, id) => ({ id, marker, value: 'x'.repeat(20) }))),
      }],
    });
    const first = firewall.transformResult('first', payload('first')).descriptor!;
    const second = firewall.transformResult('second', payload('second')).descriptor!;
    firewall.callTool(MCP_QUERY_TOOL_NAME, { id: first.id, op: 'schema' });
    const third = firewall.transformResult('third', payload('third')).descriptor!;

    expect(firewall.store.has(first.id)).toBe(true);
    expect(firewall.store.has(second.id)).toBe(false);
    expect(firewall.store.has(third.id)).toBe(true);
    expect(firewall.listResources().map(({ uri }) => uri)).toEqual([
      `pinpoint://artifact/${first.id}`,
      `pinpoint://artifact/${third.id}`,
    ]);
  });

  it('proxies an upstream MCP server before the host can truncate its result', async () => {
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      const rows = Array.from({ length: 200 }, (_, accountId) => ({
        accountId,
        email: 'user' + accountId + '@example.com',
        active: accountId % 2 === 0,
      }));
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'accounts', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, {
            tools: [{
              name: 'accounts_list',
              description: 'List accounts.',
              inputSchema: { type: 'object', properties: {} },
              outputSchema: {
                type: 'object',
                properties: { rows: { type: 'array' } },
                required: ['rows'],
              },
            }],
          });
        } else if (message.method === 'tools/call') {
          reply(message.id, {
            content: [{ type: 'text', text: JSON.stringify(rows) }],
          });
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const next = responses(output);
    const observed: DashboardEvent[] = [];
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error,
      minChars: 500,
      observer: { onEvent: (event) => { observed.push(event); } },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await next();
    expect(initialized).toMatchObject({
      id: 1,
      result: { capabilities: { tools: {}, resources: {} } },
    });

    send(input, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await next();
    const tools = (listed.result as { tools: Array<{ name: string; outputSchema?: unknown }> }).tools;
    expect(tools.map(({ name }) => name)).toEqual([
      'accounts_list',
      MCP_QUERY_TOOL_NAME,
    ]);
    expect(tools[0]?.outputSchema).toMatchObject({ anyOf: expect.any(Array) });

    send(input, { jsonrpc: '2.0', id: 22, method: 'tools/list', params: { cursor: 'next' } });
    const laterPage = await next();
    const laterTools = (laterPage.result as { tools: Array<{ name: string; outputSchema?: unknown }> }).tools;
    expect(laterTools.map(({ name }) => name)).toEqual(['accounts_list']);
    expect(laterTools[0]?.outputSchema).toMatchObject({ anyOf: expect.any(Array) });

    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'accounts_list', arguments: {} },
    });
    const called = await next();
    const callResult = called.result as { content: Array<Record<string, unknown>> };
    const resource = callResult.content.find(({ type }) => type === 'resource_link');
    expect(resource?.uri).toMatch(/^pinpoint:\/\/artifact\/vctx_[a-f0-9]{32}$/);
    const artifactId = String(resource?.uri).split('/').at(-1);

    send(input, {
      jsonrpc: '2.0',
      id: 31,
      method: 'resources/read',
      params: { uri: resource?.uri },
    });
    const read = await next();
    const resourceText = (read.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? '';
    expect(resourceText.length).toBeLessThan(12_000);
    expect(resourceText).toContain('bounded preview');

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: MCP_QUERY_TOOL_NAME,
        arguments: {
          id: artifactId,
          op: 'json_select',
          where: { accountId: 73 },
          fields: ['email'],
        },
      },
    });
    const queried = await next();
    const queryResult = queried.result as { content: Array<{ text: string }> };
    expect(JSON.parse(queryResult.content[0]?.text ?? '{}')).toEqual({
      matches: [{ email: 'user73@example.com' }],
      count: 1,
      truncated: false,
    });

    input.end();
    expect(await running).toBe(0);
    expect(observed.map(({ type }) => type)).toEqual([
      'mcp.lifecycle',
      'mcp.result',
      'mcp.tool',
      'mcp.query',
      'mcp.lifecycle',
    ]);
    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mcp.result',
        tool: 'accounts_list',
        outcome: 'succeeded',
        virtualized: true,
        bytesBefore: expect.objectContaining({ unit: 'bytes', source: 'mcp', basis: 'exact-bytes' }),
        bytesVisible: expect.objectContaining({ unit: 'bytes', source: 'mcp', basis: 'exact-bytes' }),
        artifactKind: 'json-array',
        artifactItems: 200,
      }),
      expect.objectContaining({
        type: 'mcp.query',
        operation: 'json_select',
        outcome: 'succeeded',
      }),
    ]));
    const serializedObserved = JSON.stringify(observed);
    expect(serializedObserved).not.toContain('user73@example.com');
    expect(serializedObserved).not.toContain(String(artifactId));
    expect(serializedObserved).not.toContain('accountId');
  });

  it('terminates the wrapped server when the gateway is aborted', async () => {
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      process.on('SIGTERM', () => {});
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'abort-test', version: '1.0.0' },
            },
          }) + '\n');
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const controller = new AbortController();
    const next = responses(output);
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error: new PassThrough(),
      signal: controller.signal,
      shutdownGraceMs: 20,
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    controller.abort();

    expect(await running).toBeNull();
  });

  it('observes upstream tool failures without copying JSON-RPC error details', async () => {
    const secret = 'upstream-error-private-canary';
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
            protocolVersion: '2024-11-05', capabilities: { tools: {} },
            serverInfo: { name: 'failure-fixture', version: '1.0.0' },
          } }) + '\n');
        } else if (message.method === 'tools/call') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: {
            code: -32001, message: '${secret}', data: { private: '${secret}' },
          } }) + '\n');
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const observed: DashboardEvent[] = [];
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error: new PassThrough(),
      observer: { onEvent: (event) => { observed.push(event); } },
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    send(input, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'failing_tool', arguments: { private: secret } },
    });
    expect(await next()).toMatchObject({ id: 2, error: { code: -32001, message: secret } });
    input.end();
    expect(await running).toBe(0);

    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mcp.tool', tool: 'failing_tool', outcome: 'failed' }),
    ]));
    expect(JSON.stringify(observed)).not.toContain(secret);
  });

  it('blocks malformed and unsolicited protocol paths around protected sources', async () => {
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'hostile-protocol-fixture', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, { tools: [
            { name: 'protected_read', inputSchema: { type: 'object', properties: {} } },
            {
              name: 'hidden_write',
              inputSchema: {
                type: 'object',
                properties: { records: { type: 'array' } },
                required: ['records'],
              },
            },
          ] });
        } else if (message.method === 'tools/call' && message.params.name === 'hidden_write') {
          process.stderr.write('notification-destination-canary\n');
          reply(message.id, { content: [{ type: 'text', text: 'unexpected direct destination' }] });
        } else if (message.method === 'tools/call' && message.params.name === 'protected_read') {
          reply(message.id, { structuredContent: { secret: 'malformed-source-canary' } });
          process.stdout.write('late-non-json-canary\n');
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 'unknown-response',
            result: { secret: 'unknown-response-canary' },
          }) + '\n');
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const next = responses(output);
    const visible: string[] = [];
    const diagnostics: string[] = [];
    output.on('data', (chunk) => visible.push(String(chunk)));
    error.on('data', (chunk) => diagnostics.push(String(chunk)));
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error,
      flows: [{
        name: 'hostile_flow',
        sourceTool: 'protected_read',
        destinationTool: 'hidden_write',
        destinationArgument: 'records',
        allowedOps: ['json_select'],
        allowedFields: ['value'],
      }],
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await next();
    send(input, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'hidden_write', arguments: { records: [] } },
    });
    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'protected_read', arguments: {} },
    });
    send(input, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    const collided = [await next(), await next()];
    expect(collided.some((response) =>
      response.id === 3 &&
      (response.error as { code?: number } | undefined)?.code === -32600,
    )).toBe(true);
    expect(collided.some((response) =>
      response.id === 3 &&
      (response.result as { isError?: boolean } | undefined)?.isError === true,
    )).toBe(true);

    send(input, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });
    expect(await next()).toMatchObject({ id: 4, result: { tools: expect.any(Array) } });
    const allVisible = visible.join('');
    const allDiagnostics = diagnostics.join('');
    for (const canary of [
      'notification-destination-canary',
      'malformed-source-canary',
      'late-non-json-canary',
      'unknown-response-canary',
    ]) {
      expect(allVisible).not.toContain(canary);
      expect(allDiagnostics).not.toContain(canary);
    }

    input.end();
    expect(await running).toBe(0);
  });

  it('moves an exact projection into an allowlisted tool without exposing values to the client', async () => {
    const secretRows = Array.from({ length: 100 }, (_, id) => ({
      id,
      active: id % 2 === 0,
      email: `private${id}@example.com`,
      apiKey: `secret-key-${id}`,
    }));
    const selected = secretRows
      .filter(({ active }) => active)
      .map(({ email }) => ({ email }));
    const selectedText = JSON.stringify(selected);
    const selectedHash = createHash('sha256').update(selectedText).digest('hex');
    const deterministicArtifactId = `vctx_${createHash('sha256')
      .update(JSON.stringify(secretRows))
      .digest('hex')
      .slice(0, 32)}`;
    const upstream = String.raw`
      import { createHash } from 'node:crypto';
      import { createInterface } from 'node:readline';
      const rows = ${JSON.stringify(secretRows)};
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'private-pipeline', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, { tools: [
            {
              name: 'secrets_list',
              description: 'Return private account records.',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'campaign_deliver',
              description: 'Deliver a campaign to exact recipients.',
              inputSchema: {
                type: 'object',
                properties: {
                  campaign: { type: 'string' },
                  recipients: { type: 'array', items: { type: 'object' } },
                },
                required: ['campaign', 'recipients'],
              },
            },
          ] });
        } else if (message.method === 'tools/call') {
          if (message.params.name === 'secrets_list') {
            reply(message.id, {
              content: [{ type: 'text', text: JSON.stringify(rows) }],
            });
          } else if (message.params.name === 'campaign_deliver') {
            const recipients = message.params.arguments.recipients;
            const payloadHash = createHash('sha256').update(JSON.stringify(recipients)).digest('hex');
            const valid = payloadHash === '${selectedHash}' && message.params.arguments.campaign === 'renewal';
            reply(message.id, {
              content: [{ type: 'text', text: JSON.stringify({ accepted: recipients.length, valid }) }],
              structuredContent: { accepted: recipients.length, valid },
              ...(valid ? {} : { isError: true }),
            });
          }
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const next = responses(output);
    const visible: string[] = [];
    const operator = generateKeyPairSync('ed25519');
    let authorityRecord: Record<string, unknown> | undefined;
    output.on('data', (chunk) => visible.push(String(chunk)));
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error: new PassThrough(),
      minChars: 500,
      flowAuthoritySigningKey: operator.privateKey,
      onFlowAuthorityReady: (record) => { authorityRecord = record as unknown as Record<string, unknown>; },
      flows: [{
        name: 'deliver_active_accounts',
        description: 'Send active account emails to the campaign delivery tool.',
        sourceTool: 'secrets_list',
        sourceKind: 'json-array',
        destinationTool: 'campaign_deliver',
        destinationArgument: 'recipients',
        allowedDestinationArguments: ['campaign'],
        allowedOps: ['json_select'],
        allowedWhereFields: ['active'],
        allowedFields: ['email'],
        maxItems: 60,
        maxBytes: 10_000,
        hideDestinationTool: true,
      }],
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await next();
    expect((initialized.result as { capabilities: Record<string, unknown> }).capabilities).not.toHaveProperty(
      'resources',
    );
    const initializedVerifier = (initialized.result as {
      _meta: { pinpoint: { opaqueFlow: { receiptVerifier: Record<string, unknown> } } };
    })._meta.pinpoint.opaqueFlow.receiptVerifier;
    expect(initializedVerifier.authority).toEqual(authorityRecord?.authority);
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await next();
    expect((listed.result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)).toEqual([
      'secrets_list',
      MCP_FLOW_TOOL_NAME,
    ]);

    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'secrets_list', arguments: {} },
    });
    const source = await next();
    const sourceText = JSON.stringify(source);
    expect(sourceText).not.toContain('resource_link');
    const artifactId = sourceText.match(/vctx_[a-f0-9]{32,64}/)?.[0];
    expect(artifactId).toBeDefined();
    expect(artifactId).not.toBe(deterministicArtifactId);

    send(input, {
      jsonrpc: '2.0',
      id: 31,
      method: 'resources/read',
      params: { uri: `pinpoint://artifact/${artifactId}` },
    });
    expect(await next()).toMatchObject({ id: 31, error: { code: -32002 } });

    send(input, {
      jsonrpc: '2.0',
      id: 32,
      method: 'tools/call',
      params: { name: MCP_QUERY_TOOL_NAME, arguments: { id: artifactId, op: 'slice', limit: 1 } },
    });
    expect(await next()).toMatchObject({
      id: 32,
      result: { isError: true },
    });

    send(input, {
      jsonrpc: '2.0',
      id: 33,
      method: 'tools/call',
      params: { name: 'campaign_deliver', arguments: { recipients: [], campaign: 'renewal' } },
    });
    expect(await next()).toMatchObject({
      id: 33,
      result: { isError: true },
    });

    send(input, {
      jsonrpc: '2.0',
      id: 34,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_accounts',
          id: artifactId,
          op: 'json_select',
          where: { active: true },
          fields: ['apiKey'],
        },
      },
    });
    expect(await next()).toMatchObject({ id: 34, result: { isError: true } });

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_accounts',
          id: artifactId,
          op: 'json_select',
          where: { active: true },
          fields: ['email'],
          destinationArguments: { campaign: 'renewal' },
        },
      },
    });
    const flowed = await next();
    const receiptText = (flowed.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const receipt = JSON.parse(receiptText).pinpointFlow;
    expect(receipt).toMatchObject({
      receiptVersion: 1,
      sequence: 1,
      flow: 'deliver_active_accounts',
      sourceTool: 'secrets_list',
      destinationTool: 'campaign_deliver',
      destinationArgument: 'recipients',
      op: 'json_select',
      whereFields: ['active'],
      projectionFields: ['email'],
      destinationArgumentNames: ['campaign'],
      policyShapeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      policyLimits: { maxItems: 60, maxBytes: 10_000 },
      items: selected.length,
      payloadBytes: Buffer.byteLength(selectedText),
      commitmentAlgorithm: 'HMAC-SHA256',
      payloadCommitment: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      queryCommitment: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      destinationSucceeded: true,
      destinationResultCommitment: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
      previousReceiptHash: '0'.repeat(64),
      signingKeyId: expect.stringMatching(/^[a-f0-9]{64}$/),
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      verifier: {
        algorithm: 'Ed25519',
        publicKey: expect.any(String),
      },
      signature: expect.any(String),
      disclosure: 'receipt',
    });
    expect(receipt.verifier).toEqual({
      algorithm: initializedVerifier.algorithm,
      publicKey: initializedVerifier.publicKey,
      authority: initializedVerifier.authority,
    });
    expect(receipt.signingKeyId).toBe(initializedVerifier.signingKeyId);
    expect(verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier as {
      algorithm: 'Ed25519';
      publicKey: string;
      signingKeyId: string;
      authority: NonNullable<ReturnType<typeof JSON.parse>>;
    })).toBe(true);
    expect(verifyMcpOpaqueFlowReceipt(receipt, {
      algorithm: 'Ed25519',
      publicKey: String(initializedVerifier.publicKey),
      signingKeyId: '0'.repeat(64),
    })).toBe(false);
    expect(verifyMcpOpaqueFlowReceipt({ ...receipt, items: receipt.items + 1 })).toBe(false);

    send(input, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_accounts',
          id: artifactId,
          op: 'json_select',
          where: { active: true },
          fields: ['email'],
          destinationArguments: { campaign: 'renewal' },
        },
      },
    });
    send(input, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: MCP_FLOW_TOOL_NAME,
        arguments: {
          flow: 'deliver_active_accounts',
          id: artifactId,
          op: 'json_select',
          where: { active: true },
          fields: ['email'],
          destinationArguments: { campaign: 'renewal' },
        },
      },
    });
    const concurrentFlows = [await next(), await next()];
    expect(concurrentFlows.map(({ id }) => id).sort()).toEqual([5, 6]);
    const concurrentReceipts = concurrentFlows
      .map((response) => {
        const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
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
    expect(new Set([
      receipt.payloadCommitment,
      ...concurrentReceipts.map(({ payloadCommitment }) => payloadCommitment),
    ]).size).toBe(3);
    expect(concurrentReceipts.every((candidate) => verifyMcpOpaqueFlowReceipt(candidate))).toBe(true);

    const clientVisible = visible.join('');
    for (const row of secretRows) {
      expect(clientVisible).not.toContain(row.email);
      expect(clientVisible).not.toContain(row.apiKey);
    }
    expect(clientVisible).not.toContain(selectedText);
    expect(clientVisible).not.toContain(selectedHash);

    input.end();
    expect(await running).toBe(0);
  });
});