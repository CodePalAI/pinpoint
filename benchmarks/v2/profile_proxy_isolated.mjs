import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { EVIDENCE } from '../evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const requests = Number(process.env.BENCH_REQUESTS ?? 150);
const repetitions = Number(process.env.BENCH_REPS ?? 3);
const concurrencies = csvNumbers(process.env.BENCH_CONCURRENCIES ?? '1,10,100');
const payloadBytes = csvNumbers(process.env.BENCH_PAYLOAD_BYTES ?? '1024,102400');
const warmupRequests = Number(process.env.BENCH_WARMUP ?? 20);
const protocols = (process.env.BENCH_PROTOCOLS ?? 'openai,anthropic')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value === 'openai' || value === 'anthropic');
const activeWorkers = new Set();

function csvNumbers(raw) {
  return raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    n: sorted.length,
    minMs: sorted[0] ?? 0,
    meanMs: sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function requestBody(size) {
  const fixed = JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: '' }] });
  return JSON.stringify({
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'x'.repeat(Math.max(0, size - fixed.length)) }],
  });
}

function startWorker(file, env = {}) {
  const child = fork(join(here, file), [], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  activeWorkers.add(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${file} did not become ready within 10 seconds`));
    }, 10_000);
    timer.unref();
    const onExit = (code) => {
      clearTimeout(timer);
      activeWorkers.delete(child);
      reject(new Error(`${file} exited before ready (${code})`));
    };
    child.once('exit', onExit);
    child.on('message', (message) => {
      if (message?.type !== 'ready' || typeof message.url !== 'string') return;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve({ child, url: message.url });
    });
  });
}

function stopWorker(worker) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.child.kill('SIGKILL');
    }, 5_000);
    timer.unref();
    worker.child.once('exit', () => {
      clearTimeout(timer);
      activeWorkers.delete(worker.child);
      resolve();
    });
    worker.child.send('shutdown');
  });
}

function killActiveWorkers() {
  for (const child of activeWorkers) child.kill('SIGKILL');
  activeWorkers.clear();
}

async function oneRequest(url, body, protocol) {
  const started = performance.now();
  const response = await fetch(`${url}${protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}`, {
    method: 'POST',
    headers: protocol === 'anthropic'
      ? { 'x-api-key': 'benchmark', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { authorization: 'Bearer benchmark', 'content-type': 'application/json' },
    body,
  });
  await response.arrayBuffer();
  return { ms: performance.now() - started, ok: response.ok };
}

async function warm(url, body, protocol) {
  for (let index = 0; index < warmupRequests; index += 1) await oneRequest(url, body, protocol);
}

async function runArm({ arm, url, body, concurrency, protocol }) {
  const samples = [];
  let errors = 0;
  let next = 0;
  const started = performance.now();
  const workers = Array.from({ length: Math.min(concurrency, requests) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= requests) return;
      try {
        const result = await oneRequest(url, body, protocol);
        samples.push(result.ms);
        if (!result.ok) errors += 1;
      } catch {
        errors += 1;
      }
    }
  });
  await Promise.all(workers);
  const durationMs = performance.now() - started;
  return {
    arm,
    concurrency,
    requests,
    errors,
    durationMs,
    throughputRps: durationMs > 0 ? (requests * 1000) / durationMs : 0,
    latency: summarize(samples),
    rawLatencyMs: samples,
  };
}

async function main() {
  const upstream = await startWorker('profile_upstream_worker.mjs');
  let proxy;
  try {
    proxy = await startWorker('profile_proxy_worker.mjs', { BENCH_UPSTREAM: upstream.url });
  } catch (error) {
    await stopWorker(upstream);
    throw error;
  }
  const runs = [];
  try {
    for (const protocol of protocols) {
      for (const size of payloadBytes) {
        const body = requestBody(size);
        await warm(upstream.url, body, protocol);
        await warm(proxy.url, body, protocol);
        for (const concurrency of concurrencies) {
          for (let repetition = 0; repetition < repetitions; repetition += 1) {
            const order = (size + concurrency + repetition + protocol.length) % 2 === 0
              ? ['direct', 'pixroom-noop']
              : ['pixroom-noop', 'direct'];
            for (const arm of order) {
              const result = await runArm({
                arm,
                url: arm === 'direct' ? upstream.url : proxy.url,
                body,
                concurrency,
                protocol,
              });
              runs.push({ protocol, payloadBytes: Buffer.byteLength(body), repetition, armOrder: order, ...result });
              console.log(
                `${protocol.padEnd(9)} ${arm.padEnd(13)} bytes=${String(Buffer.byteLength(body)).padStart(7)} ` +
                  `c=${String(concurrency).padStart(3)} rep=${repetition + 1} ` +
                  `p95=${result.latency.p95Ms.toFixed(2)}ms err=${result.errors}`,
              );
            }
          }
        }
      }
    }
  } finally {
    await stopWorker(proxy);
    await stopWorker(upstream);
  }

  const comparisons = [];
  for (const protocol of protocols) {
    for (const size of payloadBytes) {
      for (const concurrency of concurrencies) {
        const actualSize = Buffer.byteLength(requestBody(size));
        const cells = runs.filter(
          (run) => run.protocol === protocol && run.payloadBytes === actualSize && run.concurrency === concurrency,
        );
        const direct = cells.filter((run) => run.arm === 'direct');
        const proxied = cells.filter((run) => run.arm === 'pixroom-noop');
        const directP95 = direct.reduce((sum, run) => sum + run.latency.p95Ms, 0) / direct.length;
        const proxyP95 = proxied.reduce((sum, run) => sum + run.latency.p95Ms, 0) / proxied.length;
        comparisons.push({
          protocol,
          payloadBytes: actualSize,
          concurrency,
          directMeanP95Ms: directP95,
          proxyMeanP95Ms: proxyP95,
          addedP95Ms: proxyP95 - directP95,
        });
      }
    }
  }
  const saturated = comparisons.filter((comparison) => comparison.concurrency === 100);
  const artifact = {
    schemaVersion: 1,
    evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    system: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpus: os.cpus().map((cpu) => cpu.model),
      totalMemoryBytes: os.totalmem(),
    },
    config: { requests, repetitions, protocols, concurrencies, payloadBytes, warmupRequests },
    comparisons,
    runs,
    verdict: {
      zeroErrors: runs.every((run) => run.errors === 0),
      belowFiveMsAtConcurrency100:
        saturated.length > 0
          ? saturated.every((comparison) => comparison.addedP95Ms < 5)
          : null,
      maxAddedP95AtConcurrency100:
        saturated.length > 0
          ? Math.max(...saturated.map((comparison) => comparison.addedP95Ms))
          : null,
    },
    limitations: [
      'Load generator, proxy, and mock upstream use separate OS processes on one host.',
      'This measures local HTTP/JSON overhead, not provider latency or model quality.',
    ],
  };
  const resultsDir = join(here, '..', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const path = join(resultsDir, 'proxy-profile-isolated.json');
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  console.log(`VERDICT ${JSON.stringify(artifact.verdict)}`);
  console.log(`wrote ${path}`);
  if (!artifact.verdict.zeroErrors) process.exitCode = 1;
}

main().catch((error) => {
  killActiveWorkers();
  console.error(error);
  process.exitCode = 1;
});