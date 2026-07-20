import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseDashboardArgs,
  parseEvidenceArgs,
  initializeMcpAuthority,
  loadMcpAuthorityKey,
  parseMcpArgs,
  parseProxyArgs,
  runMcpDemo,
  runMcpDoctor,
  runQcvDemo,
} from '../src/cli/main.js';
import { parseMcpOpaqueFlowConfig } from '../src/mcp/flow.js';
import {
  destinationEnvironmentNames,
  parseMcpOpaqueFlowDestinationConfig,
  withoutDestinationOnlyEnvironment,
} from '../src/mcp/destination.js';

describe('parseProxyArgs', () => {
  it('parses mode, host, and port', () => {
    expect(
      parseProxyArgs(['--mode', 'shadow', '--host', '0.0.0.0', '--port', '9000']),
    ).toEqual({
      ok: true,
      overrides: { mode: 'shadow', host: '0.0.0.0', port: 9000 },
    });
  });

  it('supports an ephemeral port for tests and embedders', () => {
    expect(parseProxyArgs(['-p', '0'])).toEqual({ ok: true, overrides: { port: 0 } });
  });

  it('exposes the QCV kill switch and experimental fallback separately', () => {
    expect(parseProxyArgs(['--no-qcv', '--virtual-query-fallback'])).toEqual({
      ok: true,
      overrides: { virtualContext: { enabled: false, queryFallback: true } },
    });
  });

  it('keeps the dashboard opt-in and parses its independent port', () => {
    expect(parseProxyArgs(['--dashboard', '--dashboard-port', '8791', '--no-open'])).toEqual({
      ok: true,
      overrides: {},
      dashboard: { port: 8791, open: false },
    });
    expect(parseProxyArgs(['--no-open'])).toEqual({
      ok: false,
      error: '--dashboard-port and --no-open require --dashboard',
    });
  });

  it('rejects invalid modes, ports, and unknown flags', () => {
    expect(parseProxyArgs(['--mode', 'fast'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--port', '70000'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--workers', '2'])).toEqual({
      ok: false,
      error: 'unknown proxy option: --workers',
    });
  });
});

describe('parseDashboardArgs', () => {
  it('parses standalone launch options and rejects unknown values', () => {
    expect(parseDashboardArgs([])).toEqual({ ok: true, options: { open: true } });
    expect(parseDashboardArgs(['-p', '0', '--no-open'])).toEqual({
      ok: true,
      options: { port: 0, open: false },
    });
    expect(parseDashboardArgs(['--remote'])).toEqual({
      ok: false,
      error: 'unknown dashboard option: --remote',
    });
  });
});

describe('parseEvidenceArgs', () => {
  it('requires relationship disclosure and parses private bundle output', () => {
    expect(parseEvidenceArgs([
      'reproduce',
      '--relationship',
      'unaffiliated',
      '--out',
      'receipt.json',
    ])).toEqual({
      ok: true,
      mode: 'reproduce',
      relationship: 'unaffiliated',
      outputPath: 'receipt.json',
    });
    expect(parseEvidenceArgs(['reproduce'])).toEqual({
      ok: false,
      error: '--relationship is required',
    });
    expect(parseEvidenceArgs(['verify', 'receipt.json'])).toEqual({
      ok: true,
      mode: 'verify',
      filePath: 'receipt.json',
    });
  });
});

describe('persistent MCP authority platform boundary', () => {
  it.each(['darwin', 'win32'] as const)(
    'fails closed on %s before creating or loading private-key files',
    (targetPlatform) => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: targetPlatform, configurable: true });
    try {
      expect(() => initializeMcpAuthority('never-created.pem')).toThrow(
        'persistent authority keys currently require Linux file-permission semantics',
      );
      expect(() => loadMcpAuthorityKey('never-read.pem')).toThrow(
        'persistent authority keys currently require Linux file-permission semantics',
      );
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
    },
  );
});

describe('runQcvDemo', () => {
  it('materializes one exact answer without model-driven fallback', async () => {
    const output = await runQcvDemo();

    expect(output).toContain('exact answer materialized: user733@example.com');
    expect(output).toContain('model-driven fallback: not needed');
    expect(output).toContain('network requests: 0');
  });
});

describe('runMcpDemo', () => {
  it('executes the core value-opaque product path over local stdio', async () => {
    const output = await runMcpDemo();

    expect(output).toContain('destination: 40/40 exact recipients persisted');
    expect(output).toContain('bypass attempts denied: 4/4');
    expect(output).toContain('private values in client transcript: 0/401');
    expect(output).toContain('destination dispatches: 1 authorized; 0 bypass side effects');
    expect(output).toContain('signed receipt: valid against initialized verifier; wrong verifier rejected');
    expect(output).toContain('processes: source and destination PIDs are separate from the CLI');
    expect(output).toContain('transport: local stdio only; external services configured: none');
    expect(output).toContain('passed: true');
  });
});

describe('runMcpDoctor', () => {
  it('makes core MCP readiness the default health check', async () => {
    const output = await runMcpDoctor();

    expect(output).toContain('doctor: mcp');
    expect(output).toContain('core gateway self-test: PASS');
    expect(output).toContain('destination dispatches: 1 authorized; 0 bypass side effects');
    expect(output).toContain('ready: pinpoint mcp gateway -- <your-server> [args...]');
  });
});

describe('parseMcpArgs', () => {
  it('preserves the standalone server and parses a shell-free gateway command', () => {
    expect(parseMcpArgs([])).toEqual({ ok: true, mode: 'server' });
    expect(
      parseMcpArgs([
        'gateway',
        '--min-chars',
        '12000',
        '--flow-config',
        'flows.json',
        '--destination-config',
        'destination.json',
        '--flow-authority-key',
        'operator.pem',
        '--flow-authority-opening',
        'opening.json',
        '--dashboard',
        '--dashboard-port',
        '8792',
        '--no-open',
        '--',
        'npx',
        '-y',
        '@example/mcp',
      ]),
    ).toEqual({
      ok: true,
      mode: 'gateway',
      command: 'npx',
      args: ['-y', '@example/mcp'],
      minChars: 12000,
      flowConfigPath: 'flows.json',
      destinationConfigPath: 'destination.json',
      flowAuthorityKeyPath: 'operator.pem',
      flowAuthorityOpeningPath: 'opening.json',
      dashboard: { port: 8792, open: false },
    });
    expect(parseMcpArgs(['authority', 'init', '--out', 'operator.pem'])).toEqual({
      ok: true,
      mode: 'authority-init',
      outputPath: 'operator.pem',
    });
  });

  it('rejects missing commands, invalid thresholds, and unknown options', () => {
    expect(parseMcpArgs(['gateway'])).toMatchObject({ ok: false });
    expect(parseMcpArgs(['gateway', '--min-chars', '0', '--', 'server'])).toEqual({
      ok: false,
      error: '--min-chars must be an integer from 1 to 100000000',
    });
    expect(parseMcpArgs(['gateway', '--shell', '--', 'server'])).toEqual({
      ok: false,
      error: 'unknown mcp gateway option: --shell',
    });
    expect(parseMcpArgs(['gateway', '--no-open', '--', 'server'])).toEqual({
      ok: false,
      error: '--dashboard-port and --no-open require --dashboard',
    });
  });

  it('does not echo malformed flow, destination, or evidence values', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-malformed-cli-'));
    const cli = join(process.cwd(), 'bin', 'cli.js');
    const flowCanary = 'MALFORMED_FLOW_PRIVATE_CANARY';
    const destinationCanary = 'MALFORMED_DESTINATION_PRIVATE_CANARY';
    const evidenceCanary = 'MALFORMED_EVIDENCE_PRIVATE_CANARY';
    try {
      const validFlow = join(temporary, 'flow.json');
      const malformedFlow = join(temporary, 'malformed-flow.json');
      const malformedDestination = join(temporary, 'malformed-destination.json');
      const malformedEvidence = join(temporary, 'malformed-evidence.json');
      writeFileSync(validFlow, JSON.stringify({
        version: 1,
        flows: [{
          name: 'test_flow',
          sourceTool: 'source_read',
          destinationTool: 'destination_write',
          destinationArgument: 'records',
          allowedOps: ['json_select'],
          allowedFields: ['id'],
        }],
      }));
      writeFileSync(malformedFlow, `{"fixedWhere":"${flowCanary}",`);
      writeFileSync(malformedDestination, `{"token":"${destinationCanary}",`);
      writeFileSync(malformedEvidence, `{"value":"${evidenceCanary}",`);
      const cases = [
        {
          canary: flowCanary,
          args: ['mcp', 'gateway', '--flow-config', malformedFlow, '--', process.execPath, '--version'],
        },
        {
          canary: destinationCanary,
          args: [
            'mcp', 'gateway', '--flow-config', validFlow,
            '--destination-config', malformedDestination, '--', process.execPath, '--version',
          ],
        },
        { canary: evidenceCanary, args: ['evidence', 'verify', malformedEvidence] },
      ];
      for (const testCase of cases) {
        const run = spawnSync(process.execPath, [cli, ...testCase.args], { encoding: 'utf8' });
        expect(run.status).toBe(2);
        expect(run.stdout).not.toContain(testCase.canary);
        expect(run.stderr).not.toContain(testCase.canary);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('parses versioned opaque-flow policy with privacy-preserving defaults', () => {
    const config = parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{
        name: 'deliver_active',
        sourceTool: 'accounts_list',
        sourceKind: 'json-array',
        destinationTool: 'campaign_deliver',
        destinationArgument: 'recipients',
        fixedDestinationArguments: { campaign: 'renewal' },
        allowedOps: ['json_select'],
        allowedWhereFields: ['active'],
        allowedFields: ['email'],
      }],
    });

    expect(config).toMatchObject({
      version: 1,
      exposeQueryTool: false,
      exposeArtifactResources: false,
      opaqueArtifactIds: true,
      flows: [{
        name: 'deliver_active',
        hideDestinationTool: true,
        maxItems: 100,
        maxBytes: 65_536,
      }],
    });
  });

  it('parses a private destination with a deny-by-default environment', () => {
    const destination = parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: '/usr/local/bin/crm-mcp',
      args: ['--stdio'],
      envAllowlist: ['PATH', 'CRM_TOKEN'],
      sharedEnvAllowlist: ['PATH'],
    }, {
      PATH: '/usr/bin:/bin',
      CRM_TOKEN: 'destination-secret',
      SOURCE_TOKEN: 'must-not-cross',
    });

    expect(destination).toMatchObject({
      id: 'crm-domain',
      command: '/usr/local/bin/crm-mcp',
      args: ['--stdio'],
      envAllowlist: ['PATH', 'CRM_TOKEN'],
      sharedEnvAllowlist: ['PATH'],
      env: { PATH: '/usr/bin:/bin', CRM_TOKEN: 'destination-secret' },
      declaredEnvNames: ['PATH', 'CRM_TOKEN'],
      sharedEnvNames: ['PATH'],
      initializeTimeoutMs: 10_000,
      requestTimeoutMs: 30_000,
      shutdownGraceMs: 2_000,
    });
    expect(destination.env).not.toHaveProperty('SOURCE_TOKEN');
    expect(() => parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: '/usr/local/bin/crm-mcp',
      env: { CRM_TOKEN: 'plaintext-not-allowed' },
    })).toThrow('unknown opaque-flow destination config field: env');
    expect(() => parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: '/usr/local/bin/crm-mcp',
      envAllowlist: ['CRM_TOKEN'],
      sharedEnvAllowlist: ['PATH'],
    })).toThrow('sharedEnvAllowlist must be a unique subset of envAllowlist');
  });

  it('treats Windows environment names as case-insensitive across both process domains', () => {
    const destination = parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: 'crm-mcp.exe',
      envAllowlist: ['CRM_TOKEN', 'Path'],
      sharedEnvAllowlist: ['PATH'],
    }, {
      Crm_Token: 'destination-secret',
      PATH: 'C:\\Windows',
      SOURCE_TOKEN: 'source-secret',
    }, 'win32');

    expect(destination.env).toEqual({
      CRM_TOKEN: 'destination-secret',
      Path: 'C:\\Windows',
    });
    expect(withoutDestinationOnlyEnvironment(
      { Crm_Token: 'destination-secret', PATH: 'C:\\Windows', SOURCE_TOKEN: 'source-secret' },
      destination.declaredEnvNames ?? [],
      destination.sharedEnvNames ?? [],
      'win32',
    )).toEqual({ PATH: 'C:\\Windows', SOURCE_TOKEN: 'source-secret' });
    expect(() => parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: 'crm-mcp.exe',
      envAllowlist: ['CRM_TOKEN', 'crm_token'],
    }, {}, 'win32')).toThrow('envAllowlist must contain at most 64 unique environment names');
    expect(() => parseMcpOpaqueFlowDestinationConfig({
      version: 1,
      id: 'crm-domain',
      command: 'crm-mcp.exe',
      envAllowlist: ['pinpoint_dashboard_group'],
    }, {}, 'win32')).toThrow('envAllowlist contains a reserved Pinpoint environment name');
    expect(withoutDestinationOnlyEnvironment(
      { pinpoint_dashboard_group: 'private-group', Pinpoint_Dashboard_Dir: 'private-dir', PATH: 'C:\\Windows' },
      ['PINPOINT_DASHBOARD_GROUP', 'PINPOINT_DASHBOARD_DIR'],
      [],
      'win32',
    )).toEqual({ PATH: 'C:\\Windows' });
    expect(destinationEnvironmentNames({
      declaredEnvNames: [],
      env: { CRM_TOKEN: 'secret', PATH: 'C:\\Windows' },
    }, 'win32')).toEqual(['CRM_TOKEN', 'PATH']);
  });

  it('parses the shipped private-destination example', () => {
    const example = JSON.parse(readFileSync('examples/mcp-opaque-destination.json', 'utf8'));
    expect(parseMcpOpaqueFlowDestinationConfig(example, {
      PATH: '/usr/bin:/bin',
      CRM_API_TOKEN: 'synthetic-token',
    })).toMatchObject({
      id: 'crm-domain',
      env: { PATH: '/usr/bin:/bin', CRM_API_TOKEN: 'synthetic-token' },
      sharedEnvNames: ['PATH'],
    });
  });

  it('rejects config typos and destination-policy overlap', () => {
    expect(() => parseMcpOpaqueFlowConfig({ version: 1, flow: [] })).toThrow(
      'unknown opaque flow config field',
    );
    expect(() => parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{
        name: 'unsafe',
        sourceTool: 'source',
        destinationTool: 'destination',
        destinationArgument: 'payload',
        fixedDestinationArguments: { payload: [] },
        allowedOps: ['json_select'],
        allowedFields: ['value'],
      }],
    })).toThrow('destination argument policy overlaps');
    expect(() => parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{
        name: 'typo',
        sourceTool: 'source',
        destinationTool: 'destination',
        destinationArgument: 'payload',
        allowedOps: ['json_select'],
        allowedFields: ['value'],
        maxItem: 1,
      }],
    })).toThrow('unknown opaque flow policy field: maxItem');
    expect(() => parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{
        name: 'wrong_type',
        sourceTool: 'source',
        destinationTool: 'destination',
        destinationArgument: 'payload',
        allowedOps: ['json_select'],
        allowedFields: 'value',
      }],
    })).toThrow('allowedFields must contain 1 to 64 unique values');
  });
});