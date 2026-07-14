import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readCaptureFile } from '../src/capture/store.js';
import { replayCaptureFile } from '../src/capture/replay.js';
import { runCaptureReplay } from '../src/cli/main.js';
import { createPixroom } from '../src/pixroom.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function capturePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pixroom-capture-'));
  directories.push(directory);
  return join(directory, 'nested', 'capture.jsonl');
}

describe('durable capture and replay', () => {
  it('writes metadata-only mode-0600 records without request content', async () => {
    const path = capturePath();
    const runtime = createPixroom({
      capture: { path, includeBodies: false, fsync: true },
      virtualContext: { enabled: false },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    await runtime.route(
      'openai',
      'gpt-test',
      { model: 'gpt-test', messages: [{ role: 'user', content: 'private text' }] },
      'payg',
    );

    const [record] = readCaptureFile(path);
    expect(record).toMatchObject({
      schemaVersion: 1,
      provider: 'openai',
      model: 'gpt-test',
      authMode: 'payg',
    });
    expect(record?.originalBody).toBeUndefined();
    expect(record?.transformedBody).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('private text');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(runtime.capture.stats()).toEqual({ records: 1, failures: 0 });
    await runtime.shutdown();
  });

  it('replays body-enabled exact QCV captures and matches the transformed hash', async () => {
    const path = capturePath();
    const overrides = {
      capture: { path, includeBodies: true, fsync: true },
      virtualContext: { enabled: true, minChars: 100, protectRecent: 0 },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent' as const,
    };
    const runtime = createPixroom(overrides);
    const rows = Array.from({ length: 50 }, (_, id) => ({ id, value: `value-${id}` }));
    await runtime.route(
      'anthropic',
      'claude-haiku-4-5',
      {
        model: 'claude-haiku-4-5',
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'data', content: JSON.stringify(rows) }] },
          { role: 'user', content: 'What is value for id 7?' },
        ],
      },
      'payg',
    );
    await runtime.shutdown();

    const [record] = readCaptureFile(path);
    expect(record?.originalBody).toBeDefined();
    expect(record?.transformedBody).toBeDefined();
    expect(record?.originalBodySha256).not.toBe(record?.transformedBodySha256);

    const replay = await replayCaptureFile(path, {
      ...overrides,
      capture: { path: '' },
    });
    expect(replay).toMatchObject({
      records: 1,
      replayable: 1,
      matched: 1,
      changed: 0,
      failed: 0,
    });
    expect(await runCaptureReplay(path, { ...overrides, capture: { path: '' } })).toContain(
      'matched transformed bodies: 1',
    );
  });

  it('rotates capture files before the configured byte cap', async () => {
    const path = capturePath();
    const runtime = createPixroom({
      capture: {
        path,
        includeBodies: false,
        fsync: true,
        maxBytes: 2_500,
        maxFiles: 10,
      },
      virtualContext: { enabled: false },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    for (let index = 0; index < 6; index += 1) {
      await runtime.route(
        'openai',
        'gpt-test',
        { model: 'gpt-test', messages: [{ role: 'user', content: `request-${index}` }] },
        'payg',
      );
    }
    await runtime.shutdown();

    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(true);
    expect(statSync(path).size).toBeLessThanOrEqual(2_500);
    expect(statSync(`${path}.1`).size).toBeLessThanOrEqual(2_500);
    expect(statSync(`${path}.1`).mode & 0o777).toBe(0o600);
    const retained = [path, ...Array.from({ length: 9 }, (_, index) => `${path}.${index + 1}`)]
      .filter((file) => existsSync(file))
      .flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean));
    expect(retained).toHaveLength(6);
  });
});