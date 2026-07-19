import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DashboardJournal } from '../src/dashboard/journal.js';
import { createDashboardServer, type DashboardServer } from '../src/dashboard/server.js';
import type { DashboardProviderRouteEvent, DashboardSnapshot } from '../src/dashboard/types.js';

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

function streamSnapshots(
  port: number,
  token: string,
  count: number,
  onSnapshot?: (snapshot: DashboardSnapshot, index: number) => void,
): Promise<DashboardSnapshot[]> {
  return new Promise((resolveSnapshots, rejectSnapshots) => {
    const snapshots: DashboardSnapshot[] = [];
    let buffer = '';
    const timeout = setTimeout(() => {
      req.destroy();
      rejectSnapshots(new Error(`timed out after ${snapshots.length} snapshots`));
    }, 3_000);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/v1/stream',
      headers: { authorization: `Bearer ${token}` },
    }, (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!data || !frame.includes('event: snapshot')) continue;
          const snapshot = JSON.parse(data.slice(6)) as DashboardSnapshot;
          snapshots.push(snapshot);
          onSnapshot?.(snapshot, snapshots.length - 1);
          if (snapshots.length === count) {
            clearTimeout(timeout);
            req.destroy();
            resolveSnapshots(snapshots);
            return;
          }
        }
      });
    });
    req.once('error', (error) => {
      clearTimeout(timeout);
      if (snapshots.length < count) rejectSnapshots(error);
    });
    req.end();
  });
}

describe('dashboard server', () => {
  it('pushes every subsequent journal update to an attached dashboard', async () => {
    const { rootDir, assetsDir, journal } = fixture();
    const server = createDashboardServer({
      rootDir,
      assetsDir,
      groupId: journal.groupId,
      port: 0,
      token: 'stream-token',
      pollIntervalMs: 100,
    });
    servers.push(server);
    const { port } = await server.listen();
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const snapshotsPromise = streamSnapshots(port, server.token, 2, (_snapshot, index) => {
      if (index === 0) resolveFirst();
    });
    await first;
    const metric = (value: number) => ({
      value,
      unit: 'tokens' as const,
      source: 'pinpoint' as const,
      basis: 'estimate' as const,
      scope: 'request' as const,
    });
    journal.onEvent({
      schemaVersion: 1,
      type: 'provider.route',
      source: 'pinpoint',
      occurredAt: '2026-07-17T10:00:01.000Z',
      provider: 'openai',
      model: 'gpt-test',
      authMode: 'payg',
      mode: 'optimize',
      durationMs: 5,
      tokensText: metric(50),
      tokensCompressed: metric(20),
      tokensSaved: metric(30),
      reversibleCount: 0,
      stages: [{
        stage: 'virtual',
        applied: true,
        reason: 'applied',
        tokensText: 50,
        tokensCompressed: 20,
        tokensSaved: 30,
        basis: 'estimate',
      }],
    });
    const snapshots = await snapshotsPromise;
    expect(snapshots.map(({ requests }) => requests)).toEqual([1, 2]);
    expect(snapshots.map(({ eventCount }) => eventCount)).toEqual([1, 2]);
  });

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
    const sourceCss = readFileSync(join(process.cwd(), 'dashboard', 'src', 'styles.css'), 'utf8');
    expect(sourceCss).toContain('contain: layout paint');
    expect(sourceCss).toContain('content-visibility: auto');

    expect((await request(address.port, '/api/v1/snapshot')).status).toBe(401);
    const snapshot = await request(address.port, '/api/v1/snapshot', { token: server.token });
    expect(snapshot.status).toBe(200);
    expect(JSON.parse(snapshot.body)).toMatchObject({
      groupId: journal.groupId,
      requests: 1,
      eventCount: 1,
      negativeSavingsRoutes: 0,
      tokenLanes: [{ source: 'pinpoint', basis: 'estimate', tokensSaved: 75 }],
      privacy: { metadataOnly: true },
    });
    const history = await request(address.port, '/api/v1/history', { token: server.token });
    expect(JSON.parse(history.body)).toMatchObject({
      sessions: [{
        groupId: journal.groupId,
        requests: 1,
        eventCount: 1,
        negativeSavingsRoutes: 0,
        durationMs: expect.any(Number),
        tokenLanes: [{ source: 'pinpoint', tokensSaved: 75 }],
      }],
    });
    expect(JSON.parse(history.body).sessions[0].durationMs).toBeGreaterThanOrEqual(0);
    const historical = await request(
      address.port,
      `/api/v1/history?group=${journal.groupId}`,
      { token: server.token },
    );
    expect(JSON.parse(historical.body)).toMatchObject({
      session: { groupId: journal.groupId, requests: 1, recentEvents: [{ type: 'provider.route' }] },
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
    expect((await request(port, '/api/v1/history?group=../../etc', {
      token: server.token,
    })).status).toBe(400);
    journal.close();
  });
});