/**
 * pixroom MCP server (planning/end_product.md §6).
 *
 * A dependency-free JSON-RPC 2.0 server over stdio (newline-delimited messages,
 * the MCP stdio transport). Exposes three tools mirroring headroom's MCP surface:
 *   - pixroom_compress  — route a provider request through registered optimizers
 *   - pixroom_retrieve  — pull an offloaded original back by CCR id
 *   - pixroom_stats     — session savings
 *
 * All diagnostics go to stderr; stdout carries only protocol messages.
 */

import { createInterface } from 'node:readline';

import type { PixroomConfigOverrides } from '../config.js';
import { createPixroom } from '../pixroom.js';
import type { Provider } from '../types.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: 'pixroom_compress',
    description:
      'Compress a provider request (Anthropic Messages or OpenAI Chat Completions) ' +
      'through pixroom (QCV + semantic + optical) and return the transformed body plus an ' +
      'honest savings report.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['anthropic', 'openai'] },
        model: { type: 'string', description: 'Model id; falls back to body.model.' },
        body: { type: 'object', description: 'The full provider request body.' },
      },
      required: ['provider', 'body'],
    },
  },
  {
    name: 'pixroom_retrieve',
    description: 'Retrieve the full original content that pixroom offloaded, by CCR id / rec_ id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'pixroom_stats',
    description: 'Return running session savings totals for this pixroom instance.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

export async function runMcpServer(overrides: PixroomConfigOverrides = {}): Promise<void> {
  const px = createPixroom(overrides);
  await px.warmup();
  px.log.info('pixroom MCP server ready on stdio');

  const send = (msg: JsonRpcMessage): void => {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  const reply = (id: JsonRpcMessage['id'], result: unknown): void =>
    send({ jsonrpc: '2.0', id, result });
  const fail = (id: JsonRpcMessage['id'], code: number, message: string): void =>
    send({ jsonrpc: '2.0', id, error: { code, message } });

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'pixroom_compress': {
        const provider: Provider = args.provider === 'openai' ? 'openai' : 'anthropic';
        const body = (args.body ?? {}) as Record<string, unknown>;
        const model =
          typeof args.model === 'string'
            ? args.model
            : typeof body.model === 'string'
              ? (body.model as string)
              : null;
        const routed = await px.route(provider, model, body);
        return {
          body: routed.body,
          tokensSaved: routed.report.tokensSavedTotal,
          savedFraction: routed.report.savedFraction,
          rows: routed.report.rows,
          reversible: routed.reversible.length,
          opticalOwnsCacheControl: routed.opticalOwnsCacheControl,
        };
      }
      case 'pixroom_retrieve': {
        const id = String(args.id ?? '');
        const content = await px.retrieve(id);
        return { id, found: content != null, content };
      }
      case 'pixroom_stats':
        return px.stats();
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  async function handle(msg: JsonRpcMessage): Promise<void> {
    const { id, method, params } = msg;
    if (method == null) return; // response/echo — ignore
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'pixroom', version: '0.1.0' },
        });
        return;
      case 'notifications/initialized':
        return; // notification, no reply
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        try {
          const result = await callTool(p.name ?? '', p.arguments ?? {});
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
        } catch (err) {
          reply(id, {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          });
        }
        return;
      }
      default:
        if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
    }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      px.log.warn(`ignoring non-JSON line on stdin`);
      continue;
    }
    await handle(msg);
  }
  await px.shutdown();
}
