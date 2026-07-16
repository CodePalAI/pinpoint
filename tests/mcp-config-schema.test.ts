import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { parseMcpOpaqueFlowDestinationConfig } from '../src/mcp/destination.js';
import { parseMcpOpaqueFlowConfig } from '../src/mcp/flow.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const flowSchema = JSON.parse(readFileSync('examples/mcp-opaque-flow.schema.json', 'utf8'));
const destinationSchema = JSON.parse(
  readFileSync('examples/mcp-opaque-destination.schema.json', 'utf8'),
);
const validateFlow = ajv.compile(flowSchema);
const validateDestination = ajv.compile(destinationSchema);

const baseFlow = {
  version: 1,
  flows: [{
    name: 'deliver_active',
    sourceTool: 'accounts_list',
    sourceKind: 'json-array',
    destinationTool: 'campaign_deliver',
    destinationArgument: 'recipients',
    allowedOps: ['json_select'],
    fixedWhere: { active: true },
    allowedFields: ['email'],
  }],
};

const baseDestination = {
  version: 1,
  id: 'crm-domain',
  command: 'crm-mcp',
  envAllowlist: ['PATH', 'CRM_TOKEN'],
  sharedEnvAllowlist: ['PATH'],
};

function runtimeAcceptsFlow(value: unknown): boolean {
  try {
    parseMcpOpaqueFlowConfig(value);
    return true;
  } catch {
    return false;
  }
}

function runtimeAcceptsDestination(value: unknown): boolean {
  try {
    parseMcpOpaqueFlowDestinationConfig(value, {
      PATH: '/usr/bin:/bin',
      CRM_TOKEN: 'synthetic-token',
    });
    return true;
  } catch {
    return false;
  }
}

describe('published MCP configuration schemas', () => {
  it('accepts both shipped examples through JSON Schema and runtime parsing', () => {
    const flowExample = JSON.parse(readFileSync('examples/mcp-opaque-flow.json', 'utf8'));
    const destinationExample = JSON.parse(
      readFileSync('examples/mcp-opaque-destination.json', 'utf8'),
    );

    expect(validateFlow(flowExample), JSON.stringify(validateFlow.errors)).toBe(true);
    expect(runtimeAcceptsFlow(flowExample)).toBe(true);
    expect(
      validateDestination(destinationExample),
      JSON.stringify(validateDestination.errors),
    ).toBe(true);
    expect(runtimeAcceptsDestination(destinationExample)).toBe(true);
  });

  it.each([
    ['unknown flow field', { ...baseFlow, typo: true }],
    ['oversized flow item limit', {
      ...baseFlow,
      flows: [{ ...baseFlow.flows[0], maxItems: 101 }],
    }],
    ['non-primitive fixed predicate', {
      ...baseFlow,
      flows: [{ ...baseFlow.flows[0], fixedWhere: { active: { equals: true } } }],
    }],
  ])('rejects %s in both flow validators', (_name, value) => {
    expect(validateFlow(value)).toBe(false);
    expect(runtimeAcceptsFlow(value)).toBe(false);
  });

  it.each([
    ['unknown destination field', { ...baseDestination, env: { CRM_TOKEN: 'inline' } }],
    ['timeout below minimum', { ...baseDestination, requestTimeoutMs: 99 }],
    ['duplicate environment name', {
      ...baseDestination,
      envAllowlist: ['PATH', 'PATH'],
      sharedEnvAllowlist: ['PATH'],
    }],
  ])('rejects %s in both destination validators', (_name, value) => {
    expect(validateDestination(value)).toBe(false);
    expect(runtimeAcceptsDestination(value)).toBe(false);
  });

  it('keeps semantic overlap checks runtime-authoritative', () => {
    const overlappingWhere = {
      ...baseFlow,
      flows: [{
        ...baseFlow.flows[0],
        allowedWhereFields: ['active'],
      }],
    };
    const invalidSharedEnvironment = {
      ...baseDestination,
      sharedEnvAllowlist: ['UNLISTED_TOKEN'],
    };

    expect(validateFlow(overlappingWhere)).toBe(true);
    expect(runtimeAcceptsFlow(overlappingWhere)).toBe(false);
    expect(validateDestination(invalidSharedEnvironment)).toBe(true);
    expect(runtimeAcceptsDestination(invalidSharedEnvironment)).toBe(false);
  });
});
