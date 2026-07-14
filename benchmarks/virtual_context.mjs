import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPixroom } from '../dist/index.js';
import { continueVirtualAnthropicTurn } from '../dist/virtual-context/anthropic.js';
import { EVIDENCE } from './evidence.mjs';
import { buildPayloads, countTokens, effectiveTokens } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sidecarUrl = process.env.PIXROOM_HEADROOM_URL || 'http://127.0.0.1:8787';

const QUERIES = {
  'json-data': {
    question: 'What is the email for id 73? Return only the exact value.',
    op: 'json_select',
    where: { id: 73 },
    fields: ['email'],
    expected: 'user73@example.com',
  },
  'build-log': {
    question: 'How many lines have level ERROR? Return only the exact integer.',
    op: 'count',
    query: 'ERROR',
    expected: '9',
  },
  'source-code': {
    question: 'Name the exported classes in this source. Return the exact class names.',
    op: 'grep',
    query: 'export class',
    limit: 20,
    expected: 'export class',
  },
};

function virtualId(body) {
  return JSON.stringify(body).match(/vctx_[a-f0-9]{32}/)?.[0];
}

async function run() {
  const results = {
    evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
    generatedAt: new Date().toISOString(),
    model: 'claude-fable-5',
    methodology: {
      current: 'headroom semantic + pxpipe optical',
      virtual: 'query-backed exact offload + headroom fallback + pxpipe optical',
      total: 'initial request + one full uncached continuation request',
      quality: 'deterministic exact local query check; no model call',
    },
    scenarios: [],
  };

  for (const payload of buildPayloads(repoRoot)) {
    const benchmarkBody = structuredClone(payload.body);
    benchmarkBody.messages = [
      ...benchmarkBody.messages,
      { role: 'assistant', content: 'The dataset is loaded.' },
      { role: 'user', content: QUERIES[payload.name].question },
    ];
    const current = createPixroom({
      virtualContext: { enabled: false },
      semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
      optical: { enabled: true },
      logLevel: 'silent',
    });
    const virtual = createPixroom({
      virtualContext: { enabled: true, protectRecent: 0, minChars: 1_000 },
      semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
      optical: { enabled: true },
      logLevel: 'silent',
    });
    const currentRouted = await current.route(
      'anthropic',
      results.model,
      structuredClone(benchmarkBody),
      'payg',
    );
    const virtualRouted = await virtual.route(
      'anthropic',
      results.model,
      structuredClone(benchmarkBody),
      'payg',
    );
    const id = virtualId(virtualRouted.body);
    if (!id) throw new Error(`${payload.name}: virtual context did not apply`);
    const { question: _question, expected, ...querySpec } = QUERIES[payload.name];
    const query = { id, ...querySpec };
    const queryResult = virtual.virtualContext.query(query);
    const response = {
      content: [
        {
          type: 'tool_use',
          id: `toolu_${payload.name}`,
          name: 'pixroom_query',
          input: query,
        },
      ],
    };
    const continuation = continueVirtualAnthropicTurn(
      virtualRouted.body,
      response,
      virtual.virtualContext,
      new Set([id]),
    );
    if (!continuation) throw new Error(`${payload.name}: continuation was not generated`);

    const rawTokens = countTokens(JSON.stringify(benchmarkBody));
    const currentTokens = effectiveTokens(currentRouted.body, currentRouted.report);
    const virtualInitialTokens = effectiveTokens(virtualRouted.body, virtualRouted.report);
    const continuationTokens = effectiveTokens(continuation, virtualRouted.report);
    const virtualOneQueryTokens = virtualInitialTokens + continuationTokens;
    const exact = queryResult.includes(expected);
    results.scenarios.push({
      name: payload.name,
      rawTokens,
      currentTokens,
      virtualInitialTokens,
      continuationTokens,
      virtualOneQueryTokens,
      reductionVsCurrent:
        currentTokens > 0 ? 1 - virtualOneQueryTokens / currentTokens : 0,
      exact,
      queryResult,
      stages: virtualRouted.report.rows,
    });
    await current.shutdown();
    await virtual.shutdown();
  }

  results.verdict = {
    exact: results.scenarios.every((scenario) => scenario.exact),
    initialSmaller: results.scenarios.every(
      (scenario) => scenario.virtualInitialTokens < scenario.currentTokens,
    ),
    oneUncachedQuerySmaller: results.scenarios.every(
      (scenario) => scenario.virtualOneQueryTokens < scenario.currentTokens,
    ),
  };
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(here, 'results', 'virtual-context.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  for (const scenario of results.scenarios) {
    console.log(
      `${scenario.name.padEnd(12)} current=${scenario.currentTokens} ` +
        `virtual=${scenario.virtualInitialTokens}+${scenario.continuationTokens}` +
        `=${scenario.virtualOneQueryTokens} ` +
        `delta=${(scenario.reductionVsCurrent * 100).toFixed(1)}% exact=${scenario.exact}`,
    );
  }
  console.log(`VERDICT ${JSON.stringify(results.verdict)}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});