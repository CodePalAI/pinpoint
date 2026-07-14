import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProxyServer } from '../../dist/proxy/server.js';
import { EVIDENCE } from '../evidence.mjs';
import { makeJsonToolResult, makeLogToolResult, makeProseContext } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const resultsDir = join(here, '..', 'results');
const API_ROOT = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';
const PHASE = readOption('--phase') ?? process.env.BENCH_PHASE ?? 'preflight';
const EXPLICIT_MODEL = readOption('--model') ?? process.env.BENCH_MODEL;
const VIRTUAL_CONTEXT = process.env.BENCH_VIRTUAL_CONTEXT === '1';
const VARIANT = VIRTUAL_CONTEXT ? 'virtual' : 'semantic';
const TASK_FILTER = new Set(
  (process.env.BENCH_TASKS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const MAX_USD = readNumber('BENCH_MAX_USD', PHASE === 'canary' ? 0.01 : 0.08);
const MAX_REQUESTS = readInteger(
  'BENCH_MAX_REQUESTS',
  PHASE === 'canary' ? 1 : VIRTUAL_CONTEXT ? 8 : 6,
);
const MAX_OUTPUT_TOKENS = readInteger('BENCH_MAX_OUTPUT_TOKENS', 32);
const TIMEOUT_MS = readInteger('BENCH_TIMEOUT_MS', 90_000);
const ALLOW_PAID = process.env.BENCH_ALLOW_PAID === '1';

const PRICE_TABLE = [
  { pattern: /claude-haiku-4-5/, input: 1, output: 5 },
  { pattern: /claude-sonnet-5/, input: 2, output: 10 },
  { pattern: /claude-sonnet-4-[56]/, input: 3, output: 15 },
  { pattern: /claude-opus-4-[5-8]/, input: 5, output: 25 },
  { pattern: /claude-(fable|mythos)-5/, input: 10, output: 50 },
];

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function readInteger(name, fallback) {
  const parsed = readNumber(name, fallback);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function sanitize(value, key = '') {
  let text = String(value);
  if (key) text = text.split(key).join('[REDACTED]');
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function requireKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is required; enter it through a masked terminal prompt');
  }
  return key;
}

function pricingFor(model) {
  const configuredInput = process.env.BENCH_INPUT_USD_PER_MTOK;
  const configuredOutput = process.env.BENCH_OUTPUT_USD_PER_MTOK;
  if (configuredInput != null || configuredOutput != null) {
    if (configuredInput == null || configuredOutput == null) {
      throw new Error('set both BENCH_INPUT_USD_PER_MTOK and BENCH_OUTPUT_USD_PER_MTOK');
    }
    return {
      input: readNumber('BENCH_INPUT_USD_PER_MTOK', 0),
      output: readNumber('BENCH_OUTPUT_USD_PER_MTOK', 0),
      source: 'environment override',
    };
  }
  const match = PRICE_TABLE.find((entry) => entry.pattern.test(model));
  if (!match) {
    throw new Error(
      `no audited price for ${model}; set BENCH_INPUT_USD_PER_MTOK and BENCH_OUTPUT_USD_PER_MTOK`,
    );
  }
  return { input: match.input, output: match.output, source: 'Anthropic public pricing' };
}

function headers(key) {
  return {
    'content-type': 'application/json',
    'anthropic-version': API_VERSION,
    'x-api-key': key,
  };
}

async function fetchJson(url, key, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...headers(key), ...options.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`request failed: ${sanitize(error instanceof Error ? error.message : error, key)}`);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!response.ok) {
    const message = data?.error?.message ?? data?.raw ?? response.statusText;
    throw new Error(`Anthropic HTTP ${response.status}: ${sanitize(message, key)}`);
  }
  return data;
}

async function listModels(key) {
  const data = await fetchJson(`${API_ROOT}/v1/models?limit=100`, key);
  return Array.isArray(data.data) ? data.data.filter((item) => typeof item?.id === 'string') : [];
}

function chooseModel(models) {
  const ids = models.map((item) => item.id);
  if (EXPLICIT_MODEL) {
    if (!ids.includes(EXPLICIT_MODEL)) {
      throw new Error(`${EXPLICIT_MODEL} is not available to this API key`);
    }
    return EXPLICIT_MODEL;
  }
  const preferences = [
    (id) => id === 'claude-haiku-4-5',
    (id) => id.startsWith('claude-haiku-4-5-'),
    (id) => id === 'claude-sonnet-5',
    (id) => id === 'claude-sonnet-4-6',
  ];
  for (const predicate of preferences) {
    const found = ids.find(predicate);
    if (found) return found;
  }
  throw new Error('no audited low-cost Haiku/Sonnet model is available to this API key');
}

function countBody(body) {
  const out = { model: body.model, messages: body.messages };
  for (const field of ['system', 'tools', 'tool_choice', 'thinking']) {
    if (body[field] != null) out[field] = body[field];
  }
  return out;
}

async function countInputTokens(body, key) {
  const data = await fetchJson(`${API_ROOT}/v1/messages/count_tokens`, key, {
    method: 'POST',
    body: JSON.stringify(countBody(body)),
  });
  if (!Number.isFinite(data.input_tokens)) throw new Error('count_tokens returned no input_tokens');
  return data.input_tokens;
}

function usageOf(message) {
  const usage = message?.usage ?? {};
  return {
    input: Number(usage.input_tokens ?? 0),
    cacheCreate: Number(usage.cache_creation_input_tokens ?? 0),
    cacheRead: Number(usage.cache_read_input_tokens ?? 0),
    output: Number(usage.output_tokens ?? 0),
  };
}

function costOf(usage, pricing) {
  return (
    (usage.input * pricing.input +
      usage.cacheCreate * pricing.input * 1.25 +
      usage.cacheRead * pricing.input * 0.1 +
      usage.output * pricing.output) /
    1_000_000
  );
}

function containsCacheControl(value) {
  if (Array.isArray(value)) return value.some(containsCacheControl);
  if (value == null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'cache_control')) return true;
  return Object.values(value).some(containsCacheControl);
}

function worstCaseCost(body, inputTokens, pricing) {
  const inputMultiplier = containsCacheControl(body) ? 2 : 1;
  return (
    inputTokens * pricing.input * inputMultiplier + body.max_tokens * pricing.output
  ) / 1_000_000;
}

class Budget {
  constructor(maxUSD, maxRequests) {
    this.maxUSD = maxUSD;
    this.maxRequests = maxRequests;
    this.paidRequests = 0;
    this.observedUSD = 0;
    this.exposureUSD = 0;
    this.reservations = new Map();
  }

  reserve(label, projectedUSD, providerRequestBound = 1) {
    if (this.paidRequests + providerRequestBound > this.maxRequests) {
      throw new Error(`paid request cap reached (${this.maxRequests}) before ${label}`);
    }
    if (this.exposureUSD + projectedUSD > this.maxUSD + Number.EPSILON) {
      throw new Error(
        `dollar cap would be exceeded before ${label}: ` +
          `$${(this.exposureUSD + projectedUSD).toFixed(6)} > $${this.maxUSD.toFixed(6)}`,
      );
    }
    this.paidRequests += providerRequestBound;
    this.exposureUSD += projectedUSD;
    this.reservations.set(label, { projectedUSD, providerRequestBound });
  }

  settle(label, actualUSD) {
    const reservation = this.reservations.get(label);
    if (reservation == null) throw new Error(`missing budget reservation for ${label}`);
    this.reservations.delete(label);
    this.exposureUSD += actualUSD - reservation.projectedUSD;
    this.observedUSD += actualUSD;
    if (this.exposureUSD > this.maxUSD + Number.EPSILON) {
      throw new Error(`provider usage exceeded the dollar cap after ${label}`);
    }
  }

  snapshot() {
    return {
      maxUSD: this.maxUSD,
      maxRequests: this.maxRequests,
      paidRequests: this.paidRequests,
      observedUSD: this.observedUSD,
      conservativeExposureUSD: this.exposureUSD,
    };
  }
}

function textOf(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function toolCallsOf(message) {
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({ name: block.name, input: block.input }));
}

async function callMessage({
  baseUrl,
  body,
  key,
  budget,
  label,
  boundInputTokens,
  pricing,
  providerRequestBound = 1,
}) {
  const projectedUSD = worstCaseCost(body, boundInputTokens, pricing) * providerRequestBound;
  budget.reserve(label, projectedUSD, providerRequestBound);
  const started = performance.now();
  const message = await fetchJson(`${baseUrl}/v1/messages`, key, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const latencyMs = performance.now() - started;
  const usage = usageOf(message);
  const costUSD = costOf(usage, pricing);
  budget.settle(label, costUSD);
  return {
    latencyMs,
    usage,
    costUSD,
    stopReason: message.stop_reason ?? null,
    text: textOf(message),
    toolCalls: toolCallsOf(message),
  };
}

function exactAnswer(value) {
  return String(value)
    .trim()
    .replace(/^[`'\"]+|[`'\".,]+$/g, '')
    .toLowerCase();
}

function makeToolHistory(id, toolText, question) {
  const toolUseId = `toolu_bench_${id}`;
  return [
    { role: 'user', content: `Load the synthetic ${id} fixture.` },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolUseId, name: 'read_fixture', input: { id } }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: toolText }],
    },
    { role: 'assistant', content: 'The fixture is loaded.' },
    { role: 'user', content: question },
  ];
}

function buildTasks(model) {
  const jsonText = makeJsonToolResult(120);
  const jsonExpected = JSON.parse(jsonText).find((record) => record.id === 73).email;
  const logText = makeLogToolResult(320);
  const logExpected = String(logText.split('\n').filter((line) => line.includes(' ERROR ')).length);
  const proseExpected = 'SILVER-CEDAR-91';
  const prose = makeProseContext(8_000, 23);
  const insertAt = Math.floor(prose.length * 0.43);
  const proseWithNeedle =
    prose.slice(0, insertAt) +
    `\n\nThe immutable release codename is ${proseExpected}. This identifier must be preserved exactly.\n\n` +
    prose.slice(insertAt);
  const common = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    system: 'Answer from the supplied synthetic context. Return only the requested value.',
  };
  return [
    {
      id: 'json-lookup',
      expected: jsonExpected,
      body: {
        ...common,
        messages: makeToolHistory(
          'json',
          jsonText,
          'What is the email address for record id 73? Return only the email address.',
        ),
      },
    },
    {
      id: 'log-errors',
      expected: logExpected,
      body: {
        ...common,
        messages: makeToolHistory(
          'log',
          logText,
          'How many lines have level ERROR? Return only the integer.',
        ),
      },
    },
    {
      id: 'prose-needle',
      expected: proseExpected,
      body: {
        ...common,
        messages: [
          { role: 'user', content: proseWithNeedle },
          { role: 'assistant', content: 'I have read the context.' },
          { role: 'user', content: 'What is the immutable release codename? Return only the codename.' },
        ],
      },
    },
  ];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function locateHeadroom() {
  const candidates = [
    process.env.PIXROOM_HEADROOM_BIN,
    join(homedir(), 'repos-pixroom', '.headroom-venv', 'bin', 'headroom'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return 'headroom';
}

function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address != null ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return true;
    } catch {
      // Keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startHeadroom(key) {
  const port = await openPort();
  const url = `http://127.0.0.1:${port}`;
  const childEnv = { ...process.env, HEADROOM_MODE: 'cache' };
  delete childEnv.ANTHROPIC_API_KEY;
  const child = spawn(locateHeadroom(), ['proxy', '--port', String(port)], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + sanitize(chunk, key)).slice(-2_000);
  });
  const healthy = await waitForHealth(url);
  if (!healthy) {
    child.kill('SIGKILL');
    throw new Error(`headroom sidecar failed to start: ${stderr.slice(-500)}`);
  }
  return { child, port, url };
}

async function stopChild(child) {
  if (child.killed) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (!child.killed) child.kill('SIGKILL');
}

async function startPixroom(sidecar) {
  const proxy = createProxyServer({
    host: '127.0.0.1',
    port: 0,
    upstreams: { anthropic: API_ROOT },
    optical: { enabled: false },
    virtualContext: {
      enabled: VIRTUAL_CONTEXT,
      protectRecent: 1,
      minChars: 500,
      maxQueryRounds: 1,
    },
    semantic: {
      enabled: true,
      sidecarUrl: sidecar.url,
      autoSpawn: false,
      sidecarPort: sidecar.port,
      protectRecent: 1,
      minTokensToCompress: 100,
      includeUserProse: true,
      proseMinChars: 400,
      healthTimeoutMs: 1_500,
      spawnReadyTimeoutMs: 5_000,
    },
    logLevel: 'warn',
  });
  const address = await proxy.listen();
  return { proxy, baseUrl: `http://${address.host}:${address.port}` };
}

function reportSummary(report) {
  return report.rows.map((row) => ({
    stage: row.stage,
    applied: row.applied,
    reason: row.reason,
    tokensText: row.tokensText,
    tokensCompressed: row.tokensCompressed,
  }));
}

async function preflightTasks(tasks, proxy, key, pricing) {
  const rows = [];
  for (const task of tasks) {
    const routed = await proxy.pixroom.route(
      'anthropic',
      task.body.model,
      structuredClone(task.body),
      'payg',
    );
    const [directTokens, pixroomTokens] = await Promise.all([
      countInputTokens(task.body, key),
      countInputTokens(routed.body, key),
    ]);
    const semanticApplied = routed.report.rows.some(
      (row) => row.stage === 'semantic' && row.applied,
    );
    const virtualApplied = routed.report.rows.some(
      (row) => row.stage === 'virtual' && row.applied,
    );
    const queryToolInjected = JSON.stringify(routed.body).includes('"name":"pixroom_query"');
    const providerRequestBound = virtualApplied && queryToolInjected ? 2 : 1;
    rows.push({
      task,
      transformedBody: routed.body,
      directTokens,
      pixroomTokens,
      semanticApplied,
      virtualApplied,
      queryToolInjected,
      providerRequestBound,
      eligible: (semanticApplied || virtualApplied) && pixroomTokens < directTokens,
      inputSavingsFraction: directTokens > 0 ? 1 - pixroomTokens / directTokens : 0,
      directWorstCaseUSD: worstCaseCost(task.body, directTokens, pricing),
      pixroomWorstCaseUSD:
        worstCaseCost(routed.body, Math.max(directTokens, pixroomTokens), pricing) *
        providerRequestBound,
      report: reportSummary(routed.report),
    });
  }
  return rows;
}

function publicPreflight(row) {
  return {
    id: row.task.id,
    directInputTokens: row.directTokens,
    pixroomInputTokens: row.pixroomTokens,
    semanticApplied: row.semanticApplied,
    virtualApplied: row.virtualApplied,
    queryToolInjected: row.queryToolInjected,
    providerRequestBound: row.providerRequestBound,
    eligible: row.eligible,
    inputSavingsFraction: row.inputSavingsFraction,
    directWorstCaseUSD: row.directWorstCaseUSD,
    pixroomWorstCaseUSD: row.pixroomWorstCaseUSD,
    report: row.report,
  };
}

function writeArtifact(filename, value, key) {
  mkdirSync(resultsDir, { recursive: true });
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.includes(key) || /sk-ant-[A-Za-z0-9_-]+/.test(serialized)) {
    throw new Error('refusing to persist an artifact containing an API key');
  }
  const path = join(resultsDir, filename);
  writeFileSync(path, `${serialized}\n`);
  return path;
}

async function runCanary({ model, key, pricing }) {
  if (!ALLOW_PAID) throw new Error('canary requires BENCH_ALLOW_PAID=1');
  const body = {
    model,
    max_tokens: 8,
    temperature: 0,
    messages: [{ role: 'user', content: 'Reply with exactly CANARY_OK and nothing else.' }],
  };
  const inputTokens = await countInputTokens(body, key);
  const projectedUSD = worstCaseCost(body, inputTokens, pricing);
  if (projectedUSD > MAX_USD) {
    throw new Error(`canary projection $${projectedUSD.toFixed(6)} exceeds cap $${MAX_USD}`);
  }
  const budget = new Budget(MAX_USD, MAX_REQUESTS);
  const result = await callMessage({
    baseUrl: API_ROOT,
    body,
    key,
    budget,
    label: 'canary',
    boundInputTokens: inputTokens,
    pricing,
  });
  const correct = exactAnswer(result.text) === 'canary_ok';
  const artifact = {
    evidenceLevel: EVIDENCE.LIVE_CONTROLLED,
    kind: 'paid-canary',
    generatedAt: new Date().toISOString(),
    model,
    pricing,
    inputTokens,
    projectedWorstCaseUSD: projectedUSD,
    result: { ...result, correct, text: result.text.slice(0, 100) },
    budget: budget.snapshot(),
  };
  const path = writeArtifact('direct-anthropic-canary.json', artifact, key);
  console.log(
    `canary: correct=${correct} input=${result.usage.input} output=${result.usage.output} ` +
      `cost=$${result.costUSD.toFixed(6)} latency=${result.latencyMs.toFixed(0)}ms`,
  );
  console.log(`artifact: ${path}`);
  if (!correct) throw new Error('canary failed correctness; refusing to proceed to paid benchmarks');
}

async function runBenchmark({ model, key, pricing }) {
  const sidecar = await startHeadroom(key);
  let proxyRuntime;
  try {
    proxyRuntime = await startPixroom(sidecar);
    const tasks = buildTasks(model).filter(
      (task) => TASK_FILTER.size === 0 || TASK_FILTER.has(task.id),
    );
    if (tasks.length === 0) throw new Error('BENCH_TASKS selected no known tasks');
    const preflight = await preflightTasks(tasks, proxyRuntime.proxy, key, pricing);
    const eligible = preflight.filter((row) => row.eligible);
    const projectedUSD = eligible.reduce(
      (total, row) => total + row.directWorstCaseUSD + row.pixroomWorstCaseUSD,
      0,
    );
    const preflightArtifact = {
      evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
      kind: 'provider-token-count-preflight',
      generatedAt: new Date().toISOString(),
      model,
      variant: VARIANT,
      pricing,
      paidMessages: 0,
      projectedBenchmarkWorstCaseUSD: projectedUSD,
      capUSD: MAX_USD,
      tasks: preflight.map(publicPreflight),
    };
    const preflightPath = writeArtifact(
      VIRTUAL_CONTEXT
        ? 'direct-anthropic-virtual-preflight.json'
        : 'direct-anthropic-preflight.json',
      preflightArtifact,
      key,
    );
    for (const row of preflight) {
      console.log(
        `preflight ${row.task.id}: ${row.directTokens} -> ${row.pixroomTokens} ` +
          `(${(row.inputSavingsFraction * 100).toFixed(1)}%) eligible=${row.eligible}`,
      );
    }
    console.log(`projected benchmark worst case: $${projectedUSD.toFixed(6)}; artifact: ${preflightPath}`);

    if (PHASE === 'preflight') return;
    if (!ALLOW_PAID) throw new Error('benchmark requires BENCH_ALLOW_PAID=1');
    if (eligible.length === 0) {
      throw new Error('no task produced provider-counted savings; refusing paid benchmark calls');
    }
    const plannedProviderRequests = eligible.reduce(
      (total, row) => total + 1 + row.providerRequestBound,
      0,
    );
    if (plannedProviderRequests > MAX_REQUESTS) {
      throw new Error(
        `${plannedProviderRequests} planned provider calls exceed BENCH_MAX_REQUESTS=${MAX_REQUESTS}`,
      );
    }
    if (projectedUSD > MAX_USD + Number.EPSILON) {
      throw new Error(
        `benchmark projection $${projectedUSD.toFixed(6)} exceeds BENCH_MAX_USD=$${MAX_USD}`,
      );
    }

    const budget = new Budget(MAX_USD, MAX_REQUESTS);
    const random = seededRandom(readInteger('BENCH_SEED', 202606));
    const runs = [];
    for (const row of eligible) {
      const order = random() < 0.5 ? ['direct', 'pixroom'] : ['pixroom', 'direct'];
      const results = {};
      for (const arm of order) {
        const result = await callMessage({
          baseUrl: arm === 'direct' ? API_ROOT : proxyRuntime.baseUrl,
          body: row.task.body,
          key,
          budget,
          label: `${row.task.id}:${arm}`,
          boundInputTokens:
            arm === 'direct' ? row.directTokens : Math.max(row.directTokens, row.pixroomTokens),
          pricing,
          providerRequestBound: arm === 'direct' ? 1 : row.providerRequestBound,
        });
        const correct = exactAnswer(result.text) === exactAnswer(row.task.expected);
        results[arm] = {
          ...result,
          correct,
          text: result.text.slice(0, 200),
        };
        console.log(
          `${row.task.id} ${arm}: correct=${correct} input=${result.usage.input} ` +
            `cost=$${result.costUSD.toFixed(6)} latency=${result.latencyMs.toFixed(0)}ms`,
        );
      }
      runs.push({
        id: row.task.id,
        expected: row.task.expected,
        order,
        preflight: publicPreflight(row),
        results,
      });
    }

    const direct = runs.map((run) => run.results.direct);
    const pixroom = runs.map((run) => run.results.pixroom);
    const sum = (items, select) => items.reduce((total, item) => total + select(item), 0);
    const directInput = sum(direct, (item) => item.usage.input + item.usage.cacheCreate + item.usage.cacheRead);
    const pixroomInput = sum(pixroom, (item) => item.usage.input + item.usage.cacheCreate + item.usage.cacheRead);
    const directCost = sum(direct, (item) => item.costUSD);
    const pixroomCost = sum(pixroom, (item) => item.costUSD);
    const artifact = {
      evidenceLevel: EVIDENCE.LIVE_CONTROLLED,
      kind: 'paid-paired-pilot',
      generatedAt: new Date().toISOString(),
      model,
      variant: VARIANT,
      pricing,
      methodology: {
        repetitions: 1,
        syntheticCorrectnessTasks: runs.length,
        randomizedArmOrder: true,
        retries: 0,
        pixroom: VIRTUAL_CONTEXT
          ? 'virtual exact prefetch enabled with at most one hidden query fallback, semantic fallback, optical disabled'
          : 'semantic enabled, prose enabled, optical disabled, protectRecent=1',
        limitation: 'Controlled pilot only; not statistical or agentic competitor evidence.',
      },
      summary: {
        directCorrect: direct.filter((item) => item.correct).length,
        pixroomCorrect: pixroom.filter((item) => item.correct).length,
        directInputTokens: directInput,
        pixroomInputTokens: pixroomInput,
        inputSavingsFraction: directInput > 0 ? 1 - pixroomInput / directInput : 0,
        directCostUSD: directCost,
        pixroomCostUSD: pixroomCost,
        costSavingsFraction: directCost > 0 ? 1 - pixroomCost / directCost : 0,
      },
      budget: budget.snapshot(),
      runs,
    };
    const path = writeArtifact(
      VIRTUAL_CONTEXT ? 'direct-anthropic-virtual.json' : 'direct-anthropic.json',
      artifact,
      key,
    );
    console.log(
      `summary: quality ${artifact.summary.directCorrect}/${runs.length} -> ` +
        `${artifact.summary.pixroomCorrect}/${runs.length}; input savings ` +
        `${(artifact.summary.inputSavingsFraction * 100).toFixed(1)}%; cost savings ` +
        `${(artifact.summary.costSavingsFraction * 100).toFixed(1)}%`,
    );
    console.log(`artifact: ${path}`);
  } finally {
    if (proxyRuntime) await proxyRuntime.proxy.close();
    await stopChild(sidecar.child);
  }
}

function runSelfTest() {
  const fakeKey = ['sk', 'ant', 'self-test-placeholder'].join('-');
  const scrubbed = sanitize(`before ${fakeKey} after`, fakeKey);
  if (scrubbed.includes(fakeKey) || !scrubbed.includes('[REDACTED]')) {
    throw new Error('self-test: key sanitization failed');
  }
  const pricing = pricingFor('claude-haiku-4-5');
  if (pricing.input !== 1 || pricing.output !== 5) {
    throw new Error('self-test: Haiku pricing table mismatch');
  }
  const budget = new Budget(0.001, 1);
  budget.reserve('first', 0.0005);
  budget.settle('first', 0.0004);
  let capRejected = false;
  try {
    budget.reserve('second', 0.0001);
  } catch {
    capRejected = true;
  }
  if (!capRejected) throw new Error('self-test: request cap was not enforced');
  const tasks = buildTasks('claude-haiku-4-5');
  if (tasks.length !== 3 || tasks.some((task) => !task.expected || !Array.isArray(task.body.messages))) {
    throw new Error('self-test: controlled task construction failed');
  }
  console.log('direct Anthropic benchmark self-test: ok (no network calls)');
}

async function main() {
  if (PHASE === 'self-test') {
    runSelfTest();
    return;
  }
  if (!['preflight', 'canary', 'benchmark'].includes(PHASE)) {
    throw new Error('--phase must be self-test, preflight, canary, or benchmark');
  }
  const key = requireKey();
  const models = await listModels(key);
  const model = chooseModel(models);
  const pricing = pricingFor(model);
  console.log(
    `model=${model}; phase=${PHASE}; variant=${VARIANT}; ` +
      `cap=$${MAX_USD.toFixed(4)}; provider-request-cap=${MAX_REQUESTS}`,
  );
  if (PHASE === 'canary') await runCanary({ model, key, pricing });
  else await runBenchmark({ model, key, pricing });
}

main().catch((error) => {
  console.error(`direct Anthropic benchmark aborted: ${sanitize(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});