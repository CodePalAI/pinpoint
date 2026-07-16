import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('SBOM generation must run through npm so npm_execpath is available');

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !args[1]) {
  throw new TypeError('usage: npm run sbom -- --out <path>');
}
const outputPath = resolve(root, args[1]);

const raw = execFileSync(
  process.execPath,
  [npmCli, 'sbom', '--omit=dev', '--sbom-format', 'cyclonedx'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const sbom = JSON.parse(raw);
const expectedRef = `${packageJson.name}@${packageJson.version}`;
const expectedPurl = `pkg:npm/%40codepal/pinpoint@${packageJson.version}`;
const releaseDate = new RegExp(
  `^## ${packageJson.version.replaceAll('.', '\\.')} - (\\d{4}-\\d{2}-\\d{2})$`,
  'm',
).exec(changelog)?.[1];

if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.5') {
  throw new Error('npm emitted an unsupported CycloneDX document');
}
if (!releaseDate) throw new Error(`CHANGELOG.md is missing a dated ${packageJson.version} release`);
if (sbom.metadata?.component?.['bom-ref'] !== expectedRef) {
  throw new Error('SBOM root bom-ref does not match the package identity');
}
if (sbom.metadata.component.purl !== expectedPurl) {
  throw new Error('SBOM root purl does not match the package identity');
}
if (sbom.metadata.component.version !== packageJson.version) {
  throw new Error('SBOM root version does not match package.json');
}

delete sbom.serialNumber;
sbom.metadata.timestamp = `${releaseDate}T00:00:00.000Z`;
sbom.metadata.component.name = packageJson.name;
sbom.components?.sort((left, right) =>
  String(left['bom-ref'] ?? left.purl ?? left.name).localeCompare(
    String(right['bom-ref'] ?? right.purl ?? right.name),
  ));
sbom.dependencies?.sort((left, right) => String(left.ref).localeCompare(String(right.ref)));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM: ${packageJson.name}@${packageJson.version} -> ${outputPath}`);
