import { estimateTokens } from '@codepalaiorg/pinpoint';

function compactJson(text) {
  try {
    const value = JSON.parse(text);
    if (value == null || typeof value !== 'object') return undefined;
    const compact = JSON.stringify(value);
    return compact.length < text.length ? compact : undefined;
  } catch {
    return undefined;
  }
}

function minifyBody(source) {
  const body = structuredClone(source);
  let changed = false;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const message of messages) {
    if (message == null || typeof message !== 'object') continue;
    if (message.role === 'tool' && typeof message.content === 'string') {
      const compact = compactJson(message.content);
      if (compact) {
        message.content = compact;
        changed = true;
      }
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (block?.type !== 'tool_result' || typeof block.content !== 'string') continue;
      const compact = compactJson(block.content);
      if (compact) {
        block.content = compact;
        changed = true;
      }
    }
  }
  const input = Array.isArray(body.input) ? body.input : [];
  for (const item of input) {
    if (item?.type !== 'function_call_output' || typeof item.output !== 'string') continue;
    const compact = compactJson(item.output);
    if (compact) {
      item.output = compact;
      changed = true;
    }
  }
  return changed ? body : undefined;
}

/** Example deterministic optimizer for whitespace-heavy JSON tool output. */
export function createJsonToolMinifierIntegration() {
  return {
    id: 'example.json-tool-minifier',
    version: '1.0.0',
    order: 2,
    capabilities: {
      regions: ['tool-result'],
      fidelity: 'lossless',
      cacheImpact: 'preserve',
    },
    async propose(ctx) {
      const body = minifyBody(ctx.body);
      const before = JSON.stringify(ctx.body);
      const after = body ? JSON.stringify(body) : before;
      return {
        id: `example.json-tool-minifier:${ctx.stages.length}`,
        integrationId: this.id,
        regions: body ? ['tool-result'] : [],
        fidelity: this.capabilities.fidelity,
        cacheImpact: this.capabilities.cacheImpact,
        estimate: {
          tokensBefore: estimateTokens(before),
          tokensAfter: estimateTokens(after),
          basis: 'estimate',
        },
        patch: { replaceBody: body },
      };
    },
  };
}