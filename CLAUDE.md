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
ships to npm via trusted publishing (see [SPEC.md](./SPEC.md#7-release--publishing)). A direct commit is a
release with no review gate.

Branch prefixes: `fix/`, `feature/`, `change/`.

## Before opening a PR

```bash
npm test                    # CLI (21)
cd extension && npm test    # provider (12)
```

If you touched `extension/`, bump `extension/package.json` and rebuild the committed `.vsix`
(`npm run build:extension`) — CI fails if the committed bytes drift from source, and VS Code won't
reinstall an unchanged version. **Also bump the root `package.json` version**: the publish gate keys
off the *root* version, so an extension-only change with no root bump ships nothing to npm and your
provider work never reaches users. Releasing is a root `version` bump; CI publishes it on merge to
`main`.

## The rest

[SPEC.md](./SPEC.md) is the single source of truth: the gateway contract, the VS Code constraints
that rule out the obvious designs, a change recipe per kind of edit, and a bug ledger. Read the
relevant section before changing how the model reaches VS Code.
