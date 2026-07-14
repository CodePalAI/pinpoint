import { describe, expect, it } from 'vitest';

import { createRuntime } from '../src/pixroom.js';
import { createSecretRedactionIntegration } from '../examples/integrations/redact-secrets.mjs';
import { createJsonToolMinifierIntegration } from '../examples/integrations/json-tool-minifier.mjs';

describe('external integration examples', () => {
  it('hosts a non-compression secret-redaction policy through the public contract', async () => {
    const runtime = createRuntime({
      includeBuiltinIntegrations: false,
      integrations: [createSecretRedactionIntegration()],
      config: { logLevel: 'silent' },
    });
    const secret = ['Bearer', 'abcdefghijklmnop'].join(' ');
    const routed = await runtime.route(
      'openai',
      'gpt-test',
      { model: 'gpt-test', messages: [{ role: 'user', content: `credential ${secret}` }] },
      'payg',
    );

    expect(JSON.stringify(routed.body)).toContain('[REDACTED]');
    expect(JSON.stringify(routed.body)).not.toContain(secret);
    expect(routed.pipeline.decisions[0]).toMatchObject({ status: 'selected' });
    await runtime.shutdown();
  });

  it('hosts a deterministic JSON tool minifier without router changes', async () => {
    const runtime = createRuntime({
      includeBuiltinIntegrations: false,
      integrations: [createJsonToolMinifierIntegration()],
      config: { logLevel: 'silent' },
    });
    const pretty = JSON.stringify([{ id: 1, value: 'exact' }, { id: 2, value: 'same' }], null, 2);
    const routed = await runtime.route(
      'anthropic',
      'claude-test',
      {
        model: 'claude-test',
        messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content: pretty }] }],
      },
      'payg',
    );
    const body = routed.body.messages as Array<{ content: Array<{ content: string }> }>;
    const compact = body[0]?.content[0]?.content ?? '';

    expect(compact.length).toBeLessThan(pretty.length);
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
    expect(routed.pipeline.decisions[0]).toMatchObject({ status: 'selected' });
    await runtime.shutdown();
  });
});