import { setTimeout as delay } from 'node:timers/promises';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeStatement(attestation) {
  const payload = attestation?.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== 'string') throw new Error('npm provenance DSSE payload is missing');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

async function fetchJson(url, attempts = 12) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    lastStatus = response.status;
    if (response.ok) return response.json();
    if (response.status !== 404 || attempt === attempts) {
      throw new Error(`registry request failed with HTTP ${response.status}: ${url}`);
    }
    await delay(5_000);
  }
  throw new Error(`registry request failed with HTTP ${lastStatus}: ${url}`);
}

const packageName = required('PACKAGE_NAME');
const packageVersion = required('PACKAGE_VERSION');
const expectedIntegrity = required('EXPECTED_INTEGRITY');
const expectedRepository = required('EXPECTED_REPOSITORY');
const expectedWorkflow = required('EXPECTED_WORKFLOW');
const expectedRef = required('EXPECTED_REF');
const expectedCommit = required('EXPECTED_COMMIT');
const encodedName = packageName.replace('/', '%2f');
const metadataUrl = `https://registry.npmjs.org/${encodedName}/${packageVersion}`;
const attestationsUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${encodedName}@${packageVersion}`;
const metadata = await fetchJson(metadataUrl);
if (metadata?.dist?.integrity !== expectedIntegrity) {
  throw new Error('published npm integrity does not match the verified tarball');
}

const attestations = await fetchJson(attestationsUrl);
const provenance = attestations?.attestations?.find(
  (entry) => entry?.predicateType === 'https://slsa.dev/provenance/v1',
);
if (!provenance) throw new Error('published npm SLSA provenance is missing');
const statement = decodeStatement(provenance);
const expectedPurl = `pkg:npm/${packageName.replace('@', '%40')}@${packageVersion}`;
const expectedSha512 = Buffer.from(expectedIntegrity.replace(/^sha512-/, ''), 'base64').toString('hex');
if (
  statement?._type !== 'https://in-toto.io/Statement/v1' ||
  !Array.isArray(statement.subject) ||
  statement.subject.length !== 1 ||
  statement.subject[0]?.name !== expectedPurl ||
  statement.subject[0]?.digest?.sha512 !== expectedSha512
) {
  throw new Error('published npm provenance subject does not match the verified tarball');
}
const definition = statement.predicate?.buildDefinition;
const workflow = definition?.externalParameters?.workflow;
if (
  definition?.buildType !== 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1' ||
  workflow?.repository !== expectedRepository ||
  workflow?.path !== expectedWorkflow ||
  workflow?.ref !== expectedRef
) {
  throw new Error('published npm provenance workflow identity is invalid');
}
const dependency = definition?.resolvedDependencies?.find(
  (entry) => entry?.uri === `git+${expectedRepository}@${expectedRef}`,
);
if (dependency?.digest?.gitCommit !== expectedCommit) {
  throw new Error('published npm provenance Git commit is invalid');
}
console.log(`npm provenance binding: ok (${packageName}@${packageVersion}, ${expectedRef}, ${expectedCommit})`);
