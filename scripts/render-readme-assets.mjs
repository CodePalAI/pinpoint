import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = join(root, 'benchmarks', 'results', 'direct-anthropic-virtual.json');
const outputPath = join(root, 'assets', 'qcv-paid-pilot.svg');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));

if (receipt.evidenceLevel !== 'live-controlled' || receipt.kind !== 'paid-paired-pilot') {
  throw new Error('unexpected paid-pilot receipt shape');
}

const { summary, methodology, model, generatedAt } = receipt;
const requiredNumbers = [
  summary.directInputTokens,
  summary.pinpointInputTokens,
  summary.directCorrect,
  summary.pinpointCorrect,
  summary.directCostUSD,
  summary.pinpointCostUSD,
  methodology.syntheticCorrectnessTasks,
  methodology.repetitions,
];
if (requiredNumbers.some((value) => !Number.isFinite(value))) {
  throw new Error('paid-pilot receipt is missing a required number');
}

const integer = new Intl.NumberFormat('en-US');
const percent = (summary.inputSavingsFraction * 100).toFixed(1);
const cost = (value) => `$${value.toFixed(6)}`;
const date = new Date(generatedAt).toISOString().slice(0, 10);
const escapeXml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">Pinpoint exact-context before and after</title>
  <desc id="description">Pinpoint kept bulky old tool data local and materialized the exact answer needed next. On two synthetic structured-context tasks with ${escapeXml(model)}, provider-reported input fell from ${integer.format(summary.directInputTokens)} to ${integer.format(summary.pinpointInputTokens)} tokens. Exact score changed from ${summary.directCorrect} of ${methodology.syntheticCorrectnessTasks} to ${summary.pinpointCorrect} of ${methodology.syntheticCorrectnessTasks}.</desc>
  <defs>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#26313d"/>
    </pattern>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect width="1200" height="630" rx="24" fill="#0b0f14"/>
  <rect width="1200" height="630" rx="24" fill="url(#dots)" opacity="0.72"/>

  <text x="64" y="62" fill="#58a6ff" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="18" font-weight="700" letter-spacing="2">PINPOINT</text>
  <rect x="912" y="35" width="224" height="38" rx="19" fill="#11243a" stroke="#2f6fa8"/>
  <text x="1024" y="60" text-anchor="middle" fill="#72b7f2" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" font-weight="700" letter-spacing="1.2">EXACT LOCAL LOOKUP</text>
  <text x="64" y="116" fill="#f4f7fb" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="36" font-weight="750">One answer, not the whole payload.</text>
  <text x="64" y="151" fill="#9da9b6" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">Same question. Same model. ${percent}% less provider input in this controlled pilot.</text>

  <g filter="url(#shadow)">
    <rect x="64" y="190" width="420" height="304" rx="14" fill="#151b23" stroke="#303a46"/>
    <text x="96" y="236" fill="#ffb86b" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="17" font-weight="700" letter-spacing="1.6">WITHOUT PINPOINT</text>
    <text x="96" y="327" fill="#f4f7fb" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="78" font-weight="780">${integer.format(summary.directInputTokens)}</text>
    <text x="99" y="361" fill="#9da9b6" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20">provider input tokens</text>
    <line x1="96" y1="394" x2="452" y2="394" stroke="#303a46"/>
    <text x="96" y="434" fill="#c8d1dc" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">Exact score</text>
    <text x="452" y="434" text-anchor="end" fill="#f4f7fb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">${summary.directCorrect}/${methodology.syntheticCorrectnessTasks}</text>
    <text x="96" y="467" fill="#c8d1dc" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">Modeled cost</text>
    <text x="452" y="467" text-anchor="end" fill="#f4f7fb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">${cost(summary.directCostUSD)}</text>

    <rect x="716" y="190" width="420" height="304" rx="14" fill="#111f1a" stroke="#35d07f" stroke-width="2"/>
    <text x="748" y="236" fill="#35d07f" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="17" font-weight="700" letter-spacing="1.6">WITH PINPOINT</text>
    <text x="748" y="327" fill="#f4f7fb" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="78" font-weight="780">${integer.format(summary.pinpointInputTokens)}</text>
    <text x="751" y="361" fill="#a9b8af" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20">provider input tokens</text>
    <line x1="748" y1="394" x2="1104" y2="394" stroke="#294c3b"/>
    <text x="748" y="434" fill="#c8d1dc" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">Exact score</text>
    <text x="1104" y="434" text-anchor="end" fill="#f4f7fb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">${summary.pinpointCorrect}/${methodology.syntheticCorrectnessTasks}</text>
    <text x="748" y="467" fill="#c8d1dc" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">Modeled cost</text>
    <text x="1104" y="467" text-anchor="end" fill="#f4f7fb" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="20" font-weight="700">${cost(summary.pinpointCostUSD)}</text>
  </g>

  <path d="M516 321 H668 M646 299 L668 321 L646 343" fill="none" stroke="#58a6ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="519" y="363" width="178" height="42" rx="21" fill="#15283d" stroke="#2f6fa8"/>
  <text x="608" y="390" text-anchor="middle" fill="#72b7f2" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="18" font-weight="700">-${percent}% INPUT</text>

  <text x="64" y="550" fill="#9da9b6" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="17">Controlled receipt  |  ${methodology.syntheticCorrectnessTasks} synthetic tasks  |  ${methodology.repetitions} run per task  |  ${escapeXml(model)}  |  ${date}</text>
  <text x="64" y="582" fill="#73808d" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="15">Inspect every input, output, token count, and cost in benchmarks/results/direct-anthropic-virtual.json</text>
</svg>
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, svg);
console.log(`wrote ${outputPath}`);