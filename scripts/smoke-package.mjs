import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-package-smoke-'));
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const publicEntries = [
  '@codepal/pinpoint',
  '@codepal/pinpoint/anthropic',
  '@codepal/pinpoint/openai',
  '@codepal/pinpoint/sdk',
  '@codepal/pinpoint/proxy',
  '@codepal/pinpoint/router',
  '@codepal/pinpoint/kernel',
  '@codepal/pinpoint/protocols',
  '@codepal/pinpoint/output',
  '@codepal/pinpoint/agents',
  '@codepal/pinpoint/virtual-context',
  '@codepal/pinpoint/capture',
  '@codepal/pinpoint/telemetry',
];

try {
  const packed = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root),
  );
  const artifact = packed[0];
  if (!artifact || artifact.name !== '@codepal/pinpoint') {
    throw new Error('npm pack returned the wrong package identity');
  }
  const paths = new Set((artifact.files ?? []).map((file) => file.path));
  for (const required of ['README.md', 'CODE_OF_CONDUCT.md', 'LICENSE', 'NOTICE', 'bin/cli.js']) {
    if (!paths.has(required)) throw new Error(`packed artifact is missing ${required}`);
  }

  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    join(temporary, artifact.filename),
  ]);

  const runtimeScript = [
    `const entries = ${JSON.stringify(publicEntries)};`,
    'for (const entry of entries) await import(entry);',
    'console.log(`imported ${entries.length} public entry points`);',
  ].join('\n');
  run(process.execPath, ['--input-type=module', '--eval', runtimeScript]);

  const bindings = publicEntries.map((entry, index) => `import * as entry${index} from '${entry}';`);
  bindings.push(`void [${publicEntries.map((_, index) => `entry${index}`).join(', ')}];`);
  writeFileSync(join(temporary, 'smoke.mts'), `${bindings.join('\n')}\n`);
  run(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--strict',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'smoke.mts',
  ]);

  const cli = join(temporary, 'node_modules', '@codepal', 'pinpoint', 'bin', 'cli.js');
  if (run(process.execPath, [cli, '--version']).trim() !== artifact.version) {
    throw new Error('installed CLI version does not match the packed version');
  }
  run(process.execPath, [cli, '--help']);
  const demo = run(process.execPath, [cli, 'demo']);
  for (const expected of ['exact answer materialized: user733@example.com', 'network requests: 0']) {
    if (!demo.includes(expected)) throw new Error(`installed demo is missing: ${expected}`);
  }

  console.log(
    `package smoke: ok (${artifact.name}@${artifact.version}, ${publicEntries.length} exports, ${paths.size} files)`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
