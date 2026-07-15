import { describe, it, expect } from 'vitest';
import { classifyAuthMode, isStealth } from '../src/proxy/auth-mode.js';

describe('classifyAuthMode', () => {
  it('classifies subscription by User-Agent', () => {
    expect(classifyAuthMode({ 'user-agent': 'claude-code/1.2.3 (external)' })).toBe('subscription');
    expect(classifyAuthMode({ 'user-agent': 'GitHubCopilotChat github-copilot/0.35' })).toBe(
      'subscription',
    );
    expect(classifyAuthMode({ 'user-agent': 'codex-cli/2.0' })).toBe('subscription');
  });

  it('classifies Claude Pro/Max OAuth (sk-ant-oat*) as oauth', () => {
    expect(classifyAuthMode({ authorization: 'Bearer sk-ant-oat01-abc123' })).toBe('oauth');
  });

  it('classifies API keys as payg', () => {
    expect(classifyAuthMode({ authorization: 'Bearer sk-ant-api03-xyz' })).toBe('payg');
    expect(classifyAuthMode({ authorization: 'Bearer sk-proj-openai' })).toBe('payg');
    expect(classifyAuthMode({ 'x-api-key': 'sk-ant-anything' })).toBe('payg');
    expect(classifyAuthMode({ 'x-goog-api-key': 'AIza...' })).toBe('payg');
  });

  it('classifies a JWT bearer (codex/cursor/copilot OAuth) as oauth', () => {
    expect(classifyAuthMode({ authorization: 'Bearer header.payload.signature' })).toBe('oauth');
  });

  it('classifies a non-Bearer Authorization (AWS SigV4) as oauth', () => {
    expect(classifyAuthMode({ authorization: 'AWS4-HMAC-SHA256 Credential=AKIA/...' })).toBe(
      'oauth',
    );
  });

  it('defaults to payg when nothing matches', () => {
    expect(classifyAuthMode({})).toBe('payg');
  });

  it('lets an explicit API key override an agent User-Agent', () => {
    expect(
      classifyAuthMode({ 'user-agent': 'claude-code/1', authorization: 'Bearer sk-ant-api03-x' }),
    ).toBe('payg');
    expect(
      classifyAuthMode({ 'user-agent': 'claude-code/1', 'x-api-key': 'sk-ant-api03-x' }),
    ).toBe('payg');
    expect(
      classifyAuthMode({ 'user-agent': 'codex-cli/1', authorization: 'Bearer sk-proj-openai' }),
    ).toBe('payg');
  });

  it('keeps OAuth agent traffic in stealth mode', () => {
    expect(
      classifyAuthMode({ 'user-agent': 'claude-code/1', authorization: 'Bearer sk-ant-oat01-x' }),
    ).toBe('oauth');
    expect(
      classifyAuthMode({ 'user-agent': 'codex-cli/1', authorization: 'Bearer a.b.c' }),
    ).toBe('oauth');
  });

  it('is case-insensitive on header names', () => {
    expect(classifyAuthMode({ 'User-Agent': 'claude-code/1' })).toBe('subscription');
    expect(classifyAuthMode({ Authorization: 'Bearer sk-ant-oat01-x' })).toBe('oauth');
  });

  it('isStealth is true for everything but payg', () => {
    expect(isStealth('payg')).toBe(false);
    expect(isStealth('oauth')).toBe(true);
    expect(isStealth('subscription')).toBe(true);
  });
});
