import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPinpoint } from '../../dist/pinpoint.js';
import { createProxyServer } from '../../dist/proxy/server.js';
import { readCaptureFile } from '../../dist/capture/store.js';
import { replayCaptureFile } from '../../dist/capture/replay.js';
import { EVIDENCE } from '../evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');
const tracesDir = join(here, '..', 'traces', 'agent-gate');
const PHASE = readOption('--phase') ?? process.env.BENCH_PHASE ?? 'canary';
const LABEL = artifactLabel(process.env.BENCH_ARTIFACT_LABEL);
const ANTHROPIC_MODEL = process.env.BENCH_ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = process.env.BENCH_OPENAI_MODEL ?? 'gpt-4.1-mini';
const MAX_USD = readNumber('BENCH_MAX_USD', PHASE === 'canary' ? 0.5 : 3);
const MAX_REQUESTS = readInteger('BENCH_MAX_REQUESTS', PHASE === 'canary' ? 12 : 60);
const MAX_REQUESTS_PER_SESSION = readInteger('BENCH_MAX_REQUESTS_PER_SESSION', 8);
const TIMEOUT_MS = readInteger('BENCH_TIMEOUT_MS', 180_000);
const MIN_CHARS = 6_000;
const PRICING = {
  anthropic: { input: 1, output: 5 },
  openai: { input: 0.4, output: 1.6 },
};

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
    throw new Error('BENCH_ARTIFACT_LABEL has an invalid format');
  }
  return normalized;
}

function requireKeys() {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!anthropic || !openai) throw new Error('ANTHROPIC_API_KEY and OPENAI_API_KEY are required');
  return { anthropic, openai };
}

function sanitize(value, secrets, workspace = '') {
  let text = String(value);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  if (workspace) text = text.split(workspace).join('/workspace');
  const home = process.env.HOME;
  if (home) text = text.split(home).join('/home/evidence');
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

class ExposureBudget {
  constructor(maxUSD, maxRequests) {
    this.maxUSD = maxUSD;
    this.maxRequests = maxRequests;
    this.providerRequests = 0;
    this.conservativeExposureUSD = 0;
  }

  reserve(provider, bodyBytes) {
    if (this.providerRequests + 1 > this.maxRequests) {
      throw new Error(`provider request cap reached (${this.maxRequests})`);
    }
    const pricing = PRICING[provider];
    const projectedUSD = (bodyBytes * pricing.input + 4_096 * pricing.output) / 1_000_000;
    if (this.conservativeExposureUSD + projectedUSD > this.maxUSD + Number.EPSILON) {
      throw new Error(
        `trace exposure cap would be exceeded: ` +
          `$${(this.conservativeExposureUSD + projectedUSD).toFixed(6)} > $${this.maxUSD.toFixed(6)}`,
      );
    }
    this.providerRequests += 1;
    this.conservativeExposureUSD += projectedUSD;
  }

  snapshot() {
    return {
      maxUSD: this.maxUSD,
      maxRequests: this.maxRequests,
      providerRequests: this.providerRequests,
      conservativeExposureUSD: this.conservativeExposureUSD,
    };
  }
}

function taskDefinitions() {
  return ['claude', 'codex'].flatMap((agent) =>
    Array.from({ length: 5 }, (_, index) => {
      const join = index >= 3;
      const target = 31 + index * 17;
      return {
        id: `${agent}-${join ? 'join' : 'lookup'}-${index + 1}`,
        agent,
        index,
        join,
        target,
        injectRetry: index === 2,
        expected: join
          ? `joined-${agent}-${index}-${target}@example.com`
          : `lookup-${agent}-${index}-${target}@example.com`,
      };
    }),
  );
}

function fixtureFiles(task) {
  if (!task.join) {
    return {
      'dataset.json': JSON.stringify(
        Array.from({ length: 180 }, (_, id) => ({
          id,
          email: `lookup-${task.agent}-${task.index}-${id}@example.com`,
          status: id % 3 === 0 ? 'review' : 'active',
          notes: `synthetic ${task.agent} lookup row ${id} `.repeat(4),
        })),
      ),
    };
  }
  return {
    'orders.json': JSON.stringify(
      Array.from({ length: 180 }, (_, orderId) => ({
        order_id: orderId,
        customer_id: orderId + 10_000 + task.index * 1_000,
        status: orderId % 2 === 0 ? 'open' : 'closed',
        notes: `synthetic ${task.agent} order ${orderId} `.repeat(4),
      })),
    ),
    'customers.json': JSON.stringify(
      Array.from({ length: 180 }, (_, customerIndex) => ({
        customer_id: customerIndex + 10_000 + task.index * 1_000,
        email: `joined-${task.agent}-${task.index}-${customerIndex}@example.com`,
        tier: customerIndex % 3 === 0 ? 'pro' : 'basic',
        notes: `synthetic ${task.agent} customer ${customerIndex} `.repeat(4),
      })),
    ),
  };
}

function prepareWorkspace(task) {
  const workspace = mkdtempSync(join(tmpdir(), `pinpoint-agent-trace-${task.id}-`));
  for (const [name, content] of Object.entries(fixtureFiles(task))) {
    if (content.length < MIN_CHARS) throw new Error(`${task.id}/${name} is too small`);
    writeFileSync(join(workspace, name), `${content}\n`);
  }
  writeFileSync(join(workspace, 'README.md'), '# Synthetic evidence workspace\n');
  return workspace;
}

function promptFor(task, workspace) {
  if (task.join) {
    return (
      'You must use your file-reading or shell tools before answering. Read these files in full: ' +
      `${join(workspace, 'orders.json')} and ${join(workspace, 'customers.json')}. ` +
      `What is the email for order_id ${task.target}? Return only the email address.`
    );
  }
  return (
    'You must use your file-reading or shell tools before answering. Read this file in full: ' +
    `${join(workspace, 'dataset.json')}. ` +
    `What is the email for id ${task.target}? Return only the email address.`
  );
}

function spawnAgent(task, workspace, proxyUrl, keys, secrets) {
  const commonEnv = { ...process.env, CI: '1', NO_COLOR: '1', TERM: 'dumb' };
  delete commonEnv.COPILOT_AGENT;
  delete commonEnv.COPILOT_DEBUG_NONCE;
  const prompt = promptFor(task, workspace);
  const debugFile = join(workspace, 'agent-debug.log');
  const command = task.agent === 'claude' ? 'claude' : 'codex';
  const args = task.agent === 'claude'
    ? [
        '--bare', '--print', prompt,
        '--model', ANTHROPIC_MODEL,
        '--max-budget-usd', '0.20',
        '--output-format', 'json',
        '--no-session-persistence',
        '--debug-file', debugFile,
        '--allowedTools', 'Read',
      ]
    : [
        'exec', '--cd', workspace,
        '--sandbox', 'read-only',
        '--skip-git-repo-check',
        '--model', OPENAI_MODEL,
        '--json', prompt,
      ];
  const env = task.agent === 'claude'
    ? {
        ...commonEnv,
        ANTHROPIC_API_KEY: keys.anthropic,
        ANTHROPIC_BASE_URL: proxyUrl,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      }
    : {
        ...commonEnv,
        OPENAI_API_KEY: keys.openai,
        OPENAI_BASE_URL: `${proxyUrl}/v1`,
      };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + sanitize(chunk, secrets, workspace)).slice(-2_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + sanitize(chunk, secrets, workspace)).slice(-200_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`;
      resolve({
        code: code ?? 1,
        signal,
        correct: output.toLowerCase().includes(task.expected.toLowerCase()),
        outputSha256: sha256(output),
        outputTail: output.slice(-1_000),
        stderrTail: stderr.slice(-500),
        debugTail: task.agent === 'claude' && existsSync(debugFile)
          ? sanitize(readFileSync(debugFile, 'utf8').slice(-2_000), secrets, workspace)
          : '',
      });
    });
  });
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function startForwarder(provider, injectRetry, budget) {
  let failurePending = injectRetry;
  let requests = 0;
  let injectedFailures = 0;
  const errors = [];
  const server = http.createServer((request, response) => {
    void readRequest(request).then(async (body) => {
      requests += 1;
      if (requests > MAX_REQUESTS_PER_SESSION) {
        response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        response.end(JSON.stringify({ error: { message: 'trace request cap reached' } }));
        return;
      }
      if (failurePending) {
        failurePending = false;
        injectedFailures += 1;
        response.writeHead(provider === 'anthropic' ? 529 : 429, {
          'content-type': 'application/json',
          'retry-after': '0',
        });
        response.end(JSON.stringify({
          type: 'error',
          error: { type: 'overloaded_error', message: 'injected trace retry' },
        }));
        return;
      }
      budget.reserve(provider, body.length);
      const root = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com';
      const headers = new Headers();
      const skippedHeaders = new Set([
        'connection',
        'content-length',
        'host',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
      ]);
      for (const [name, value] of Object.entries(request.headers)) {
        if (skippedHeaders.has(name) || value == null) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const upstream = await fetch(`${root}${request.url}`, {
        method: request.method,
        headers,
        body,
      });
      const payload = Buffer.from(await upstream.arrayBuffer());
      const responseHeaders = {};
      for (const [name, value] of upstream.headers) {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(name)) {
          responseHeaders[name] = value;
        }
      }
      response.writeHead(upstream.status, responseHeaders);
      response.end(payload);
    }).catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    stats: () => ({ requests, injectedFailures, errors }),
    close: () => new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  };
}

function hasAppliedQcv(record) {
  return record.report?.rows?.some((row) => row.stage === 'virtual' && row.applied) ?? false;
}

function structuralDiagnostics(records) {
  const rows = records.map((record) => {
    const body = record.originalBody ?? {};
    const strings = [];
    const pending = [body];
    while (pending.length > 0) {
      const value = pending.pop();
      if (typeof value === 'string') strings.push(value.length);
      else if (Array.isArray(value)) pending.push(...value);
      else if (value != null && typeof value === 'object') pending.push(...Object.values(value));
    }
    return {
      provider: record.provider,
      maxStringChars: Math.max(0, ...strings),
      virtual: record.report?.rows
        ?.filter((row) => row.stage === 'virtual')
        .map((row) => ({ applied: row.applied, reason: row.reason })) ?? [],
    };
  });
  return { records: records.length, rows };
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => ['text', 'input_text'].includes(block?.type) && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function sanitizeAnthropicBody(body, secrets, workspace) {
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = [];
  for (const message of sourceMessages) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'tool_result' || typeof block.content !== 'string') continue;
      if (block.content.length < MIN_CHARS) continue;
      const id = `toolu_sanitized_${messages.length}`;
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'read_fixture', input: {} }],
      });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: id,
          content: sanitize(block.content, secrets, workspace),
        }],
      });
    }
  }
  const question = [...sourceMessages]
    .reverse()
    .filter((message) => message?.role === 'user')
    .map((message) => textContent(message.content))
    .find(Boolean) ?? '';
  messages.push({ role: 'assistant', content: 'The synthetic fixtures are loaded.' });
  messages.push({ role: 'user', content: sanitize(question, secrets, workspace) });
  return { model: body.model ?? ANTHROPIC_MODEL, max_tokens: 32, stream: false, messages };
}

function sanitizeResponsesBody(body, secrets, workspace) {
  const sourceInput = Array.isArray(body.input) ? body.input : [];
  const input = [];
  for (const item of sourceInput) {
    if (item?.type !== 'function_call_output' || typeof item.output !== 'string') continue;
    if (item.output.length < MIN_CHARS) continue;
    const callId = `call_sanitized_${input.length}`;
    input.push({ type: 'function_call', call_id: callId, name: 'read_fixture', arguments: '{}' });
    input.push({
      type: 'function_call_output',
      call_id: callId,
      output: sanitize(item.output, secrets, workspace),
    });
  }
  const latestUser = [...sourceInput].reverse().find((item) => item?.role === 'user');
  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: sanitize(textContent(latestUser?.content), secrets, workspace) }],
  });
  return { model: body.model ?? OPENAI_MODEL, max_output_tokens: 32, stream: false, input };
}

function sanitizeChatBody(body, secrets, workspace) {
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = [];
  for (const message of sourceMessages) {
    if (message?.role !== 'tool' || typeof message.content !== 'string') continue;
    if (message.content.length < MIN_CHARS) continue;
    const callId = `call_sanitized_${messages.length}`;
    messages.push({
      role: 'assistant', content: null,
      tool_calls: [{ id: callId, type: 'function', function: { name: 'read_fixture', arguments: '{}' } }],
    });
    messages.push({
      role: 'tool', tool_call_id: callId,
      content: sanitize(message.content, secrets, workspace),
    });
  }
  const latestUser = [...sourceMessages].reverse().find((message) => message?.role === 'user');
  messages.push({ role: 'user', content: sanitize(textContent(latestUser?.content), secrets, workspace) });
  return { model: body.model ?? OPENAI_MODEL, max_completion_tokens: 32, stream: false, messages };
}

function sanitizedBody(record, secrets, workspace) {
  if (!record.originalBody) throw new Error('source capture omitted request body');
  if (record.provider === 'anthropic') {
    return sanitizeAnthropicBody(record.originalBody, secrets, workspace);
  }
  return Array.isArray(record.originalBody.input)
    ? sanitizeResponsesBody(record.originalBody, secrets, workspace)
    : sanitizeChatBody(record.originalBody, secrets, workspace);
}

function stablePrefixObserved(records) {
  const bodies = records.map((record) => record.originalBody).filter(Boolean);
  for (let index = 0; index < bodies.length - 1; index += 1) {
    const first = Array.isArray(bodies[index].messages)
      ? bodies[index].messages
      : Array.isArray(bodies[index].input) ? bodies[index].input : [];
    const second = Array.isArray(bodies[index + 1].messages)
      ? bodies[index + 1].messages
      : Array.isArray(bodies[index + 1].input) ? bodies[index + 1].input : [];
    if (first.length > 0 && second.length >= first.length) {
      if (JSON.stringify(first) === JSON.stringify(second.slice(0, first.length))) return true;
    }
  }
  return false;
}

async function createSanitizedTrace(task, sourceRecord, secrets, workspace) {
  mkdirSync(tracesDir, { recursive: true, mode: 0o700 });
  const tracePath = join(tracesDir, `${task.id}.jsonl`);
  rmSync(tracePath, { force: true });
  const body = sanitizedBody(sourceRecord, secrets, workspace);
  const config = {
    capture: { path: tracePath, includeBodies: true, fsync: true },
    virtualContext: { enabled: true, queryFallback: false, minChars: MIN_CHARS, protectRecent: 0 },
    semantic: { enabled: false },
    optical: { enabled: false },
    logLevel: 'silent',
  };
  const runtime = createPinpoint(config);
  const routed = await runtime.route(
    sourceRecord.provider,
    String(sourceRecord.model ?? body.model),
    body,
    'payg',
  );
  await runtime.shutdown();
  if (!routed.virtualized) throw new Error(`${task.id}: sanitized trace did not virtualize`);
  const replay = await replayCaptureFile(tracePath, { ...config, capture: { path: '' } });
  const serialized = readFileSync(tracePath, 'utf8');
  const home = process.env.HOME ?? '';
  if (
    secrets.some((secret) => serialized.includes(secret)) ||
    serialized.includes(workspace) ||
    (home && serialized.includes(home)) ||
    /sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+/.test(serialized)
  ) {
    throw new Error(`${task.id}: sanitized trace contains private data`);
  }
  chmodSync(tracePath, 0o600);
  return {
    bytes: statSync(tracePath).size,
    sha256: sha256(serialized),
    replay,
  };
}

async function runSession(task, keys, secrets, budget) {
  const workspace = prepareWorkspace(task);
  const sourceCapture = join(workspace, 'source-capture.jsonl');
  const provider = task.agent === 'claude' ? 'anthropic' : 'openai';
  const forwarder = await startForwarder(provider, task.injectRetry, budget);
  let proxy;
  try {
    proxy = createProxyServer({
      host: '127.0.0.1', port: 0,
      upstreams: { anthropic: forwarder.url, openai: forwarder.url },
      capture: {
        path: sourceCapture, includeBodies: true, fsync: true,
        maxBytes: 64 * 1024 * 1024, maxFiles: 1,
      },
      virtualContext: { enabled: true, queryFallback: false, minChars: MIN_CHARS, protectRecent: 0 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    const address = await proxy.listen();
    const result = await spawnAgent(task, workspace, `http://${address.host}:${address.port}`, keys, secrets);
    await proxy.close();
    proxy = undefined;
    if (!existsSync(sourceCapture)) {
      throw new Error(
        `${task.id}: agent exited ${result.code}${result.signal ? ` (${result.signal})` : ''} ` +
          `before its first provider request: ${result.stderrTail} debug: ${result.debugTail}`,
      );
    }
    const records = readCaptureFile(sourceCapture);
    const applied = records.filter(hasAppliedQcv);
    const sourceRecord = applied.at(-1);
    if (!sourceRecord) {
      throw new Error(
        `${task.id}: real agent produced no QCV-applied request: ` +
          JSON.stringify({
            ...structuralDiagnostics(records),
            agentExitCode: result.code,
            agentCorrect: result.correct,
            outputTail: result.outputTail,
          }),
      );
    }
    const seen = new Set();
    let retryObserved = false;
    for (const record of records) {
      if (seen.has(record.originalBodySha256)) retryObserved = true;
      seen.add(record.originalBodySha256);
    }
    const sanitized = await createSanitizedTrace(task, sourceRecord, secrets, workspace);
    return {
      id: task.id,
      agent: task.agent,
      join: task.join,
      injectedRetry: task.injectRetry,
      agentExitCode: result.code,
      agentSignal: result.signal,
      agentCorrect: result.correct,
      agentOutputSha256: result.outputSha256,
      sourceCaptureSha256: sha256(readFileSync(sourceCapture)),
      sourceRecords: records.length,
      qcvAppliedRecords: applied.length,
      stablePrefixObserved: stablePrefixObserved(records),
      retryObserved,
      forwarder: forwarder.stats(),
      sanitizedTrace: {
        file: `benchmarks/traces/agent-gate/${task.id}.jsonl`,
        bytes: sanitized.bytes,
        sha256: sanitized.sha256,
      },
      replay: sanitized.replay,
      sourceBodiesPersisted: false,
      agentOutputPersisted: false,
      stderrTail: result.code === 0 ? '' : result.stderrTail,
    };
  } finally {
    if (proxy) await proxy.close();
    await forwarder.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

function outcome(tasks, sessions, budget) {
  const injected = sessions.filter((session) => session.injectedRetry);
  const joins = sessions.filter((session) => session.join);
  const agents = new Set(sessions.map((session) => session.agent));
  const gates = {
    expectedSessionCount: sessions.length === tasks.length,
    tenRealAgentSessions: PHASE === 'benchmark' ? sessions.length === 10 : true,
    claudeAndCodex: agents.has('claude') && agents.has('codex'),
    everyAgentCompleted: sessions.every(
      (session) => session.agentExitCode === 0 && session.agentCorrect,
    ),
    everySessionVirtualized: sessions.every((session) => session.qcvAppliedRecords >= 1),
    everySanitizedTraceReplayed: sessions.every(
      (session) =>
        session.replay.replayable === 1 &&
        session.replay.matched === 1 &&
        session.replay.changed === 0 &&
        session.replay.failed === 0,
    ),
    toolContinuationObserved: sessions.every((session) => session.sourceRecords >= 2),
    longSessionsObserved: PHASE === 'benchmark'
      ? joins.length >= 4 && joins.every((session) => session.sourceRecords >= 3)
      : true,
    stablePrefixObserved: sessions.every((session) => session.stablePrefixObserved),
    injectedRetriesObserved: PHASE === 'benchmark'
      ? injected.length >= 2 && injected.every(
          (session) => session.forwarder.injectedFailures === 1 && session.retryObserved,
        )
      : true,
    sourceBodiesNotPersisted: sessions.every((session) => !session.sourceBodiesPersisted),
    withinExposureCap:
      budget.conservativeExposureUSD <= budget.maxUSD &&
      budget.providerRequests <= budget.maxRequests,
  };
  return { gates, verdict: Object.values(gates).every(Boolean) };
}

function writeArtifact(artifact, secrets) {
  mkdirSync(resultsDir, { recursive: true });
  const serialized = JSON.stringify(artifact, null, 2);
  if (
    secrets.some((secret) => serialized.includes(secret)) ||
    /sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+/.test(serialized)
  ) {
    throw new Error('refusing to persist an artifact containing an API key');
  }
  const suffix = LABEL ? `.${LABEL}` : '';
  const path = join(resultsDir, `agent-trace-gate${suffix}.json`);
  writeFileSync(path, `${serialized}\n`, { mode: 0o600 });
  return path;
}

async function main() {
  if (!['canary', 'benchmark'].includes(PHASE)) {
    throw new Error('--phase must be canary or benchmark');
  }
  if (!LABEL) throw new Error('BENCH_ARTIFACT_LABEL is required');
  const keys = requireKeys();
  const secrets = [keys.anthropic, keys.openai];
  const allTasks = taskDefinitions();
  const tasks = PHASE === 'canary'
    ? [
        allTasks.find((task) => task.agent === 'claude' && !task.join && !task.injectRetry),
        allTasks.find((task) => task.agent === 'codex' && !task.join && !task.injectRetry),
      ]
    : allTasks;
  if (tasks.some((task) => task == null)) throw new Error('trace task matrix is incomplete');
  const budget = new ExposureBudget(MAX_USD, MAX_REQUESTS);
  const sessions = [];
  for (const task of tasks) {
    console.log(
      `trace ${sessions.length + 1}/${tasks.length}: ${task.id} ` +
        `(join=${task.join} retry=${task.injectRetry})`,
    );
    const session = await runSession(task, keys, secrets, budget);
    sessions.push(session);
    console.log(
      `  correct=${session.agentCorrect} records=${session.sourceRecords} ` +
        `qcv=${session.qcvAppliedRecords} replay=${session.replay.matched}/1 ` +
        `exposure=$${budget.conservativeExposureUSD.toFixed(4)}`,
    );
  }
  const result = outcome(tasks, sessions, budget.snapshot());
  const artifact = {
    schemaVersion: 1,
    evidenceLevel: EVIDENCE.LIVE_AGENTIC,
    kind: 'sanitized-real-agent-trace-replay-gate',
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    methodology: {
      source:
        'Real Claude Code and Codex CLI sessions in disposable synthetic workspaces, routed through the production Pinpoint proxy.',
      sanitization:
        'Agent system prompts, tool schemas, outputs, source bodies, personal paths, and credentials are not persisted. Provider-native synthetic tool history is minimized, re-transformed, and written mode 0600.',
      replay:
        'Every persisted sanitized derivative is replayed offline and compared to its transformed-body SHA-256.',
      retries:
        'One transient provider error is injected into one session per agent; the actual agent must retry on the wire. The harness itself performs no retry.',
      limitation:
        'These are first-party controlled agent sessions over synthetic data, not customer production traces. Copilot subscription traffic delegates to Headroom and is outside QCV scope.',
    },
    models: { claude: ANTHROPIC_MODEL, codex: OPENAI_MODEL },
    budget: budget.snapshot(),
    ...result,
    sessions,
  };
  const path = writeArtifact(artifact, secrets);
  console.log(`trace gate verdict=${artifact.verdict}; artifact=${path}`);
  if (!artifact.verdict) throw new Error('agent trace gate completed but did not pass');
}

main().catch((error) => {
  console.error(`agent trace gate aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});