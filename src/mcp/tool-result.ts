function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export const MAX_MCP_TOOL_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_MCP_TOOL_RESULT_DEPTH = 64;
const MAX_MCP_TOOL_RESULT_NODES = 100_000;
const MAX_MCP_TOOL_RESULT_COLLECTION_ITEMS = 100_000;
const MAX_MCP_TOOL_RESULT_STRING_BYTES = 8 * 1024 * 1024;

function hasBoundedJsonShape(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let collectionItems = 0;
  let stringBytes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_MCP_TOOL_RESULT_NODES || current.depth > MAX_MCP_TOOL_RESULT_DEPTH) return false;
    if (typeof current.value === 'string') {
      stringBytes += Buffer.byteLength(current.value);
      if (stringBytes > MAX_MCP_TOOL_RESULT_STRING_BYTES) return false;
      continue;
    }
    if (
      current.value == null ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isFinite(current.value))
    ) continue;
    if (typeof current.value !== 'object') return false;
    if (seen.has(current.value)) return false;
    seen.add(current.value);
    const remainingItems = MAX_MCP_TOOL_RESULT_COLLECTION_ITEMS - collectionItems;
    if (Array.isArray(current.value)) {
      if (current.value.length > remainingItems) return false;
      collectionItems += current.value.length;
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    let ownKeys = 0;
    const record = current.value as Record<string, unknown>;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      ownKeys += 1;
      if (ownKeys > remainingItems) return false;
      stringBytes += Buffer.byteLength(key);
      if (stringBytes > MAX_MCP_TOOL_RESULT_STRING_BYTES) return false;
      stack.push({ value: record[key], depth: current.depth + 1 });
    }
    collectionItems += ownKeys;
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' && Buffer.byteLength(serialized) <= MAX_MCP_TOOL_RESULT_BYTES;
  } catch {
    return false;
  }
}

export function isValidMcpCallToolResult(value: unknown): value is {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
} {
  return isRecord(value) &&
    Array.isArray(value.content) &&
    value.content.length <= 4_096 &&
    value.content.every((block) => isRecord(block) && typeof block.type === 'string') &&
    (value.isError === undefined || typeof value.isError === 'boolean') &&
    hasBoundedJsonShape(value);
}