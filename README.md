<h1 align="center">deepvariance-vscode</h1>

<p align="center">
  <strong>Qwen3.5 27B in VS Code's built-in Chat. One command. No key to paste.</strong>
</p>

<p align="center">
  <a href="https://github.com/deepvariance/vscode-extension/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/deepvariance/vscode-extension/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@deepvariance/vscode"><img alt="npm" src="https://img.shields.io/npm/v/%40deepvariance%2Fvscode?color=cb3837&logo=npm"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
  <img alt="vscode" src="https://img.shields.io/badge/vscode-%E2%89%A51.104-007ACC?logo=visualstudiocode&logoColor=white">
  <img alt="status" src="https://img.shields.io/badge/status-beta-orange">
</p>

---

```bash
npx @deepvariance/vscode
```

Asks for your email. Nothing else. Then quit and reopen VS Code and pick **Qwen3.5 27B** in the Chat
model picker.

<p align="center"><code>health check → register key → install provider → hand off key → enable thinking</code></p>

## Features

| | |
|---|---|
| 🧠 **Thinking** | Streams the model's reasoning into a collapsible block |
| 🛠️ **Tool calling** | Works in Chat agent mode |
| 🖼️ **Vision** | Attach a screenshot or diagram (max 4 images per prompt) |
| 📜 **131k context** | `max_model_len` straight from the gateway |
| 🔑 **No key pasting** | The key goes to VS Code's SecretStorage, never a config file |
| 🚦 **Health gated** | Gateway down → nothing installed, nothing written |

## Install

Requires VS Code ≥ 1.104 and Node ≥ 18.

```bash
npx @deepvariance/vscode          # interactive
npx @deepvariance/vscode --yes --email you@example.com   # unattended
```

Forks (Cursor, Windsurf, VSCodium, Insiders) are detected too.

## Usage

```bash
npx @deepvariance/vscode --health   # check the gateway, change nothing, exit non-zero if down
```

| Flag | |
|---|---|
| `--health` | Only check the gateway, then exit |
| `--email <email>` | Skip the email prompt |
| `--invite <token>` | Override the built-in tester invite |
| `--gateway <url>` | Point at a different gateway |
| `--yes` | Ask nothing; take the defaults |
| `--help` | |

Env: `DEEPVARIANCE_EMAIL`, `DEEPVARIANCE_INVITE`, `DEEPVARIANCE_GATEWAY`.

**Commands** (Command Palette): `Deep Variance: Set Up Qwen3.5 27B`, `Deep Variance: Remove API Key`.

## How it works

VS Code's built-in BYOK **cannot** be automated — the API key lives in SecretStorage, which is only
ever filled from an interactive prompt, and a keyless provider group never appears in the picker.

So this ships an extension that *is* the model provider, registered via the stable
`lm.registerLanguageModelChatProvider` API. No BYOK group, no `config.yaml`, nothing to paste.

```
npx  ──►  POST /register  ──►  install .vsix  ──►  ~/.deepvariance/handoff.json (0600)
                                                             │
VS Code start ──►  activate()  ──►  SecretStorage  ──►  delete the file
                                                             │
                                            Chat picker ──►  Qwen3.5 27B
```

The extension **stays installed** — it serves the model. The *handoff file* is what's transient.

> Full rationale, the gateway contract, and a change recipe per edit: **[SPEC.md](./SPEC.md)**.

## Status

| | |
|---|---|
| CLI | ✅ 18 tests |
| Provider extension | ✅ 9 tests, run against the built bundle |
| Streaming · tools · vision · thinking | ✅ verified against the live gateway |
| Publish | 🤖 automatic — CI publishes on a version bump merged to `main` |
| 4-image cap enforced client-side | ❌ recorded in `src/model.js`, not read |

## Development

```bash
npm test                    # CLI
cd extension && npm test    # provider
npm run build               # bundle the CLI -> dist/cli.js (minified)
npm run build:extension     # rebuild + repackage the bundled .vsix (commit it)
```

**Releasing:** bump `version` in `package.json` and merge to `main`. CI publishes it via npm
**trusted publishing** (OIDC) — no tokens anywhere. Any other commit to `main` is a no-op; it only
publishes when the version isn't already on npm. The one-time bootstrap is in
[SPEC.md](./SPEC.md#publish--release).

**Bump `extension/package.json` when the extension changes** — VS Code won't reinstall the same
version, and CI fails if the committed `.vsix` doesn't match.

Published artifacts are **bundled and minified** — `dist/cli.js` and the `.vsix`. No source, no
sourcemaps, zero runtime dependencies (`@clack/prompts` is bundled in). CI enforces this.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `530` from the gateway | The GPU instance is paused. Cold start ≈ 140 s. |
| `401 missing bearer token` | No key reached the gateway — re-run the CLI |
| `401 invalid or disabled api key` | The key is wrong; re-run to mint a new one |
| No thinking block | Needs a **full restart** of VS Code, not a window reload |
| Model missing from picker | Extension not installed, or no key — run `Deep Variance: Set Up` |

## License

UNLICENSED — internal to Deep Variance.
