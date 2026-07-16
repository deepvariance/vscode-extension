<p align="center">
  <img src="https://raw.githubusercontent.com/deepvariance/vscode-extension/main/assets/banner.png" alt="Deep Variance" width="360">
</p>

<p align="center">
  <strong>Optimized Inference API for Coding</strong> &nbsp;·&nbsp; VS Code integration
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@deepvariance/vscode"><img alt="npm" src="https://img.shields.io/npm/v/%40deepvariance%2Fvscode?color=cb3837&logo=npm"></a>
  <a href="https://github.com/deepvariance/vscode-extension/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/deepvariance/vscode-extension/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="beta" src="https://img.shields.io/badge/status-beta-orange">
  <img alt="vscode" src="https://img.shields.io/badge/VS%20Code-1.104+-007ACC?logo=visualstudiocode&logoColor=white">
</p>

## Quickstart

```bash
npx @deepvariance/vscode
```

Enter your email — no API key to copy, no config files to edit. Then, in VS Code, open the Command
Palette and run **Developer: Reload Window**. Open Chat and pick the model from the list.

## Models

| Model | Context |
|---|---|
| **Qwen3.6 27B** | 131k tokens |

## Capabilities

- **Reasoning** — the model shows its thinking before it answers
- **Tool use** — works in Chat's agent mode, so it can read and edit your code
- **Vision** — attach a screenshot, a diagram, or an error dialog (up to 4 images)

## Requirements

- VS Code 1.104 or newer (see the table below)
- Node.js 18 or newer, with npm (for `npx`)

## IDEs supported

| IDE | Min version | What's supported |
|---|---|---|
| **VS Code** | **1.128** | Everything: Chat, agent mode, the agent window, and Qwen3.6 as your default model. **This is what we test on.** |
| VS Code | 1.127 | Chat, agent mode, default model. No agent window. |
| VS Code | 1.126 | Chat and agent mode. Agent mode needs `chat.byokUtilityModelDefault` set to `mainAgent` by hand. |
| VS Code | 1.104 | Chat and the model picker only. |
| VS Code Insiders | 1.128 | Same as VS Code — the agent window is already on by default here. |
| Cursor, Windsurf, VSCodium | — | **Unverified.** The extension installs, but see below. |

Each row is the floor for that feature. VS Code adds these settings over time, so an older editor
isn't broken — it just has fewer of the pieces, and the extension skips whatever isn't there.

**On forks:** Cursor's base is VS Code 1.105 and it replaces VS Code's Chat with its own, so
`chat.defaultModel`, `chat.byokUtilityModelDefault` and `chat.agentHost.*` don't exist there at all —
the agent window and the default-model setting cannot work. The extension installs and skips them
cleanly rather than erroring. Whether the model reaches Cursor's own chat UI is **untested**; if you
try it, tell us what happened. Windsurf and VSCodium are untested too.

## Options

Most people never need these.

```bash
npx @deepvariance/vscode --health   # is the server up?
```

| | |
|---|---|
| `--email <email>` | Skip the email prompt |
| `--gateway <url>` | Use a different server |
| `--invite <token>` | Use a different invite |
| `--yes` | Don't ask anything |
| `--health` | Check the server and exit |

## Contributing

Architecture, the gateway contract, and a change recipe per edit live in **[SPEC.md](./SPEC.md)**.
Workflow is in **[CLAUDE.md](./CLAUDE.md)** — every change goes on a branch and lands via reviewed PR.

---

> **Beta.** Deep Variance's inference API is in active development. Availability, models, and behavior
> may change without notice, and the service may be unavailable at times. Not for production use.
