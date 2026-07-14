# Releasing

Releases are automatic: **bump `version` in `package.json`, merge to `main`.** CI publishes it.
Every other commit to `main` reaches the publish job and no-ops, because the version is already on
npm.

Authentication is **npm trusted publishing (OIDC)** — GitHub mints a short-lived token for the run.
There is no `NPM_TOKEN`, and no secret to leak or rotate.

## One-time setup

Trusted publishing cannot be configured for a package that does not exist yet, so the first release
is bootstrapped by hand. Three steps, once.

**1. Publish once manually.**

```bash
npm login
npm run build
npm publish --access public
```

**2. Register the trusted publisher** on npmjs.com → the package → *Settings* → *Trusted publisher*:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization | `deepvariance` |
| Repository | `vscode-extension` |
| Workflow filename | `ci.yml` |
| Environment | *(leave empty)* |

`repository.url` in `package.json` must match this repo exactly, or npm rejects the OIDC token.

**3. Switch CI over:**

```bash
gh variable set NPM_TRUSTED_PUBLISHING --body true --repo deepvariance/vscode-extension
```

From then on, every version bump merged to `main` publishes itself.

## Notes

- **A `404` on publish is almost always auth**, not a missing package: npm returns 404 when it can't
  match the run to a trusted publisher. Check the org, repo, and workflow filename character for
  character.
- **No provenance while the repo is private.** npm does not attest builds from private repos, even
  for public packages. Flip the repo public and provenance is generated automatically — no flag
  needed.
- Requires npm ≥ 11.5.1; `setup-node` ships npm 10.x, so CI upgrades it in the job.

## What ships

Bundles only — no source, no sourcemaps, zero runtime dependencies. CI fails if any leak in.

```
package.json   README.md   dist/cli.js (minified)   extension/*.vsix (minified)
```

**Bump `extension/package.json` and re-run `npm run build:extension` whenever the extension
changes** — VS Code will not reinstall an unchanged version, and CI fails if the committed `.vsix`
doesn't match.
