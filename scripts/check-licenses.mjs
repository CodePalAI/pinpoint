import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
]);
const dependencies = [];
const failures = [];

for (const [path, metadata] of Object.entries(packageLock.packages ?? {})) {
  if (!path || metadata.dev === true || metadata.devOptional === true) continue;
  const name = metadata.name ?? path.replace(/^node_modules\//, '');
  const license = metadata.license;
  dependencies.push({ name, version: metadata.version, license });
  if (typeof license !== 'string' || !allowedLicenses.has(license)) {
    failures.push(`${name}@${metadata.version ?? 'unknown'} declares ${license ?? 'no license'}`);
  }
}

if (failures.length > 0) {
  console.error(`production license check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

dependencies.sort((left, right) => left.name.localeCompare(right.name));
console.log(
  `production licenses: ok (${dependencies.map(({ name, version, license }) => `${name}@${version} ${license}`).join(', ')})`,
);
