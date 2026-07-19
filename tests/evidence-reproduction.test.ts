import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  runMcpReproduction,
  verifyMcpReproduction,
  type McpReproductionBundle,
} from '../src/cli/evidence.js';
import { canonicalJson } from '../src/mcp/flow.js';
import { runMcpScenario } from '../src/cli/mcp-demo.js';

function recomputeChecksum(bundle: McpReproductionBundle): void {
  const { integrity: _integrity, ...unsigned } = bundle;
  (bundle.integrity as { checksum: string }).checksum = createHash('sha256')
    .update(canonicalJson(unsigned))
    .digest('hex');
}

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
        repeatedFlowCalls: 30,
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
        commitmentsDistinctAcrossRepetitions: true,
      },
      failure: null,
    });
    expect(bundle.denials.map(({ id }) => id)).toEqual([
      'direct-destination',
      'direct-query',
      'artifact-read',
      'forged-capability',
      'operation-override',
      'projection-override',
      'fixed-predicate-override',
      'destination-argument-override',
    ]);
    expect(bundle.receipts).toHaveLength(30);
    expect(verification).toMatchObject({
      valid: true,
      errors: [],
      checks: {
        schema: true,
        checksum: true,
        receiptChain: true,
        reportedResults: true,
        runtimeManifest: true,
        relationshipDeclared: true,
        operatorAuthenticated: false,
      },
      repeatedFlowCalls: 30,
      bypassesDenied: 8,
      privateValuesVisible: 0,
    });
    expect(verification.warnings).toContainEqual(expect.stringContaining('do not authenticate'));
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
      'receipt 11 has invalid item count',
      'bundle checksum does not match content',
    ]));
  });

  it('rejects unknown fields even when the accidental-corruption checksum is recomputed', async () => {
    const bundle = await runMcpReproduction('maintainer');
    const tampered = structuredClone(bundle) as McpReproductionBundle & { assertion?: string };
    tampered.assertion = 'pretend this authenticates the operator';
    recomputeChecksum(tampered);

    const verification = verifyMcpReproduction(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.checks.checksum).toBe(true);
    expect(verification.checks.schema).toBe(false);
    expect(verification.errors).toContain('bundle has unknown field: assertion');
  });

  it('retains failures without exception text or fabricated completed metrics', async () => {
    const bundle = await runMcpReproduction('unaffiliated', {
      scenarioRunner: async () => {
        throw new Error('/Users/alice/private/DEMO_PRIVATE_7 failed');
      },
    });
    const serialized = JSON.stringify(bundle);

    expect(bundle).toMatchObject({
      passed: false,
      summary: {
        repeatedFlowCalls: null,
        destinationAcceptedCalls: null,
        bypassAttempts: null,
        bypassesDenied: null,
        privateValuesScanned: null,
        privateValuesVisible: null,
      },
      denials: [],
      receiptVerifier: null,
      receipts: [],
      failure: { code: 'INTERNAL_ERROR' },
    });
    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('DEMO_PRIVATE_7');
    const verification = verifyMcpReproduction(bundle);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain('reproduction did not pass');
  });

  it('contains hostile depth without throwing', () => {
    let hostile: Record<string, unknown> = {};
    const root = hostile;
    for (let depth = 0; depth < 100; depth += 1) {
      hostile.next = {};
      hostile = hostile.next as Record<string, unknown>;
    }

    expect(() => verifyMcpReproduction(root)).not.toThrow();
    expect(verifyMcpReproduction(root).valid).toBe(false);
    expect(verifyMcpReproduction(root).errors).toContain(
      'bundle exceeds JSON depth, node, string, or collection bounds',
    );
  });

  it('covers shutdown-time source output in the transcript scan', async () => {
    await expect(runMcpScenario({
      flowCalls: 1,
      extendedBypasses: false,
      lateSourcePrivateValue: 'DEMO_LATE_SHUTDOWN_PRIVATE_VALUE',
    })).rejects.toThrow('value-opaque MCP demo exposed a private fixture value');
  });
});