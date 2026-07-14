import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPixroom } from '../dist/pixroom.js';
import { EVIDENCE } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function jsonLookupTasks() {
  return Array.from({ length: 6 }, (_, offset) => {
    const target = 20 + offset * 7;
    const rows = Array.from({ length: 100 }, (_, id) => ({
      id,
      email: `user${id}@example.com`,
      path: `/srv/accounts/${id}/profile.json`,
      status: id % 3 === 0 ? 'review' : 'active',
      padding: `account-${id}-`.repeat(3),
    }));
    return {
      id: `json-lookup-${offset + 1}`,
      category: 'json-lookup',
      content: JSON.stringify(rows),
      question: `What is the email for id ${target}?`,
      expected: `user${target}@example.com`,
    };
  });
}

function filteredCountTasks() {
  return Array.from({ length: 6 }, (_, offset) => {
    const size = 80 + offset * 5;
    const rows = Array.from({ length: size }, (_, id) => ({
      id,
      active: id % (offset + 2) === 0,
      label: `record-${offset}-${id}`,
      padding: 'count-fixture '.repeat(3),
    }));
    const expected = String(rows.filter((row) => row.active).length);
    return {
      id: `filtered-count-${offset + 1}`,
      category: 'filtered-count',
      content: JSON.stringify(rows),
      question: 'How many records have active is true?',
      expected: `"count":${expected}`,
    };
  });
}

function logCountTasks() {
  const levels = ['ERROR', 'WARN', 'INFO', 'FATAL', 'DEBUG', 'TRACE'];
  return levels.map((level, offset) => {
    const lines = Array.from({ length: 180 }, (_, index) => {
      const selected = index % (offset + 3) === 0 ? level : 'INFO';
      return `2026-07-14T12:${String(index % 60).padStart(2, '0')}:00Z ${selected} worker=${index % 8} job=${index} message=fixture-event`;
    });
    const count = lines.filter((line) => new RegExp(`\\s${level}\\s`).test(line)).length;
    return {
      id: `log-count-${offset + 1}`,
      category: 'log-count',
      content: lines.join('\n'),
      question: `How many lines have level ${level}?`,
      expected: `"count":${count}`,
    };
  });
}

function sourceTasks() {
  return Array.from({ length: 6 }, (_, offset) => {
    const first = `ExportedAlpha${offset}`;
    const second = `ExportedBeta${offset}`;
    const filler = Array.from({ length: 120 }, (_, index) =>
      `function helper${offset}_${index}(value: number): number { return value + ${index}; }`,
    );
    return {
      id: `source-exports-${offset + 1}`,
      category: 'source-code',
      content: [`export class ${first} {}`, ...filler, `export class ${second} {}`].join('\n'),
      question: 'Which classes are exported?',
      expected: second,
    };
  });
}

function tableTasks() {
  return Array.from({ length: 6 }, (_, offset) => {
    const target = 11 + offset * 9;
    const rows = Array.from({ length: 90 }, (_, rowNumber) => ({
      row_number: rowNumber,
      total: `${(rowNumber * 17 + offset).toFixed(2)} USD`,
      owner: `team-${rowNumber % 7}`,
      notes: 'tabular fixture row '.repeat(3),
    }));
    return {
      id: `table-row-${offset + 1}`,
      category: 'table-json',
      content: JSON.stringify(rows),
      question: `What is the total for row_number ${target}?`,
      expected: rows[target].total,
    };
  });
}

function nestedProjectionTasks() {
  return Array.from({ length: 6 }, (_, offset) => {
    const target = 13 + offset * 8;
    const rows = Array.from({ length: 90 }, (_, id) => ({
      id,
      profile: {
        email: `nested${id}@example.com`,
        region: `region-${id % 5}`,
      },
      padding: 'nested projection fixture '.repeat(3),
    }));
    return {
      id: `nested-projection-${offset + 1}`,
      category: 'nested-projection',
      content: JSON.stringify(rows),
      question: `What is the profile for id ${target}?`,
      expected: `nested${target}@example.com`,
    };
  });
}

function tasks() {
  return [
    ...jsonLookupTasks(),
    ...filteredCountTasks(),
    ...logCountTasks(),
    ...sourceTasks(),
    ...tableTasks(),
    ...nestedProjectionTasks(),
  ];
}

function refusalTasks() {
  const rows = Array.from({ length: 80 }, (_, id) => ({
    id,
    email: `user${id}@example.com`,
    padding: 'adversarial refusal fixture '.repeat(3),
  }));
  const ambiguous = [
    'What is email for id 1 or id 2?',
    'What is email for id 1 and id 2?',
    'What is email for id not 1?',
    'What is email for id between 1 and 2?',
    'What is email for id > 1?',
    'What is email for id from 1 through 2?',
  ].map((question, index) => ({
    id: `refuse-ambiguous-${index + 1}`,
    category: 'ambiguous-selector',
    contents: [JSON.stringify(rows)],
    question,
  }));
  const multiple = Array.from({ length: 6 }, (_, index) => ({
    id: `refuse-multi-dataset-${index + 1}`,
    category: 'multiple-datasets',
    contents: [
      JSON.stringify(rows.map((row) => ({ ...row, email: `a${row.id}@example.com` }))),
      JSON.stringify(rows.map((row) => ({ ...row, email: `b${row.id}@example.com` }))),
    ],
    question: `What is email for id ${10 + index}?`,
  }));
  return [...ambiguous, ...multiple];
}

function prefetchPayload(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const content = Array.isArray(messages[messageIndex]?.content) ? messages[messageIndex].content : [];
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      const match = /<pixroom_exact_prefetch>\n([^\n]+)\n<\/pixroom_exact_prefetch>/.exec(block.text);
      if (match?.[1]) return JSON.parse(match[1]);
    }
  }
  return undefined;
}

async function main() {
  const runtime = createPixroom({
    virtualContext: { enabled: true, queryFallback: false, minChars: 100, protectRecent: 0 },
    semantic: { enabled: false },
    optical: { enabled: false },
    logLevel: 'silent',
  });
  const results = [];
  const negativeResults = [];
  try {
    for (const task of tasks()) {
      const routed = await runtime.route(
        'anthropic',
        'claude-haiku-4-5',
        {
          model: 'claude-haiku-4-5',
          messages: [
            { role: 'assistant', content: [{ type: 'tool_use', id: `tool_${task.id}`, name: 'read_data', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool_${task.id}`, content: task.content }] },
            { role: 'user', content: task.question },
          ],
        },
        'payg',
      );
      const serialized = JSON.stringify(routed.body);
      const materialized = JSON.stringify(prefetchPayload(routed.body));
      const row = routed.report.rows.find((candidate) => candidate.stage === 'virtual');
      results.push({
        id: task.id,
        category: task.category,
        exact: materialized.includes(task.expected),
        virtualized: routed.virtualized,
        fallbackInjected: serialized.includes('pixroom_query'),
        tokensText: row?.tokensText ?? 0,
        tokensCompressed: row?.tokensCompressed ?? 0,
        tokensSaved: row?.tokensSaved ?? 0,
      });
    }
    for (const task of refusalTasks()) {
      const routed = await runtime.route(
        'anthropic',
        'claude-haiku-4-5',
        {
          model: 'claude-haiku-4-5',
          messages: [
            ...task.contents.flatMap((content, index) => [
              { role: 'assistant', content: [{ type: 'tool_use', id: `tool_${task.id}_${index}`, name: 'read_data', input: {} }] },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool_${task.id}_${index}`, content }] },
            ]),
            { role: 'user', content: task.question },
          ],
        },
        'payg',
      );
      negativeResults.push({
        id: task.id,
        category: task.category,
        refused: !routed.virtualized,
        fallbackInjected: JSON.stringify(routed.body).includes('pixroom_query'),
      });
    }
  } finally {
    await runtime.shutdown();
  }

  const categories = [...new Set(results.map((result) => result.category))];
  const artifact = {
    schemaVersion: 1,
    evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
    generatedAt: new Date().toISOString(),
    methodology: {
      providerCalls: 0,
      modelQuality: 'not measured; deterministic exact materialization only',
      categories,
      negativeCategories: [...new Set(negativeResults.map((result) => result.category))],
    },
    summary: {
      tasks: results.length,
      exact: results.filter((result) => result.exact).length,
      virtualized: results.filter((result) => result.virtualized).length,
      fallbackInjected: results.filter((result) => result.fallbackInjected).length,
      tokensText: results.reduce((total, result) => total + result.tokensText, 0),
      tokensCompressed: results.reduce((total, result) => total + result.tokensCompressed, 0),
      tokensSaved: results.reduce((total, result) => total + result.tokensSaved, 0),
      negativeControls: negativeResults.length,
      refused: negativeResults.filter((result) => result.refused).length,
    },
    results,
    negativeResults,
    verdict: {
      atLeastThirtyTasks: results.length >= 30,
      sixCategories: categories.length >= 6,
      allExact: results.every((result) => result.exact),
      allVirtualized: results.every((result) => result.virtualized),
      noFallback: results.every((result) => !result.fallbackInjected),
      allNegativeControlsRefused: negativeResults.every(
        (result) => result.refused && !result.fallbackInjected,
      ),
    },
  };
  mkdirSync(join(here, 'results'), { recursive: true });
  const path = join(here, 'results', 'qcv-quality.json');
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact.summary));
  console.log(`VERDICT ${JSON.stringify(artifact.verdict)}`);
  console.log(`wrote ${path}`);
  if (Object.values(artifact.verdict).some((value) => !value)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});