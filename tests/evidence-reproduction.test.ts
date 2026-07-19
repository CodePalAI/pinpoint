import { describe, expect, it } from 'vitest';

import {
  runMcpReproduction,
  verifyMcpReproduction,
  type McpReproductionBundle,
} from '../src/cli/evidence.js';

describe('packaged opaque-flow reproduction bundle', () => {
  it('emits a content-free 30-flow chain with eight denied bypasses', async () => {
    const bundle = await runMcpReproduction('unaffiliated');
    const verification = verifyMcpReproduction(bundle);

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      evidenceLevel: 'self-contained-protocol-reproduction',
      kind: 'mcp-value-opaque-flow-reproduction',
      passed: true,
      relationship: 'unaffiliated',
      package: { name: '@codepalaiorg/pinpoint', version: '0.2.5' },
      summary: {
        flowCalls: 30,
        destinationAcceptedCalls: 30,
        bypassAttempts: 8,
        bypassesDenied: 8,
        privateValuesScanned: 401,
        privateValuesVisible: 0,
      },
      security: {
        exactPersistedProjection: true,
        processSeparationValid: true,
        oneDispatchPerFlow: true,
        receiptChainValid: true,
        commitmentsUnlinkable: true,
      },
      failure: null,
    });
    expect(bundle.receipts).toHaveLength(30);
    expect(verification).toEqual({
      valid: true,
      errors: [],
      flowCalls: 30,
      bypassesDenied: 8,
      privateValuesVisible: 0,
    });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('demo-user-');
    expect(serialized).not.toContain('DEMO_PRIVATE_');
    expect(serialized).not.toContain('DEMO_DESTINATION_PRIVATE_RESULT');
  });

  it('rejects receipt or bundle tampering', async () => {
    const bundle = await runMcpReproduction('maintainer');
    const tampered = structuredClone(bundle) as McpReproductionBundle;
    (tampered.receipts[10] as { items: number }).items += 1;

    const verification = verifyMcpReproduction(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('receipt 11 failed signature'),
      'bundleSha256 does not match bundle content',
    ]));
  });
});