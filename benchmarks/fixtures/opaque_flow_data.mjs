import { createHash } from 'node:crypto';

export const rows = Array.from({ length: 200 }, (_, id) => ({
  id,
  segment: id % 5 === 0 ? 'renewal' : 'standard',
  email: `opaque-user-${id}@example.invalid`,
  privateCode: `fixture-private-value-${id}-not-a-credential`,
}));

export const selected = rows
  .filter(({ segment }) => segment === 'renewal')
  .map(({ email }) => ({ email }));

export const rawSource = JSON.stringify(rows);
export const selectedPayload = JSON.stringify(selected);
export const sourceSha256 = createHash('sha256').update(rawSource).digest('hex');
export const selectedSha256 = createHash('sha256').update(selectedPayload).digest('hex');
export const deterministicArtifactId = `vctx_${sourceSha256.slice(0, 32)}`;
export const privateCanaries = rows.flatMap(({ email, privateCode }) => [email, privateCode]);