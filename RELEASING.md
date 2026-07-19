# Releasing Pinpoint

Only maintainers named in [MAINTAINERS.md](./MAINTAINERS.md) publish releases.
Release tags and npm versions are immutable; fix a failed candidate with a new patch
version rather than moving a tag or replacing a registry artifact.

## Prepare the candidate

1. Start from a clean `main` commit whose required CI checks passed.
2. Update the version in `package.json` and `package-lock.json`.
3. Move all relevant changelog entries under `## <version> - YYYY-MM-DD`.
4. Change `PINPOINT_NPM_STATUS` in `README.md` from `unpublished` to `candidate`
  and make the verified npm install commands primary. Keep a source-checkout fallback.
5. Update receipt fingerprints or generated README assets when their source changed.
6. Run the complete local gates:

```bash
PINPOINT_HEADROOM_AUTOSPAWN=0 PINPOINT_LOG=silent npm run verify:release
npm run formal:opaque-flow
npm run formal:opaque-flow:mutation
git diff --check
```

`npm run verify:release` runs the manifest and release preflight, dependency audit,
documentation/receipt synchronization, strict typecheck, full tests, clean build, and
packed-consumer smoke. The package smoke enforces explicit file-count and byte budgets.
Before signing, `git status --short` and `git diff --check` must both be empty.

## Sign and publish

Create an annotated SSH-signed tag with the reviewed CodePal release key:

```bash
git tag -s "v$(node -p "require('./package.json').version")" \
  -m "Pinpoint v$(node -p "require('./package.json').version")"
git verify-tag "v$(node -p "require('./package.json').version")"
git push origin "v$(node -p "require('./package.json').version")"
```

Create a draft GitHub Release from that exact tag, then dispatch the release workflow
on the tag ref:

```bash
TAG="v$(node -p "require('./package.json').version")"
gh release create "$TAG" --verify-tag --draft --generate-notes --title "Pinpoint $TAG"
gh workflow run release.yml --ref "$TAG" -f tag="$TAG" -f auth_mode=token
```

Use `auth_mode=oidc` after trusted publishing is configured. The protected `release`
environment requires approval, rebuilds one checksummed tarball from the tag, verifies
the pinned tag signer, publishes npm, attaches immutable assets, and only then publishes
the GitHub Release.

Manual workflow dispatch requires an explicit `auth_mode` choice:

- `token`: bootstrap-only mode for the first registry publication; requires the
  environment secret `NPM_TOKEN`. The workflow requires `npm whoami` to return
  the user `codepalaiorg`, which owns the `@codepalaiorg` package scope.
- `oidc`: normal mode after npm Trusted Publisher is configured for organization
  `CodePalAI`, repository `pinpoint`, workflow `release.yml`, environment `release`,
  and action `npm publish`. This mode uses no long-lived npm token.

After the first OIDC release succeeds, set npm publishing access to require 2FA and
disallow tokens, then remove `NPM_TOKEN` from GitHub.

After the first npm release is confirmed, change the README marker from `candidate`
to `published` in the next reviewed commit. The npm tarball already contains the
release-ready commands; the marker itself is hidden metadata for repository checks.

The workflow attaches the exact npm tarball, CycloneDX production SBOM, package
integrity, and SHA-512 checksums to the GitHub Release. Reruns compare existing assets
byte-for-byte and refuse to replace them.

## Verify the publication

From a clean environment, confirm identity, integrity, provenance, and runtime behavior:

```bash
npm view @codepalaiorg/pinpoint version repository.url dist.integrity
npm audit signatures
npx --yes @codepalaiorg/pinpoint@<version> --version
npx --yes @codepalaiorg/pinpoint@<version> demo
```

Compare the registry `dist.integrity` with the release workflow artifact. Preserve the
GitHub Release, workflow URL, package integrity, provenance link, failures, and any
manual recovery steps in the release record.
