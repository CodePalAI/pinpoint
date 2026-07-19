import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const allowedSigners = readFileSync(
  join(root, '.github', 'release-allowed-signers'),
  'utf8',
).trim().split('\n').filter((line) => line && !line.startsWith('#'));
const failures = [];
const fail = (message) => failures.push(message);

if (packageJson.name !== '@codepalaiorg/pinpoint') fail('package name must remain @codepalaiorg/pinpoint');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  fail(`package version is not valid semver: ${packageJson.version}`);
}
if (packageLock.packages?.['']?.version !== packageJson.version) {
  fail('package-lock root version does not match package.json');
}
if (packageJson.repository?.url !== 'git+https://github.com/CodePalAI/pinpoint.git') {
  fail('package repository URL must exactly match the public GitHub repository');
}
if (packageJson.publishConfig?.access !== 'public' || packageJson.publishConfig?.provenance !== true) {
  fail('publishConfig must require public access and provenance');
}
if (packageJson.types !== './dist/index.d.ts') fail('package root types must point to dist/index.d.ts');
if (packageJson.sideEffects !== false) fail('package must declare sideEffects=false');
if (packageJson.engines?.node !== '>=22') fail('Node.js support floor must remain >=22');
for (const script of ['licenses:check', 'sbom', 'supply-chain:check', 'verify', 'verify:release', 'publish:state-check']) {
  if (typeof packageJson.scripts?.[script] !== 'string') fail(`missing npm script: ${script}`);
}

const escapedVersion = packageJson.version.replaceAll('.', '\\.');
const releaseHeadings = [...changelog.matchAll(new RegExp(
  `^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`,
  'gm',
))];
if (releaseHeadings.length !== 1) {
  fail(`CHANGELOG.md must contain exactly one dated ${packageJson.version} heading`);
}
if (changelog.indexOf('## Unreleased') > changelog.search(new RegExp(`^## ${escapedVersion} - `, 'm'))) {
  fail('CHANGELOG.md must keep Unreleased before the current version');
}

const npmStatus = [...readme.matchAll(/<!-- PINPOINT_NPM_STATUS: (unpublished|development|candidate|published) -->/g)];
if (npmStatus.length !== 1) fail('README must declare exactly one PINPOINT_NPM_STATUS marker');

const expectedSigner =
  'support@codepal.ai ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC4+5/QM467ySbaXkdnDlRPnXICgHzZ51sACs60e27zM CodePal release signer';
if (allowedSigners.length !== 1 || allowedSigners[0] !== expectedSigner) {
  fail('release allowed-signers policy does not match the reviewed CodePal key');
}
for (const required of [
  'git verify-tag "$RELEASE_TAG"',
  'test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"',
  'test "$GITHUB_SHA" = "$TAG_COMMIT"',
  'npm run sbom',
  'npm run verify:release',
  'PINPOINT_PACKAGE_SMOKE_OUT="$PWD/release/codepalaiorg-pinpoint-$PACKAGE_VERSION.tgz"',
  'Verify retained release artifact',
  'git ls-files --others --exclude-standard',
  'overwrite: true',
  'npm run formal:opaque-flow:async',
  'npx playwright install --with-deps chromium',
  'npm run test:dashboard:e2e',
  'test "$NPM_USER" = "codepalaiorg"',
  'Verify published provenance',
  'node scripts/verify-npm-provenance.mjs',
  'audit signatures',
  'EXPECTED_REF="refs/tags/$RELEASE_TAG"',
  'EXPECTED_COMMIT=$(git rev-list -n 1 "$RELEASE_TAG")',
  'RELEASE_ID=$(gh api --paginate',
  'releases/$RELEASE_ID/assets',
  'releases/assets/$ASSET_ID',
  'releases/$RELEASE_ID" \\',
  '-F draft=false',
  'find "$PWD/release"',
  'UPLOAD_URL=$(gh api',
  '--data-binary "@$ASSET"',
  'contents: write',
  'Resolve protected draft release',
  'printf \'%s\\n\' "$RELEASE_ID" > release/RELEASE_ID',
  'test "$(find release -maxdepth 1 -name \'codepalaiorg-pinpoint-*.tgz\' | wc -l)" -eq 1',
  'NPM_AUTH_MODE',
  "environment: release",
]) {
  if (!releaseWorkflow.includes(required)) fail(`release workflow is missing: ${required}`);
}
if (releaseWorkflow.includes('npm pack')) fail('release workflow must publish the exact package-smoke tarball without repacking');
if (!readFileSync(join(root, 'scripts', 'verify-npm-provenance.mjs'), 'utf8').includes('https://slsa.dev/provenance/v1')) {
  fail('npm provenance verifier must require SLSA provenance');
}
if (!String(packageJson.scripts?.prepublishOnly ?? '').includes('npm run publish:state-check')) {
  fail('prepublishOnly must enforce publish:state-check');
}

if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${packageJson.version}`) {
  fail(`RELEASE_TAG must equal v${packageJson.version}`);
}
if (process.env.RELEASE_TAG && ['unpublished', 'development'].includes(npmStatus[0]?.[1])) {
  fail('a tagged release must use candidate or published npm README status');
}

if (failures.length > 0) {
  console.error(`release check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `release check: ok (${packageJson.name}@${packageJson.version}, npm=${npmStatus[0][1]}, signer pinned)`,
);
