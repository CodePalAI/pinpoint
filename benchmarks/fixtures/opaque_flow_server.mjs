import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

import { rows, selectedSha256 } from './opaque_flow_data.mjs';

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'opaque-flow-fixture', version: '1.0.0' },
    });
  } else if (message.method === 'tools/list') {
    send(message.id, {
      tools: [
        {
          name: 'synthetic_accounts_list',
          description: 'Return generated example.invalid records for a local protocol conformance test.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'synthetic_projection_validate',
          description: 'Validate an exact generated projection locally; this fixture has no external side effects.',
          inputSchema: {
            type: 'object',
            properties: {
              testCase: { type: 'string' },
              projectedRecords: { type: 'array', items: { type: 'object' } },
            },
            required: ['testCase', 'projectedRecords'],
            additionalProperties: false,
          },
        },
      ],
    });
  } else if (message.method === 'tools/call' && message.params?.name === 'synthetic_accounts_list') {
    send(message.id, {
      content: [{ type: 'text', text: JSON.stringify(rows) }],
    });
  } else if (message.method === 'tools/call' && message.params?.name === 'synthetic_projection_validate') {
    const projectedRecords = message.params.arguments?.projectedRecords;
    const payload = JSON.stringify(projectedRecords);
    const payloadSha256 = createHash('sha256').update(payload).digest('hex');
    const valid =
      message.params.arguments?.testCase === 'renewal-email-projection' &&
      payloadSha256 === selectedSha256;
    send(message.id, {
      content: [{ type: 'text', text: JSON.stringify({ accepted: projectedRecords?.length ?? 0, valid }) }],
      structuredContent: { accepted: projectedRecords?.length ?? 0, valid },
      ...(valid ? {} : { isError: true }),
    });
  } else if (message.id !== undefined) {
    send(message.id, {
      content: [{ type: 'text', text: JSON.stringify({ error: 'unknown fixture tool' }) }],
      isError: true,
    });
  }
}