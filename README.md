<h1 align="center">Qwen3.5 27B for VS Code</h1>

<p align="center">
  A coding assistant in VS Code's built-in Chat. One command to set up.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@deepvariance/vscode"><img alt="npm" src="https://img.shields.io/npm/v/%40deepvariance%2Fvscode?color=cb3837&logo=npm"></a>
  <img alt="vscode" src="https://img.shields.io/badge/VS%20Code-1.104+-007ACC?logo=visualstudiocode&logoColor=white">
</p>

---

```bash
npx @deepvariance/vscode
```

Enter your email. That's it — no API key to copy, no config files to edit.

Then **quit and reopen VS Code**, open Chat, and pick **Qwen3.5 27B** from the model list.

## What you get

- **Shows its thinking** — watch it reason before it answers
- **Uses tools** — works in Chat's agent mode, so it can read and edit your code
- **Reads images** — drop in a screenshot, a diagram, or an error dialog
- **131k context** — hand it a large file without trimming

## Requirements

VS Code 1.104 or newer. Cursor, Windsurf, VSCodium and Insiders work too.

## If something goes wrong

| | |
|---|---|
| **"Gateway is down"** | The server is asleep. Wait a couple of minutes and run the command again. |
| **No thinking shown** | Quit VS Code completely and reopen it — a window reload isn't enough. |
| **Model not in the list** | Run `npx @deepvariance/vscode` again. |
| **Sign-in errors in Chat** | Run `npx @deepvariance/vscode` again to get a fresh key. |

To remove your key: **Deep Variance: Remove API Key** in the Command Palette.

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

---

Building on this? **[SPEC.md](./SPEC.md)** has the architecture, the API contract, and how to change
things safely.
