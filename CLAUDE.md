# Working in this repo

## Branch and PR — never push to `main`

Every change goes on a branch and lands via PR that a maintainer reviews and merges. **Do not commit
to `main` or merge your own PR.**

```bash
git switch -c fix/<slug>      # or feature/<slug>, change/<slug>
# …commit…
gh pr create --base main --fill
# stop here — report the PR URL and wait for review
```

**Why it matters here:** `main` is the release branch. A push to `main` runs the CI publish job and
ships to npm via trusted publishing (see [SPEC.md](./SPEC.md#publish--release)). A direct commit is a
release with no review gate.

Branch prefixes: `fix/`, `feature/`, `change/`.

## Before opening a PR

```bash
npm test                    # CLI (18)
cd extension && npm test    # provider (11)
```

If you touched `extension/`, bump `extension/package.json` and rebuild the committed `.vsix`
(`npm run build:extension`) — CI fails if it drifts, and VS Code won't reinstall an unchanged
version. Releasing the CLI is a `version` bump in `package.json`; CI publishes it on merge to `main`.

## The rest

[SPEC.md](./SPEC.md) is the single source of truth: the gateway contract, the VS Code constraints
that rule out the obvious designs, a change recipe per kind of edit, and a bug ledger. Read the
relevant section before changing how the model reaches VS Code.
