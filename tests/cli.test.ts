import { describe, expect, it } from 'vitest';

import { parseMcpArgs, parseProxyArgs, runQcvDemo } from '../src/cli/main.js';
import { parseMcpOpaqueFlowConfig } from '../src/mcp/flow.js';

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

  it('rejects invalid modes, ports, and unknown flags', () => {
    expect(parseProxyArgs(['--mode', 'fast'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--port', '70000'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--workers', '2'])).toEqual({
      ok: false,
      error: 'unknown proxy option: --workers',
    });
  });
});

describe('runQcvDemo', () => {
  it('materializes one exact answer without model-driven fallback', async () => {
    const output = await runQcvDemo();

    expect(output).toContain('exact answer materialized: user733@example.com');
    expect(output).toContain('model-driven fallback: not needed');
    expect(output).toContain('network requests: 0');
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
  });
});