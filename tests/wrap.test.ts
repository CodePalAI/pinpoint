import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  AgentRegistry,
  WRAP_AGENTS,
  describeAgents,
  knownAgents,
  type LaunchAgent,
} from '../src/wrap/agents.js';
import { runWrap, copilotPreflight, terminateChildProcessTree } from '../src/wrap/runner.js';

const B = 'http://127.0.0.1:8788';

function launch(name: string): LaunchAgent {
  const a = WRAP_AGENTS[name]!;
  if (a.kind !== 'launch') throw new Error(`${name} is not a launch agent`);
  return a;
}

describe('wrap agent registry', () => {
  it('claude points ANTHROPIC_BASE_URL at the bare proxy URL', () => {
    expect(launch('claude').env(B)).toEqual({ ANTHROPIC_BASE_URL: B });
  });

  it('codex points OPENAI_BASE_URL at /v1', () => {
    expect(launch('codex').env(B)).toEqual({ OPENAI_BASE_URL: `${B}/v1` });
  });

  it('aider sets both OpenAI and Anthropic bases', () => {
    expect(launch('aider').env(B)).toEqual({
      OPENAI_API_BASE: `${B}/v1`,
      ANTHROPIC_BASE_URL: B,
    });
  });

  it('opencode injects a config-content baseURL override', () => {
    const cfg = JSON.parse(launch('opencode').env(B).OPENCODE_CONFIG_CONTENT!) as {
      provider: { anthropic: { options: { baseURL: string } }; openai: { options: { baseURL: string } } };
    };
    expect(cfg.provider.anthropic.options.baseURL).toBe(`${B}/v1`);
    expect(cfg.provider.openai.options.baseURL).toBe(`${B}/v1`);
  });

  it('vibe injects a VIBE_PROVIDERS entry', () => {
    const providers = JSON.parse(launch('vibe').env(B).VIBE_PROVIDERS!) as Array<{ api_base: string }>;
    expect(providers[0]!.api_base).toBe(`${B}/v1`);
  });

  it('copilot is delegated to headroom; IDE agents print', () => {
    expect(WRAP_AGENTS.copilot!.kind).toBe('delegate');
    for (const n of ['cursor', 'cline', 'continue']) {
      expect(WRAP_AGENTS[n]!.kind).toBe('print');
    }
  });

  it('knownAgents covers the full matrix', () => {
    expect(knownAgents()).toEqual(
      expect.arrayContaining([
        'claude',
        'codex',
        'aider',
        'goose',
        'openhands',
        'opencode',
        'vibe',
        'copilot',
        'cursor',
        'cline',
        'continue',
      ]),
    );
  });

  it('reports actual interception capability instead of implying uniform traffic access', () => {
    const byId = Object.fromEntries(describeAgents().map((descriptor) => [descriptor.id, descriptor]));
    expect(byId.claude?.interception).toBe('traffic');
    expect(byId.codex?.protocols).toContain('openai.responses');
    expect(byId.copilot?.interception).toBe('delegate');
    expect(byId.cursor?.interception).toBe('config-only');
  });

  it('supports external agent adapters without editing the built-in record', () => {
    const registry = new AgentRegistry().register({
      id: 'custom-agent',
      displayName: 'Custom Agent',
      interception: 'traffic',
      protocols: ['openai.chat-completions'],
      adapter: { kind: 'launch', command: 'custom-agent', env: (base) => ({ BASE: base }) },
    });
    expect(knownAgents(registry)).toEqual(['custom-agent']);
    expect(registry.get('custom-agent')?.adapter.kind).toBe('launch');
  });
});

describe('copilot preflight', () => {
  it('defaults the model to gpt-4o (override with PINPOINT_COPILOT_MODEL)', () => {
    const saved = process.env.PINPOINT_COPILOT_MODEL;
    delete process.env.PINPOINT_COPILOT_MODEL;
    try {
      expect(copilotPreflight().model).toBe('gpt-4o');
    } finally {
      if (saved !== undefined) process.env.PINPOINT_COPILOT_MODEL = saved;
    }
  });
});

/** Create native launchers backed by the current Node executable. */
function fakeBin(): { dir: string; wrapperScript: string; argsFile: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pinpoint-wrap-'));
  const argsFile = join(dir, 'args.txt');
  const wrapperScript = join(dir, 'wrap');
  writeFileSync(
    wrapperScript,
    `const fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(argsFile)}, 'wrap ' + process.argv.slice(2).join(' ') + '\\n');\n`,
  );
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const headroom = join(dir, `headroom${executableSuffix}`);
  const copilot = join(dir, `copilot${executableSuffix}`);
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, headroom);
    copyFileSync(process.execPath, copilot);
  } else {
    symlinkSync(process.execPath, headroom);
    symlinkSync(process.execPath, copilot);
  }
  chmodSync(headroom, 0o755);
  chmodSync(copilot, 0o755);

  const saved = {
    cwd: process.cwd(),
    PATH: process.env.PATH,
    PINPOINT_HEADROOM_BIN: process.env.PINPOINT_HEADROOM_BIN,
    GITHUB_COPILOT_TOKEN: process.env.GITHUB_COPILOT_TOKEN,
  };
  process.chdir(dir);
  process.env.PATH = `${dir}${delimiter}${saved.PATH ?? ''}`;
  process.env.PINPOINT_HEADROOM_BIN = headroom;
  process.env.GITHUB_COPILOT_TOKEN = 'test-token';

  const restore = () => {
    process.chdir(saved.cwd);
    for (const [k, v] of Object.entries(saved).filter(([key]) => key !== 'cwd')) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { dir, wrapperScript, argsFile, restore };
}

describe('wrap copilot → headroom delegation', () => {
  it('escalates when a delegated process ignores graceful termination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pinpoint-wrap-termination-'));
    const script = join(directory, 'ignore-termination.cjs');
    writeFileSync(script, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    const child = spawn(process.execPath, [script], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await terminateChildProcessTree(child, 'SIGTERM', 50);

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('delegates with --subscription and injects the default model when omitted', async () => {
    const fake = fakeBin();
    try {
      const code = await runWrap({ agent: 'copilot', passthrough: [] });
      expect(code).toBe(0);
      const recorded = readFileSync(fake.argsFile, 'utf8');
      expect(recorded).toContain('wrap copilot --subscription');
      expect(recorded).toContain('--no-context-tool'); // ephemeral by default
      expect(recorded).toContain('-- --model gpt-4o');
    } finally {
      fake.restore();
    }
  });

  it('--context-tool opts into headroom RTK (omits --no-context-tool)', async () => {
    const fake = fakeBin();
    try {
      const code = await runWrap({ agent: 'copilot', contextTool: true, passthrough: [] });
      expect(code).toBe(0);
      const recorded = readFileSync(fake.argsFile, 'utf8');
      expect(recorded).not.toContain('--no-context-tool');
    } finally {
      fake.restore();
    }
  });

  it('--byok omits --subscription and preserves an explicit --model', async () => {
    const fake = fakeBin();
    try {
      const code = await runWrap({
        agent: 'copilot',
        byok: true,
        passthrough: ['--model', 'claude-sonnet-4-20250514'],
      });
      expect(code).toBe(0);
      const recorded = readFileSync(fake.argsFile, 'utf8');
      expect(recorded).not.toContain('--subscription');
      expect(recorded).toContain('-- --model claude-sonnet-4-20250514');
    } finally {
      fake.restore();
    }
  });

  it('propagates only non-authorizing dashboard metadata to delegated Copilot', async () => {
    const fake = fakeBin();
    const history = join(fake.dir, 'dashboard-history');
    const envFile = join(fake.dir, 'dashboard-env.txt');
    const savedDashboardDir = process.env.PINPOINT_DASHBOARD_DIR;
    process.env.PINPOINT_DASHBOARD_DIR = history;
    writeFileSync(
      fake.wrapperScript,
      `const fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(fake.argsFile)}, 'wrap ' + process.argv.slice(2).join(' ') + '\\n');\nfs.writeFileSync(${JSON.stringify(envFile)}, [process.env.PINPOINT_DASHBOARD_GROUP ?? '', process.env.PINPOINT_DASHBOARD_DIR ?? '', process.env.PINPOINT_DASHBOARD_TOKEN ?? ''].join('\\n') + '\\n');\n`,
    );
    try {
      const code = await runWrap({
        agent: 'copilot',
        passthrough: [],
        dashboard: { port: 0, open: false },
      });
      expect(code).toBe(0);
      const [groupId, dashboardDir, browserToken] = readFileSync(envFile, 'utf8').split(/\r?\n/);
      expect(groupId).toMatch(/^dash_[a-f0-9]{32}$/);
      expect(dashboardDir).toBe(history);
      expect(browserToken).toBe('');
      const recordedArgs = readFileSync(fake.argsFile, 'utf8');
      expect(recordedArgs).toContain('wrap copilot --subscription');
      expect(recordedArgs).toContain('--port 8787');
      const groupDir = join(history, groupId!);
      const files = readdirSync(groupDir);
      expect(files.some((name) => name.endsWith('.state.json'))).toBe(true);
      expect(files.some((name) => name.endsWith('.events.jsonl'))).toBe(true);
      if (process.platform !== 'win32') {
        expect(statSync(groupDir).mode & 0o777).toBe(0o700);
      }
    } finally {
      if (savedDashboardDir === undefined) delete process.env.PINPOINT_DASHBOARD_DIR;
      else process.env.PINPOINT_DASHBOARD_DIR = savedDashboardDir;
      fake.restore();
    }
  });
});
