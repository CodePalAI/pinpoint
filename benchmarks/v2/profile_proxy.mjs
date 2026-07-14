// Benchmark v2 — paired direct-vs-pixroom proxy overhead using a local network mock.
// No provider calls, no API keys. Raw per-request samples are retained in the JSON
// artifact so percentiles can be independently recomputed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { createProxyServer } from '../../dist/proxy/server.js';
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

function csvNumbers(raw) {
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    minMs: sorted[0] ?? 0,
    meanMs: sorted.length > 0 ? sum / sorted.length : 0,
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

async function startMockUpstream() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'mock', choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('mock upstream has no TCP port');
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function oneRequest(url, body, protocol) {
  const started = performance.now();
  const response = await fetch(
    `${url}${protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}`,
    {
    method: 'POST',
    headers: protocol === 'anthropic'
      ? {
          'x-api-key': 'benchmark',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
      : { authorization: 'Bearer benchmark', 'content-type': 'application/json' },
    body,
    },
  );
  await response.arrayBuffer();
  return { ms: performance.now() - started, ok: response.ok };
}

async function warm(url, body, protocol) {
  for (let index = 0; index < warmupRequests; index += 1) {
    await oneRequest(url, body, protocol);
  }
}

async function runArm({ arm, url, body, concurrency, protocol }) {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const cpuBefore = process.cpuUsage();
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const memoryTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 10);
  memoryTimer.unref();

  const samples = [];
  let errors = 0;
  let next = 0;
  const started = performance.now();
  const workers = Array.from({ length: Math.min(concurrency, requests) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
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
  clearInterval(memoryTimer);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const cpu = process.cpuUsage(cpuBefore);
  loop.disable();

  return {
    arm,
    concurrency,
    requests,
    errors,
    durationMs,
    throughputRps: durationMs > 0 ? (requests * 1000) / durationMs : 0,
    latency: summarize(samples),
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    cpuMsPerRequest: (cpu.user + cpu.system) / 1000 / requests,
    rssBeforeBytes: rssBefore,
    peakRssBytes: peakRss,
    rssDeltaBytes: peakRss - rssBefore,
    eventLoopP99Ms: loop.percentile(99) / 1e6,
    rawLatencyMs: samples,
  };
}

async function main() {
  const mock = await startMockUpstream();
  const proxy = createProxyServer({
    host: '127.0.0.1',
    port: 0,
    upstreams: { openai: mock.url, anthropic: mock.url },
    optical: { enabled: false },
    semantic: { enabled: false, autoSpawn: false, healthTimeoutMs: 50 },
    logLevel: 'silent',
  });
  const proxyAddress = await proxy.listen();
  const proxyUrl = `http://${proxyAddress.host}:${proxyAddress.port}`;
  const runs = [];

  try {
    for (const protocol of protocols) {
      for (const size of payloadBytes) {
        const body = requestBody(size);
        await warm(mock.url, body, protocol);
        await warm(proxyUrl, body, protocol);
        for (const concurrency of concurrencies) {
          for (let repetition = 0; repetition < repetitions; repetition += 1) {
            const armOrder = (size + concurrency + repetition + protocol.length) % 2 === 0
              ? ['direct', 'pixroom-noop']
              : ['pixroom-noop', 'direct'];
            for (const arm of armOrder) {
              const url = arm === 'direct' ? mock.url : proxyUrl;
              const result = await runArm({ arm, url, body, concurrency, protocol });
              runs.push({ protocol, payloadBytes: Buffer.byteLength(body), repetition, armOrder, ...result });
              console.log(
                `${protocol.padEnd(9)} ${arm.padEnd(13)} bytes=${String(Buffer.byteLength(body)).padStart(7)} ` +
                  `c=${String(concurrency).padStart(3)} rep=${repetition + 1} ` +
                  `p95=${result.latency.p95Ms.toFixed(2)}ms rps=${result.throughputRps.toFixed(0)} ` +
                  `err=${result.errors}`,
              );
            }
          }
        }
      }
    }
  } finally {
    await proxy.close();
    await mock.close();
  }

  const comparisons = [];
  for (const protocol of protocols) {
    for (const size of payloadBytes) {
      for (const concurrency of concurrencies) {
        const actualSize = Buffer.byteLength(requestBody(size));
        const cells = runs.filter(
          (run) =>
            run.protocol === protocol &&
            run.payloadBytes === actualSize &&
            run.concurrency === concurrency,
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

  const artifact = {
    schemaVersion: 2,
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
    verdict: { zeroErrors: runs.every((run) => run.errors === 0) },
    limitations: [
      'Direct mock and proxy run in one process, so CPU/RSS are process-wide diagnostics.',
      'This measures local HTTP/JSON overhead, not provider latency or model quality.',
    ],
  };
  const resultsDir = join(here, '..', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = join(resultsDir, 'proxy-profile.json');
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`wrote ${outPath}`);
  if (!artifact.verdict.zeroErrors) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});