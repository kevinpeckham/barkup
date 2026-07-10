# Releasing

Publishing runs in CI via npm trusted publishing (OIDC, tokenless,
automatic provenance — see `.github/workflows/release.yml`). Pushing a
`v*` tag is the publish; there is no local `npm publish` and no
credentials to handle.

1. `bun test` — all green (unit + property suites).
2. `bun run check` && `bun run lint` && `bun run audit` — clean.
3. Bump `version` in package.json (semver; the surface is stable —
   patch/minor only unless a guarantee changes, which it shouldn't).
4. Update README if behavior-visible.
5. `bun run build` then `npm publish --dry-run` — inspect the tarball
   contents (every subpath entry's `dist/*.js` + `.d.ts` present).
6. Commit and push `main`; wait for CI to pass.
7. `git tag v<version> && git push origin v<version>` — the Release
   workflow re-runs check/test/build and publishes to npm.
8. Verify: watch the workflow to completion
   (`gh run watch --repo kevinpeckham/barkup`), then
   `npm view @kevinpeckham/barkup version` and install into a scratch
   project.

If the workflow fails after the tag is pushed, fix on `main`, bump the
version again, and cut a fresh tag — never move or reuse a published
tag.
