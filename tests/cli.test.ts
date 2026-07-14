import { describe, expect, it } from 'vitest';

import { parseProxyArgs, runQcvDemo } from '../src/cli/main.js';

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