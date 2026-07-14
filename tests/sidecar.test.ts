import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { HeadroomSidecar } from '../src/sidecar/headroom-sidecar.js';
import { closeTestServer } from './helpers/http.js';

const directories: string[] = [];
const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function unusedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await closeTestServer(server);
  return port;
}

describe('managed Headroom sidecar', () => {
  it('serializes startup and isolates the child from credentials and unsafe overrides', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pinpoint-sidecar-'));
    directories.push(directory);
    const executable = join(directory, 'headroom');
    const recordPath = join(directory, 'record.json');
    const countPath = join(directory, 'count.txt');
    writeFileSync(
      executable,
      `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(countPath)}, 'spawn\\n');
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ args, env: process.env }));
const port = Number(args[args.indexOf('--port') + 1]);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"status":"ok"}');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
    );
    chmodSync(executable, 0o755);
    process.env.PATH = `${directory}:${originalEnvironment.PATH ?? ''}`;
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-child';
    process.env.OPENAI_API_KEY = 'must-not-reach-child';
    process.env.HEADROOM_HOST = '0.0.0.0';
    process.env.HEADROOM_CCR_BACKEND = 'sqlite';
    process.env.HEADROOM_TELEMETRY = 'on';
    process.env.PINPOINT_HEADROOM_AUTOSPAWN = '1';
    const port = await unusedPort();
    const config = loadConfig({
      semantic: {
        enabled: true,
        sidecarUrl: `http://127.0.0.1:${port}`,
        sidecarPort: port,
        healthTimeoutMs: 100,
        spawnReadyTimeoutMs: 5_000,
      },
    });
    const sidecar = new HeadroomSidecar(config.semantic, createLogger('silent'));

    const results = await Promise.all([
      sidecar.ensureHealthy(),
      sidecar.ensureHealthy(),
      sidecar.ensureHealthy(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(readFileSync(countPath, 'utf8').trim().split('\n')).toHaveLength(1);
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as {
      args: string[];
      env: Record<string, string>;
    };
    expect(record.args).toEqual([
      'proxy',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ]);
    expect(record.env).toMatchObject({
      HEADROOM_HOST: '127.0.0.1',
      HEADROOM_PORT: String(port),
      HEADROOM_WORKERS: '1',
      HEADROOM_MODE: 'cache',
      HEADROOM_STATELESS: 'true',
      HEADROOM_CCR_BACKEND: 'memory',
      HEADROOM_TELEMETRY: 'off',
      HEADROOM_UPDATE_CHECK: 'off',
    });
    expect(record.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(record.env.OPENAI_API_KEY).toBeUndefined();

    await sidecar.stop();
  });
});