import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DashboardJournal } from '../src/dashboard/journal.js';
import { createDashboardServer, type DashboardServer } from '../src/dashboard/server.js';
import type { DashboardProviderRouteEvent } from '../src/dashboard/types.js';

const directories: string[] = [];
const servers: DashboardServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): { rootDir: string; assetsDir: string; journal: DashboardJournal } {
  const directory = mkdtempSync(join(tmpdir(), 'pinpoint-dashboard-server-'));
  directories.push(directory);
  const rootDir = join(directory, 'history');
  const assetsDir = join(directory, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>Pinpoint Session Recorder</title>');
  const journal = new DashboardJournal({ rootDir, source: 'pinpoint' });
  const metric = (value: number) => ({
    value,
    unit: 'tokens' as const,
    source: 'pinpoint' as const,
    basis: 'estimate' as const,
    scope: 'request' as const,
  });
  const event: DashboardProviderRouteEvent = {
    schemaVersion: 1,
    type: 'provider.route',
    source: 'pinpoint',
    occurredAt: '2026-07-17T10:00:00.000Z',
    provider: 'openai',
    model: 'gpt-test',
    authMode: 'payg',
    mode: 'optimize',
    durationMs: 4,
    tokensText: metric(100),
    tokensCompressed: metric(25),
    tokensSaved: metric(75),
    reversibleCount: 1,
    stages: [{
      stage: 'virtual',
      applied: true,
      reason: 'applied',
      tokensText: 100,
      tokensCompressed: 25,
      tokensSaved: 75,
      basis: 'estimate',
    }],
  };
  journal.onEvent(event);
  return { rootDir, assetsDir, journal };
}

function request(
  port: number,
  path: string,
  options: { method?: string; host?: string; origin?: string; token?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        host: options.host ?? `127.0.0.1:${port}`,
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolveRequest({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body,
      }));
    });
    req.once('error', rejectRequest);
    req.end();
  });
}

describe('dashboard server', () => {
  it('serves local assets and authenticated read-only snapshots with hardened headers', async () => {
    const { rootDir, assetsDir, journal } = fixture();
    const server = createDashboardServer({
      rootDir,
      assetsDir,
      groupId: journal.groupId,
      port: 0,
      token: 'test-dashboard-token',
    });
    servers.push(server);
    const address = await server.listen();

    const page = await request(address.port, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('Pinpoint Session Recorder');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['cache-control']).toBe('no-store, max-age=0');

    expect((await request(address.port, '/api/v1/snapshot')).status).toBe(401);
    const snapshot = await request(address.port, '/api/v1/snapshot', { token: server.token });
    expect(snapshot.status).toBe(200);
    expect(JSON.parse(snapshot.body)).toMatchObject({
      groupId: journal.groupId,
      requests: 1,
      tokenLanes: [{ source: 'pinpoint', basis: 'estimate', tokensSaved: 75 }],
      privacy: { metadataOnly: true },
    });
    journal.close();
  });

  it('rejects DNS rebinding, cross-origin access, mutations, and traversal', async () => {
    const { rootDir, assetsDir, journal } = fixture();
    const server = createDashboardServer({ rootDir, assetsDir, groupId: journal.groupId, port: 0 });
    servers.push(server);
    const { port } = await server.listen();

    expect((await request(port, '/', { host: 'attacker.example' })).status).toBe(421);
    expect((await request(port, '/api/v1/snapshot', {
      token: server.token,
      origin: 'https://attacker.example',
    })).status).toBe(403);
    expect((await request(port, '/api/v1/snapshot', {
      token: server.token,
      method: 'POST',
    })).status).toBe(405);
    expect((await request(port, '/%2e%2e/package.json')).status).toBe(404);
    journal.close();
  });
});