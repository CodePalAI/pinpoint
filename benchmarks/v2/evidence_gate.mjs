import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { arch, homedir, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProxyServer } from '../../dist/proxy/server.js';
import { EVIDENCE } from '../evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const resultsDir = join(here, '..', 'results');
const ANTHROPIC_ROOT = 'https://api.anthropic.com';
const OPENAI_ROOT = 'https://api.openai.com';
const API_VERSION = '2023-06-01';
const PHASE = readOption('--phase') ?? process.env.BENCH_PHASE ?? 'preflight';
const REPETITIONS = readInteger('BENCH_REPS', 5);
const SEED = readInteger('BENCH_SEED', 20260715);
const MAX_USD = readNumber('BENCH_MAX_USD', PHASE === 'canary' ? 0.15 : 8);
const MAX_REQUESTS = readInteger(
  'BENCH_MAX_REQUESTS',
  PHASE === 'canary' ? 3 : 30 * REPETITIONS * 3,
);
const MAX_OUTPUT_TOKENS = readInteger('BENCH_MAX_OUTPUT_TOKENS', 32);
const TIMEOUT_MS = readInteger('BENCH_TIMEOUT_MS', 90_000);
const BOOTSTRAP_SAMPLES = readInteger('BENCH_BOOTSTRAP_SAMPLES', 10_000);
const ALLOW_PAID = process.env.BENCH_ALLOW_PAID === '1';
const ARTIFACT_LABEL = artifactLabel(process.env.BENCH_ARTIFACT_LABEL);
const MIN_DATASET_CHARS = 6_000;

const ANTHROPIC_PRICES = [
  { pattern: /claude-haiku-4-5/, input: 1, cachedInput: 0.1, output: 5 },
  { pattern: /claude-sonnet-5/, input: 2, cachedInput: 0.2, output: 10 },
  { pattern: /claude-sonnet-4-[56]/, input: 3, cachedInput: 0.3, output: 15 },
];

const OPENAI_PRICES = [
  { pattern: /^gpt-4\.1-mini(?:-|$)/, input: 0.4, cachedInput: 0.1, output: 1.6 },
  { pattern: /^gpt-4o-mini(?:-|$)/, input: 0.15, cachedInput: 0.075, output: 0.6 },
  { pattern: /^gpt-5-mini(?:-|$)/, input: 0.25, cachedInput: 0.025, output: 2 },
];

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function readInteger(name, fallback) {
  const value = readNumber(name, fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function artifactLabel(value) {
  if (value == null || value.trim() === '') return '';
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error(
      'BENCH_ARTIFACT_LABEL must be 1-80 lowercase letters, numbers, dots, underscores, or hyphens',
    );
  }
  return normalized;
}

function artifactName(base) {
  return ARTIFACT_LABEL ? base.replace(/\.json$/, `.${ARTIFACT_LABEL}.json`) : base;
}

function sanitize(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function requireKeys() {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!anthropic || !openai) {
    throw new Error('ANTHROPIC_API_KEY and OPENAI_API_KEY are required');
  }
  return { anthropic, openai };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function percentile(values, probability) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function wilsonInterval(successes, total, confidenceZ = 1.959963984540054) {
  if (total === 0) return { low: 0, high: 1 };
  const rate = successes / total;
  const denominator = 1 + confidenceZ ** 2 / total;
  const center = (rate + confidenceZ ** 2 / (2 * total)) / denominator;
  const spread =
    (confidenceZ / denominator) *
    Math.sqrt((rate * (1 - rate) + confidenceZ ** 2 / (4 * total)) / total);
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

function binomialCdf(k, n, probability) {
  if (k >= n || probability <= 0) return 1;
  if (probability >= 1) return 0;
  let term = Math.exp(n * Math.log1p(-probability));
  let sum = term;
  for (let index = 0; index < k; index += 1) {
    term *= ((n - index) / (index + 1)) * (probability / (1 - probability));
    sum += term;
  }
  return Math.min(1, sum);
}

function clopperPearsonUpper(successes, total, alpha = 0.05) {
  if (total === 0 || successes >= total) return 1;
  let low = successes / total;
  let high = 1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (binomialCdf(successes, total, midpoint) > alpha) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function pairedBootstrap(rows, selectBaseline, selectQcv, transform, seed) {
  if (rows.length === 0) return { low: 0, high: 0 };
  const random = seededRandom(seed);
  const samples = [];
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample += 1) {
    let baseline = 0;
    let qcv = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[Math.floor(random() * rows.length)];
      baseline += selectBaseline(row);
      qcv += selectQcv(row);
    }
    samples.push(transform(baseline, qcv, rows.length));
  }
  return { low: percentile(samples, 0.025), high: percentile(samples, 0.975) };
}

function pricingFor(provider, model) {
  const table = provider === 'anthropic' ? ANTHROPIC_PRICES : OPENAI_PRICES;
  const match = table.find((entry) => entry.pattern.test(model));
  if (!match) {
    throw new Error(
      `no audited price for ${provider}/${model}; choose a supported low-cost benchmark model`,
    );
  }
  return {
    input: match.input,
    cachedInput: match.cachedInput,
    output: match.output,
    unit: 'USD per million tokens',
    source:
      provider === 'anthropic'
        ? 'Anthropic public API pricing snapshot'
        : 'OpenAI public API pricing snapshot',
    accessedAt: '2026-07-15',
  };
}

function usageCost(usage, pricing) {
  const uncachedInput = Math.max(0, usage.input - usage.cachedInput);
  return (
    uncachedInput * pricing.input +
    usage.cachedInput * pricing.cachedInput +
    usage.output * pricing.output
  ) / 1_000_000;
}

function worstCaseCost(body, pricing) {
  const asciiTokenUpperBound = Buffer.byteLength(JSON.stringify(body));
  return (
    asciiTokenUpperBound * pricing.input + MAX_OUTPUT_TOKENS * pricing.output
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

  reserve(label, projectedUSD) {
    if (this.paidRequests + 1 > this.maxRequests) {
      throw new Error(`paid request cap reached (${this.maxRequests}) before ${label}`);
    }
    if (this.exposureUSD + projectedUSD > this.maxUSD + Number.EPSILON) {
      throw new Error(
        `dollar cap would be exceeded before ${label}: ` +
          `$${(this.exposureUSD + projectedUSD).toFixed(6)} > $${this.maxUSD.toFixed(6)}`,
      );
    }
    this.paidRequests += 1;
    this.exposureUSD += projectedUSD;
    this.reservations.set(label, projectedUSD);
  }

  settle(label, actualUSD) {
    const projectedUSD = this.reservations.get(label);
    if (projectedUSD == null) throw new Error(`missing budget reservation for ${label}`);
    this.reservations.delete(label);
    this.exposureUSD += actualUSD - projectedUSD;
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

async function fetchProvider(url, options, secrets) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `request failed: ${sanitize(error instanceof Error ? error.message : error, secrets)}`,
    );
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message = data?.error?.message ?? data?.raw ?? response.statusText;
    throw new Error(`HTTP ${response.status}: ${sanitize(message, secrets)}`);
  }
  return { data, headers: response.headers };
}

async function listAnthropicModels(key, secrets) {
  const { data } = await fetchProvider(
    `${ANTHROPIC_ROOT}/v1/models?limit=100`,
    { headers: { 'anthropic-version': API_VERSION, 'x-api-key': key } },
    secrets,
  );
  return Array.isArray(data.data) ? data.data.map((item) => item?.id).filter(Boolean) : [];
}

async function listOpenAIModels(key, secrets) {
  const { data } = await fetchProvider(
    `${OPENAI_ROOT}/v1/models`,
    { headers: { authorization: `Bearer ${key}` } },
    secrets,
  );
  return Array.isArray(data.data) ? data.data.map((item) => item?.id).filter(Boolean) : [];
}

function chooseModel(ids, explicit, preferences, provider) {
  if (explicit) {
    if (!ids.includes(explicit)) throw new Error(`${explicit} is unavailable to the ${provider} key`);
    return explicit;
  }
  for (const preference of preferences) {
    const model = ids.find(preference);
    if (model) return model;
  }
  throw new Error(`no audited low-cost ${provider} model is available`);
}

function padding(label, index, template, replication) {
  return (
    `${label} template=${template} variant=${replication} record=${index} ` +
    'deterministic benchmark metadata '
  ).repeat(3);
}

function makeTaskDefinitions() {
  const definitions = [];
  const protocols = ['anthropic-messages', 'openai-chat', 'openai-responses'];
  const add = (category, template, replication, payloads, question, expected) => {
    const ordinal = definitions.length;
    const templateId = `${category}-${template + 1}`;
    definitions.push({
      id: `${templateId}-v${replication + 1}`,
      templateId,
      replication,
      category,
      protocol: protocols[ordinal % protocols.length],
      payloads,
      question,
      expected,
      fixtureSha256: sha256(payloads.join('\n--dataset--\n')),
    });
  };

  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const target = (17 + template * 19 + replication * 11) % 140;
      const rows = Array.from({ length: 140 }, (_, id) => ({
        id,
        email: `lookup${template}-v${replication}-${id}@example.com`,
        status: (id + replication) % 4 === 0 ? 'review' : 'active',
        padding: padding('lookup', id, template, replication),
      }));
      add(
        'json-lookup',
        template,
        replication,
        [JSON.stringify(rows)],
        `What is the email for id ${target}? Return only the email address.`,
        rows[target].email,
      );
    }
  }

  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const divisor = template + 2;
      const rows = Array.from({ length: 150 + replication }, (_, id) => ({
        id,
        active: (id + replication) % divisor === 0,
        label: `count-${template}-v${replication}-${id}`,
        padding: padding('filtered-count', id, template, replication),
      }));
      add(
        'filtered-count',
        template,
        replication,
        [JSON.stringify(rows)],
        'How many records have active is true? Return only the integer.',
        String(rows.filter((row) => row.active).length),
      );
    }
  }

  const levels = ['ERROR', 'WARN', 'FATAL', 'DEBUG', 'TRACE'];
  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const level = levels[template];
      const lines = Array.from({ length: 260 + replication }, (_, index) => {
        const selected = (index + replication) % (template + 3) === 0 ? level : 'INFO';
        return (
          `2026-07-${String(15 + replication).padStart(2, '0')}T12:` +
          `${String(index % 60).padStart(2, '0')}:00Z ${selected} ` +
          `worker=${(index + replication) % 8} job=${index} ` +
          padding('log-event', index, template, replication)
        );
      });
      add(
        'log-count',
        template,
        replication,
        [lines.join('\n')],
        `How many lines have level ${level}? Return only the integer.`,
        String(lines.filter((line) => new RegExp(`\\s${level}\\s`).test(line)).length),
      );
    }
  }

  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const target = (11 + template * 21 + replication * 7) % 130;
      const rows = Array.from({ length: 130 }, (_, rowNumber) => ({
        row_number: rowNumber,
        owner: `team-${(rowNumber + template + replication) % 13}`,
        invoice_code: `INV-${template}-V${replication}-${String(rowNumber).padStart(4, '0')}`,
        padding: padding('table', rowNumber, template, replication),
      }));
      add(
        'table-lookup',
        template,
        replication,
        [JSON.stringify(rows)],
        `What is the owner for row_number ${target}? Return only the owner.`,
        rows[target].owner,
      );
    }
  }

  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const target = (13 + template * 17 + replication * 9) % 130;
      const rows = Array.from({ length: 130 }, (_, id) => ({
        id,
        profile: {
          email: `nested${template}-v${replication}-${id}@example.com`,
          region: `region-${(id + template + replication) % 7}`,
        },
        padding: padding('nested', id, template, replication),
      }));
      add(
        'nested-projection',
        template,
        replication,
        [JSON.stringify(rows)],
        `What is the profile for id ${target}? Return only the email inside profile.`,
        rows[target].profile.email,
      );
    }
  }

  for (let template = 0; template < 5; template += 1) {
    for (let replication = 0; replication < REPETITIONS; replication += 1) {
      const target = (19 + template * 17 + replication * 13) % 130;
      const customerBase = 10_000 + template * 1_000 + replication * 100_000;
      const orders = Array.from({ length: 130 }, (_, orderId) => ({
        order_id: orderId,
        customer_id: orderId + customerBase,
        status: (orderId + replication) % 2 === 0 ? 'open' : 'closed',
        padding: padding('join-source', orderId, template, replication),
      }));
      const customers = Array.from({ length: 130 }, (_, customerIndex) => ({
        customer_id: customerIndex + customerBase,
        email: `joined${template}-v${replication}-${customerIndex}@example.com`,
        tier: (customerIndex + replication) % 3 === 0 ? 'pro' : 'basic',
        padding: padding('join-destination', customerIndex, template, replication),
      }));
      add(
        'json-join',
        template,
        replication,
        [JSON.stringify(orders), JSON.stringify(customers)],
        `What is the email for order_id ${target}? Return only the email address.`,
        customers[target].email,
      );
    }
  }

  return definitions;
}

function buildAnthropicBody(task, model) {
  const messages = task.payloads.flatMap((payload, index) => {
    const toolUseId = `toolu_gate_${task.id}_${index}`;
    return [
      { role: 'user', content: `Load synthetic fixture ${task.id} part ${index + 1}.` },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: 'read_fixture', input: { part: index } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: payload }],
      },
    ];
  });
  messages.push({ role: 'assistant', content: 'The synthetic fixtures are loaded.' });
  messages.push({ role: 'user', content: task.question });
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    system: 'Answer only from the synthetic tool data. Return exactly the requested value and nothing else.',
    messages,
  };
}

function buildOpenAIChatBody(task, model) {
  const messages = [{
    role: 'system',
    content: 'Answer only from the synthetic tool data. Return exactly the requested value and nothing else.',
  }];
  for (let index = 0; index < task.payloads.length; index += 1) {
    const callId = `call_gate_${task.id}_${index}`;
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: callId,
        type: 'function',
        function: { name: 'read_fixture', arguments: JSON.stringify({ part: index }) },
      }],
    });
    messages.push({ role: 'tool', tool_call_id: callId, content: task.payloads[index] });
  }
  messages.push({ role: 'assistant', content: 'The synthetic fixtures are loaded.' });
  messages.push({ role: 'user', content: task.question });
  return {
    model,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    messages,
  };
}

function buildOpenAIResponsesBody(task, model) {
  const input = [];
  for (let index = 0; index < task.payloads.length; index += 1) {
    const callId = `call_gate_${task.id}_${index}`;
    input.push({
      type: 'function_call',
      call_id: callId,
      name: 'read_fixture',
      arguments: JSON.stringify({ part: index }),
    });
    input.push({
      type: 'function_call_output',
      call_id: callId,
      output: task.payloads[index],
    });
  }
  input.push({
    role: 'assistant',
    content: [{ type: 'output_text', text: 'The synthetic fixtures are loaded.' }],
  });
  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: task.question }],
  });
  return {
    model,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    instructions:
      'Answer only from the synthetic tool data. Return exactly the requested value and nothing else.',
    input,
  };
}

function materializeTasks(models) {
  return makeTaskDefinitions().map((task) => {
    if (task.payloads.some((payload) => payload.length < MIN_DATASET_CHARS)) {
      throw new Error(`${task.id} has a dataset below the production character floor`);
    }
    const model = task.protocol === 'anthropic-messages' ? models.anthropic : models.openai;
    const body =
      task.protocol === 'anthropic-messages'
        ? buildAnthropicBody(task, model)
        : task.protocol === 'openai-chat'
          ? buildOpenAIChatBody(task, model)
          : buildOpenAIResponsesBody(task, model);
    return { ...task, model, body };
  });
}

function normalizeAnswer(value) {
  return String(value)
    .trim()
    .replace(/^```(?:\w+)?\s*|\s*```$/g, '')
    .replace(/^[`'"\s]+|[`'".,;:\s]+$/g, '')
    .toLowerCase();
}

function answerCorrect(actual, expected) {
  return normalizeAnswer(actual) === normalizeAnswer(expected);
}

function anthropicText(data) {
  return Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
    : '';
}

function chatText(data) {
  return typeof data?.choices?.[0]?.message?.content === 'string'
    ? data.choices[0].message.content.trim()
    : '';
}

function responsesText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  const output = Array.isArray(data?.output) ? data.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function normalizedUsage(protocol, data) {
  if (protocol === 'anthropic-messages') {
    const usage = data?.usage ?? {};
    const input =
      Number(usage.input_tokens ?? 0) +
      Number(usage.cache_creation_input_tokens ?? 0) +
      Number(usage.cache_read_input_tokens ?? 0);
    return {
      input,
      cachedInput: Number(usage.cache_read_input_tokens ?? 0),
      output: Number(usage.output_tokens ?? 0),
    };
  }
  const usage = data?.usage ?? {};
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  return {
    input,
    cachedInput: Number(details.cached_tokens ?? 0),
    output: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
  };
}

function requestHeaders(protocol, keys) {
  return protocol === 'anthropic-messages'
    ? {
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        'x-api-key': keys.anthropic,
      }
    : {
        authorization: `Bearer ${keys.openai}`,
        'content-type': 'application/json',
      };
}

function endpoint(protocol) {
  if (protocol === 'anthropic-messages') return '/v1/messages';
  if (protocol === 'openai-chat') return '/v1/chat/completions';
  return '/v1/responses';
}

async function callTask({ baseUrl, task, keys, pricing, budget, label, secrets }) {
  const projectedUSD = worstCaseCost(task.body, pricing);
  budget.reserve(label, projectedUSD);
  const started = performance.now();
  const { data, headers } = await fetchProvider(
    `${baseUrl}${endpoint(task.protocol)}`,
    {
      method: 'POST',
      headers: requestHeaders(task.protocol, keys),
      body: JSON.stringify(task.body),
    },
    secrets,
  );
  const latencyMs = performance.now() - started;
  const usage = normalizedUsage(task.protocol, data);
  const costUSD = usageCost(usage, pricing);
  budget.settle(label, costUSD);
  const text =
    task.protocol === 'anthropic-messages'
      ? anthropicText(data)
      : task.protocol === 'openai-chat'
        ? chatText(data)
        : responsesText(data);
  return {
    correct: answerCorrect(text, task.expected),
    text: text.slice(0, 200),
    usage,
    costUSD,
    latencyMs,
    requestId:
      headers.get('request-id') ??
      headers.get('x-request-id') ??
      headers.get('anthropic-request-id') ??
      null,
    stopReason:
      data?.stop_reason ?? data?.choices?.[0]?.finish_reason ?? data?.status ?? null,
  };
}

function locateHeadroom() {
  const candidates = [
    process.env.PINPOINT_HEADROOM_BIN,
    join(repoRoot, '..', '.headroom-venv', 'bin', 'headroom'),
    join(homedir(), 'repos-pinpoint', '.headroom-venv', 'bin', 'headroom'),
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

async function waitForHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}/health`);
}

async function startHeadroom(secrets) {
  const port = await openPort();
  const url = `http://127.0.0.1:${port}`;
  const childEnv = { ...process.env, HEADROOM_MODE: 'cache' };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.OPENAI_API_KEY;
  const child = spawn(locateHeadroom(), ['proxy', '--port', String(port)], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + sanitize(chunk, secrets)).slice(-4_000);
  });
  try {
    await waitForHealth(url);
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`${error.message}; sidecar stderr: ${stderr.slice(-500)}`);
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
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function startRuntimes(sidecar) {
  const common = {
    host: '127.0.0.1',
    port: 0,
    upstreams: { anthropic: ANTHROPIC_ROOT, openai: OPENAI_ROOT },
    optical: { enabled: false },
    logLevel: 'silent',
  };
  const headroom = createProxyServer({
    ...common,
    virtualContext: { enabled: false },
    semantic: {
      enabled: true,
      sidecarUrl: sidecar.url,
      autoSpawn: false,
      sidecarPort: sidecar.port,
      protectRecent: 1,
      minTokensToCompress: 100,
      includeUserProse: false,
      healthTimeoutMs: 1_500,
      requestTimeoutMs: 60_000,
    },
  });
  const qcv = createProxyServer({
    ...common,
    virtualContext: {
      enabled: true,
      queryFallback: false,
      protectRecent: 1,
      minChars: MIN_DATASET_CHARS,
      maxChars: 2_000_000,
    },
    semantic: { enabled: false },
  });
  const headroomAddress = await headroom.listen();
  const qcvAddress = await qcv.listen();
  return {
    headroom,
    qcv,
    urls: {
      headroom: `http://${headroomAddress.host}:${headroomAddress.port}`,
      qcv: `http://${qcvAddress.host}:${qcvAddress.port}`,
    },
  };
}

async function stopRuntimes(runtimes) {
  await Promise.all([runtimes.headroom.close(), runtimes.qcv.close()]);
}

function reportRows(routed) {
  return routed.report.rows.map((row) => ({
    stage: row.stage,
    applied: row.applied,
    reason: row.reason,
    tokensText: row.tokensText,
    tokensCompressed: row.tokensCompressed,
  }));
}

function exactPrefetchText(value) {
  if (typeof value === 'string') {
    return value.includes('<pinpoint_exact_prefetch>') ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = exactPrefetchText(item);
      if (found) return found;
    }
    return '';
  }
  if (value == null || typeof value !== 'object') return '';
  for (const item of Object.values(value)) {
    const found = exactPrefetchText(item);
    if (found) return found;
  }
  return '';
}

async function preflight(tasks, runtimes, pricing) {
  const rows = [];
  for (const task of tasks) {
    const provider = task.protocol === 'anthropic-messages' ? 'anthropic' : 'openai';
    const [headroom, qcv] = await Promise.all([
      runtimes.headroom.pinpoint.route(
        provider,
        task.model,
        structuredClone(task.body),
        'payg',
      ),
      runtimes.qcv.pinpoint.route(
        provider,
        task.model,
        structuredClone(task.body),
        'payg',
      ),
    ]);
    const rawBytes = Buffer.byteLength(JSON.stringify(task.body));
    const headroomBytes = Buffer.byteLength(JSON.stringify(headroom.body));
    const qcvSerialized = JSON.stringify(qcv.body);
    const prefetchText = exactPrefetchText(qcv.body);
    const qcvBytes = Buffer.byteLength(qcvSerialized);
    rows.push({
      id: task.id,
      templateId: task.templateId,
      replication: task.replication,
      category: task.category,
      protocol: task.protocol,
      model: task.model,
      fixtureSha256: task.fixtureSha256,
      datasetChars: task.payloads.reduce((total, payload) => total + payload.length, 0),
      rawBytes,
      headroomBytes,
      qcvBytes,
      headroomApplied: headroom.report.rows.some(
        (row) => row.stage === 'semantic' && row.applied,
      ),
      qcvApplied: qcv.report.rows.some((row) => row.stage === 'virtual' && row.applied),
      qcvMaterializedExpected: prefetchText
        .toLowerCase()
        .includes(String(task.expected).toLowerCase()),
      qcvFallbackInjected: qcvSerialized.includes('pinpoint_query'),
      headroomReport: reportRows(headroom),
      qcvReport: reportRows(qcv),
      projectedWorstCaseUSD: worstCaseCost(task.body, pricing[task.protocol]) * 3,
    });
  }
  return rows;
}

function gitMetadata() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().length > 0,
    };
  } catch {
    return { commit: null, dirty: null };
  }
}

function implementationFingerprint() {
  const files = [];
  const collect = (path) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) collect(join(path, name));
    } else {
      files.push(path);
    }
  };
  collect(join(repoRoot, 'src'));
  files.push(fileURLToPath(import.meta.url), join(repoRoot, 'package.json'));
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(path.slice(repoRoot.length));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function environmentMetadata() {
  return {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    git: gitMetadata(),
    implementationSha256: implementationFingerprint(),
  };
}

function writeArtifact(filename, value, secrets) {
  mkdirSync(resultsDir, { recursive: true });
  const serialized = JSON.stringify(value, null, 2);
  if (
    secrets.some((secret) => secret && serialized.includes(secret)) ||
    /sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+/.test(serialized)
  ) {
    throw new Error('refusing to persist an artifact containing an API key');
  }
  const path = join(resultsDir, filename);
  writeFileSync(path, `${serialized}\n`, { mode: 0o600 });
  return path;
}

function publicTask(task) {
  return {
    id: task.id,
    templateId: task.templateId,
    replication: task.replication,
    category: task.category,
    protocol: task.protocol,
    model: task.model,
    expected: task.expected,
    fixtureSha256: task.fixtureSha256,
    datasetChars: task.payloads.reduce((total, payload) => total + payload.length, 0),
  };
}

function summarizeArm(runs, arm) {
  const results = runs.map((run) => run.results[arm]);
  const correct = results.filter((result) => result.correct).length;
  const inputTokens = results.reduce((total, result) => total + result.usage.input, 0);
  const outputTokens = results.reduce((total, result) => total + result.usage.output, 0);
  const costUSD = results.reduce((total, result) => total + result.costUSD, 0);
  const latencies = results.map((result) => result.latencyMs);
  return {
    observations: results.length,
    correct,
    accuracy: results.length > 0 ? correct / results.length : 0,
    accuracy95: wilsonInterval(correct, results.length),
    inputTokens,
    outputTokens,
    costUSD,
    latencyMs: {
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
  };
}

function compareArms(runs, baselineArm, seedOffset) {
  const harms = runs.filter(
    (run) => run.results[baselineArm].correct && !run.results.qcv.correct,
  ).length;
  const improvements = runs.filter(
    (run) => !run.results[baselineArm].correct && run.results.qcv.correct,
  ).length;
  const total = runs.length;
  const baselineCorrect = runs.filter((run) => run.results[baselineArm].correct).length;
  const qcvCorrect = runs.filter((run) => run.results.qcv.correct).length;
  const baselineCost = runs.reduce(
    (sum, run) => sum + run.results[baselineArm].costUSD,
    0,
  );
  const qcvCost = runs.reduce((sum, run) => sum + run.results.qcv.costUSD, 0);
  const baselineInput = runs.reduce(
    (sum, run) => sum + run.results[baselineArm].usage.input,
    0,
  );
  const qcvInput = runs.reduce((sum, run) => sum + run.results.qcv.usage.input, 0);
  const accuracyDelta = total > 0 ? (qcvCorrect - baselineCorrect) / total : 0;
  const costReduction = baselineCost > 0 ? 1 - qcvCost / baselineCost : 0;
  const inputReduction = baselineInput > 0 ? 1 - qcvInput / baselineInput : 0;
  return {
    baselineArm,
    observations: total,
    harms,
    improvements,
    harmRate: total > 0 ? harms / total : 1,
    harmRateOneSided95Upper: clopperPearsonUpper(harms, total),
    accuracyDelta,
    accuracyDelta95: pairedBootstrap(
      runs,
      (run) => Number(run.results[baselineArm].correct),
      (run) => Number(run.results.qcv.correct),
      (baseline, qcv, count) => (qcv - baseline) / count,
      SEED + seedOffset,
    ),
    costReduction,
    costReduction95: pairedBootstrap(
      runs,
      (run) => run.results[baselineArm].costUSD,
      (run) => run.results.qcv.costUSD,
      (baseline, qcv) => (baseline > 0 ? 1 - qcv / baseline : 0),
      SEED + seedOffset + 1,
    ),
    inputReduction,
    inputReduction95: pairedBootstrap(
      runs,
      (run) => run.results[baselineArm].usage.input,
      (run) => run.results.qcv.usage.input,
      (baseline, qcv) => (baseline > 0 ? 1 - qcv / baseline : 0),
      SEED + seedOffset + 2,
    ),
  };
}

function summarizeByCell(runs) {
  const cells = [...new Set(runs.map((run) => `${run.protocol}:${run.model}`))];
  return Object.fromEntries(
    cells.map((cell) => {
      const rows = runs.filter((run) => `${run.protocol}:${run.model}` === cell);
      return [cell, {
        observations: rows.length,
        raw: summarizeArm(rows, 'raw'),
        headroom: summarizeArm(rows, 'headroom'),
        qcv: summarizeArm(rows, 'qcv'),
      }];
    }),
  );
}

function finalArtifact({ models, pricing, tasks, preflightRows, runs, budget, status, error }) {
  const summary = runs.length > 0
    ? {
        arms: {
          raw: summarizeArm(runs, 'raw'),
          headroom: summarizeArm(runs, 'headroom'),
          qcv: summarizeArm(runs, 'qcv'),
        },
        comparisons: {
          qcvVsRaw: compareArms(runs, 'raw', 101),
          qcvVsHeadroom: compareArms(runs, 'headroom', 211),
        },
        cells: summarizeByCell(runs),
      }
    : undefined;
  const armPermutations = new Set(runs.map((run) => run.order.join('>'))).size;
  const completedPerTask = Object.fromEntries(
    tasks.map((task) => [task.id, runs.filter((run) => run.id === task.id).length]),
  );
  const templateIds = [...new Set(tasks.map((task) => task.templateId))];
  const completedPerTemplate = Object.fromEntries(
    templateIds.map((templateId) => [
      templateId,
      runs.filter((run) => run.templateId === templateId).length,
    ]),
  );
  const fixtureHashes = new Set(tasks.map((task) => task.fixtureSha256));
  const gates = summary
    ? {
        atLeastThirtyTaskTemplates: templateIds.length >= 30,
        fiveIndependentVariantsPerTemplate: Object.values(completedPerTemplate).every(
          (count) => count === REPETITIONS && REPETITIONS >= 5,
        ),
        everyFixtureVariantUnique: fixtureHashes.size === tasks.length,
        randomizedArmOrder: armPermutations >= 4,
        multipleModels: new Set(tasks.map((task) => task.model)).size >= 2,
        threeProtocols: new Set(tasks.map((task) => task.protocol)).size >= 3,
        allQcvPreflightsExact: preflightRows.every(
          (row) => row.qcvApplied && row.qcvMaterializedExpected && !row.qcvFallbackInjected,
        ),
        qcvAccuracyAtLeast98Percent: summary.arms.qcv.accuracy >= 0.98,
        qcvVsRawNonInferiorWithin2pp:
          summary.comparisons.qcvVsRaw.harmRateOneSided95Upper < 0.02,
        qcvVsHeadroomNonInferiorWithin2pp:
          summary.comparisons.qcvVsHeadroom.harmRateOneSided95Upper < 0.02,
        qcvBeatsHeadroomCostBy25Percent:
          summary.comparisons.qcvVsHeadroom.costReduction >= 0.25,
        qcvHeadroomCostReduction95LowerAbove25Percent:
          summary.comparisons.qcvVsHeadroom.costReduction95.low >= 0.25,
        noRetries: true,
        withinSpendCap: budget.observedUSD <= budget.maxUSD,
        complete: runs.length === tasks.length,
      }
    : undefined;
  return {
    schemaVersion: 1,
    evidenceLevel: EVIDENCE.LIVE_CONTROLLED,
    kind: 'multi-provider-repeated-qcv-evidence-gate',
    status,
    generatedAt: new Date().toISOString(),
    environment: environmentMetadata(),
    models,
    pricing,
    methodology: {
      logicalTasks: templateIds.length,
      independentlyParameterizedTasks: tasks.length,
      categories: [...new Set(tasks.map((task) => task.category))],
      protocols: [...new Set(tasks.map((task) => task.protocol))],
      repetitions: REPETITIONS,
      replicationDesign:
        'Each template repetition uses a distinct payload, expected answer, fixture hash, and task id; no identical prompt is repeated.',
      inferenceUnit:
        'One independently parameterized structured-task variant. The exact harm bound assumes these fixed variants are exchangeable benchmark units.',
      pairedObservationsPlanned: tasks.length,
      arms: ['raw', 'headroom', 'qcv'],
      randomizedTaskAndArmOrder: true,
      seed: SEED,
      retries: 0,
      qualityGate:
        'Exact paired harm probability: one-sided 95% Clopper-Pearson upper bound below 2 percentage points.',
      costGate:
        'QCV total modeled provider cost at least 25% below Headroom-only, with paired-bootstrap 95% lower bound also at least 25%.',
      bootstrapSamples: BOOTSTRAP_SAMPLES,
      headroom:
        'Pinpoint runtime with QCV and optical disabled; semantic tool-result compression delegated to the local Headroom sidecar.',
      qcv:
        'Pinpoint deterministic exact prefetch enabled; model-driven fallback, semantic compression, and optical compression disabled.',
      limitation:
        'Synthetic controlled structured-task variants from six operation families. The inferential bound applies to this fixed benchmark population and its exchangeability assumption, not organic production traffic or external adoption.',
    },
    budget: budget.snapshot(),
    tasks: tasks.map(publicTask),
    preflight: preflightRows,
    progress: {
      completedPairedObservations: runs.length,
      plannedPairedObservations: tasks.length,
      armPermutationsObserved: armPermutations,
      completedPerTask,
      completedPerTemplate,
    },
    summary,
    gates,
    verdict: gates ? Object.values(gates).every(Boolean) : false,
    error: error ?? null,
    runs,
  };
}

async function resolveModels(keys, secrets) {
  const [anthropicIds, openaiIds] = await Promise.all([
    listAnthropicModels(keys.anthropic, secrets),
    listOpenAIModels(keys.openai, secrets),
  ]);
  return {
    anthropic: chooseModel(
      anthropicIds,
      process.env.BENCH_ANTHROPIC_MODEL,
      [
        (id) => id === 'claude-haiku-4-5',
        (id) => id.startsWith('claude-haiku-4-5-'),
      ],
      'Anthropic',
    ),
    openai: chooseModel(
      openaiIds,
      process.env.BENCH_OPENAI_MODEL,
      [
        (id) => id === 'gpt-4.1-mini',
        (id) => id.startsWith('gpt-4.1-mini-'),
        (id) => id === 'gpt-4o-mini',
        (id) => id.startsWith('gpt-4o-mini-'),
        (id) => id === 'gpt-5-mini',
      ],
      'OpenAI',
    ),
  };
}

async function runCanary({ keys, secrets, models, pricing, tasks, runtimes }) {
  if (!ALLOW_PAID) throw new Error('canary requires BENCH_ALLOW_PAID=1');
  const selected = [
    tasks.find((task) => task.protocol === 'anthropic-messages' && task.category === 'json-lookup'),
    tasks.find((task) => task.protocol === 'openai-chat' && task.category === 'json-lookup'),
    tasks.find((task) => task.protocol === 'openai-responses' && task.category === 'json-lookup'),
  ];
  if (selected.some((task) => task == null)) throw new Error('canary task matrix is incomplete');
  const budget = new Budget(MAX_USD, MAX_REQUESTS);
  const results = [];
  for (const task of selected) {
    const result = await callTask({
      baseUrl: runtimes.urls.qcv,
      task,
      keys,
      pricing: pricing[task.protocol],
      budget,
      label: `canary:${task.protocol}`,
      secrets,
    });
    results.push({ protocol: task.protocol, model: task.model, id: task.id, result });
    console.log(
      `canary ${task.protocol}: correct=${result.correct} input=${result.usage.input} ` +
        `cost=$${result.costUSD.toFixed(6)} latency=${result.latencyMs.toFixed(0)}ms`,
    );
  }
  const artifact = {
    schemaVersion: 1,
    evidenceLevel: EVIDENCE.LIVE_CONTROLLED,
    kind: 'multi-provider-qcv-canary',
    generatedAt: new Date().toISOString(),
    environment: environmentMetadata(),
    models,
    pricing,
    budget: budget.snapshot(),
    results,
    verdict: results.every(({ result }) => result.correct),
  };
  const path = writeArtifact(artifactName('evidence-gate-canary.json'), artifact, secrets);
  console.log(`artifact: ${path}`);
  if (!artifact.verdict) throw new Error('canary correctness failed');
}

async function runBenchmark({ keys, secrets, models, pricing, tasks, runtimes, preflightRows }) {
  if (!ALLOW_PAID) throw new Error('benchmark requires BENCH_ALLOW_PAID=1');
  if (!ARTIFACT_LABEL) {
    throw new Error('paid benchmark requires BENCH_ARTIFACT_LABEL to preserve prior receipts');
  }
  const plannedRequests = tasks.length * 3;
  const projectedUSD = preflightRows.reduce(
    (sum, row) => sum + row.projectedWorstCaseUSD,
    0,
  );
  if (plannedRequests > MAX_REQUESTS) {
    throw new Error(`${plannedRequests} planned calls exceed BENCH_MAX_REQUESTS=${MAX_REQUESTS}`);
  }
  if (projectedUSD > MAX_USD + Number.EPSILON) {
    throw new Error(
      `conservative projection $${projectedUSD.toFixed(6)} exceeds BENCH_MAX_USD=$${MAX_USD}`,
    );
  }
  if (
    preflightRows.some(
      (row) => !row.qcvApplied || !row.qcvMaterializedExpected || row.qcvFallbackInjected,
    )
  ) {
    throw new Error('QCV preflight failed exact deterministic applicability');
  }

  const budget = new Budget(MAX_USD, MAX_REQUESTS);
  const random = seededRandom(SEED);
  const observations = shuffled(tasks, random);
  const runs = [];
  const filename = artifactName('evidence-gate.json');
  try {
    for (const task of observations) {
      const order = shuffled(['raw', 'headroom', 'qcv'], random);
      const results = {};
      for (const arm of order) {
        const baseUrl =
          arm === 'raw'
            ? task.protocol === 'anthropic-messages'
              ? ANTHROPIC_ROOT
              : OPENAI_ROOT
            : runtimes.urls[arm];
        results[arm] = await callTask({
          baseUrl,
          task,
          keys,
          pricing: pricing[task.protocol],
          budget,
          label: `${task.id}:${arm}`,
          secrets,
        });
      }
      runs.push({
        id: task.id,
        templateId: task.templateId,
        category: task.category,
        protocol: task.protocol,
        model: task.model,
        replication: task.replication,
        order,
        results,
      });
      if (runs.length % 5 === 0 || runs.length === observations.length) {
        const correct = runs.filter((run) => run.results.qcv.correct).length;
        console.log(
          `progress ${runs.length}/${observations.length} paired observations; ` +
            `qcv-correct=${correct}/${runs.length}; spend=$${budget.observedUSD.toFixed(4)}`,
        );
        writeArtifact(
          filename,
          finalArtifact({
            models,
            pricing,
            tasks,
            preflightRows,
            runs,
            budget,
            status: 'running',
          }),
          secrets,
        );
      }
    }
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : error, secrets);
    writeArtifact(
      filename,
      finalArtifact({
        models,
        pricing,
        tasks,
        preflightRows,
        runs,
        budget,
        status: 'aborted',
        error: message,
      }),
      secrets,
    );
    throw error;
  }

  const artifact = finalArtifact({
    models,
    pricing,
    tasks,
    preflightRows,
    runs,
    budget,
    status: 'complete',
  });
  const path = writeArtifact(filename, artifact, secrets);
  const comparison = artifact.summary.comparisons.qcvVsHeadroom;
  console.log(
    `quality qcv=${artifact.summary.arms.qcv.correct}/${runs.length}; ` +
      `harm95(raw)=${(artifact.summary.comparisons.qcvVsRaw.harmRateOneSided95Upper * 100).toFixed(2)}%; ` +
      `harm95(headroom)=${(comparison.harmRateOneSided95Upper * 100).toFixed(2)}%`,
  );
  console.log(
    `qcv vs headroom cost reduction=${(comparison.costReduction * 100).toFixed(1)}% ` +
      `(95% CI ${(comparison.costReduction95.low * 100).toFixed(1)}% to ` +
      `${(comparison.costReduction95.high * 100).toFixed(1)}%); verdict=${artifact.verdict}`,
  );
  console.log(`artifact: ${path}`);
  if (!artifact.verdict) throw new Error('evidence gate completed but did not pass');
}

function runSelfTest() {
  const tasks = makeTaskDefinitions();
  if (tasks.length !== 30 * REPETITIONS) {
    throw new Error(`self-test: expected ${30 * REPETITIONS} variants, got ${tasks.length}`);
  }
  const templateIds = [...new Set(tasks.map((task) => task.templateId))];
  if (templateIds.length !== 30) {
    throw new Error(`self-test: expected 30 templates, got ${templateIds.length}`);
  }
  if (
    templateIds.some(
      (templateId) => tasks.filter((task) => task.templateId === templateId).length !== REPETITIONS,
    )
  ) {
    throw new Error('self-test: each template must have exactly BENCH_REPS variants');
  }
  if (new Set(tasks.map((task) => task.fixtureSha256)).size !== tasks.length) {
    throw new Error('self-test: every task variant must have a unique fixture hash');
  }
  if (new Set(tasks.map((task) => task.category)).size !== 6) {
    throw new Error('self-test: expected six task categories');
  }
  const protocolCounts = Object.fromEntries(
    ['anthropic-messages', 'openai-chat', 'openai-responses'].map((protocol) => [
      protocol,
      tasks.filter((task) => task.protocol === protocol).length,
    ]),
  );
  if (Object.values(protocolCounts).some((count) => count !== tasks.length / 3)) {
    throw new Error(`self-test: protocol matrix is unbalanced: ${JSON.stringify(protocolCounts)}`);
  }
  const upper = clopperPearsonUpper(0, 150);
  if (!(upper < 0.02 && upper > 0.019)) {
    throw new Error(`self-test: expected 0/150 one-sided bound near 1.98%, got ${upper}`);
  }
  const fakeSecrets = [
    ['sk', 'ant', 'fake-secret'].join('-'),
    ['sk', 'proj', 'fake-secret'].join('-'),
  ];
  const scrubbed = sanitize(fakeSecrets.join(' '), fakeSecrets);
  if (fakeSecrets.some((secret) => scrubbed.includes(secret))) {
    throw new Error('self-test: credential sanitization failed');
  }
  const budget = new Budget(0.001, 1);
  budget.reserve('first', 0.0005);
  budget.settle('first', 0.0004);
  let rejected = false;
  try {
    budget.reserve('second', 0.0001);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('self-test: request cap was not enforced');
  console.log(
    `evidence gate self-test: ok (30 templates x ${REPETITIONS} unique variants, ` +
      `6 categories, 3 protocols, ` +
      `0/150 harm upper=${(upper * 100).toFixed(3)}%)`,
  );
}

async function main() {
  if (PHASE === 'self-test') {
    runSelfTest();
    return;
  }
  if (!['preflight', 'canary', 'benchmark'].includes(PHASE)) {
    throw new Error('--phase must be self-test, preflight, canary, or benchmark');
  }
  const keys = requireKeys();
  const secrets = [keys.anthropic, keys.openai];
  const models = await resolveModels(keys, secrets);
  const pricing = {
    'anthropic-messages': pricingFor('anthropic', models.anthropic),
    'openai-chat': pricingFor('openai', models.openai),
    'openai-responses': pricingFor('openai', models.openai),
  };
  const tasks = materializeTasks(models);
  console.log(
    `phase=${PHASE}; anthropic=${models.anthropic}; openai=${models.openai}; ` +
      `templates=30; variants=${tasks.length}; reps=${REPETITIONS}; cap=$${MAX_USD.toFixed(2)}; ` +
      `request-cap=${MAX_REQUESTS}`,
  );

  const sidecar = await startHeadroom(secrets);
  let runtimes;
  try {
    runtimes = await startRuntimes(sidecar);
    const preflightRows = await preflight(tasks, runtimes, pricing);
    const projectedUSD = preflightRows.reduce(
      (sum, row) => sum + row.projectedWorstCaseUSD,
      0,
    );
    const preflightArtifact = {
      schemaVersion: 1,
      evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
      kind: 'multi-provider-evidence-gate-preflight',
      generatedAt: new Date().toISOString(),
      environment: environmentMetadata(),
      models,
      pricing,
      plannedRequests: tasks.length * 3,
      projectedWorstCaseUSD: projectedUSD,
      capUSD: MAX_USD,
      rows: preflightRows,
      verdict: preflightRows.every(
        (row) => row.qcvApplied && row.qcvMaterializedExpected && !row.qcvFallbackInjected,
      ),
    };
    const preflightPath = writeArtifact(
      artifactName('evidence-gate-preflight.json'),
      preflightArtifact,
      secrets,
    );
    console.log(
      `preflight: qcv=${preflightRows.filter((row) => row.qcvApplied).length}/${tasks.length}; ` +
        `headroom=${preflightRows.filter((row) => row.headroomApplied).length}/${tasks.length}; ` +
        `projection=$${projectedUSD.toFixed(4)}; artifact=${preflightPath}`,
    );
    if (!preflightArtifact.verdict) throw new Error('preflight exact applicability failed');
    if (PHASE === 'preflight') return;
    if (PHASE === 'canary') {
      await runCanary({ keys, secrets, models, pricing, tasks, runtimes });
    } else {
      await runBenchmark({
        keys,
        secrets,
        models,
        pricing,
        tasks,
        runtimes,
        preflightRows,
      });
    }
  } finally {
    if (runtimes) await stopRuntimes(runtimes);
    await stopChild(sidecar.child);
  }
}

main().catch((error) => {
  console.error(`evidence gate aborted: ${sanitize(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});