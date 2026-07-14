# deepvariance-vscode

> **Working on this repo? Read [SPEC.md](./SPEC.md) first.** It records the gateway contract, the
> VS Code constraints that rule out the obvious designs, and a change recipe for each kind of edit.

Puts **Qwen3.5 27B** in VS Code's built-in Chat. One command, no key to paste, no extra extension
to pick.

```bash
npx deepvariance-vscode
```

It asks for your email — the tester invite is built in — and does the rest:

1. Checks the gateway is up. Nothing is installed or changed if it isn't.
2. Registers your personal API key (`POST /register`).
3. Installs the Deep Variance provider extension and hands it the key.
4. Enables the thinking view.

Then **quit and reopen VS Code** (not just a reload) and pick **Qwen3.5 27B** in the Chat model
picker. It reads code and images, calls tools, and shows its reasoning.

## How it works

VS Code's own BYOK ("Custom Endpoint") **cannot** be set up unattended: the API key lives in
SecretStorage, which is only ever filled from an interactive password prompt, and a provider group
without a key doesn't even appear in the picker.

So this package ships a small extension that *is* the model provider — it registers the vendor
`deepvariance` through VS Code's `lm.registerLanguageModelChatProvider` API, so the model appears in
the picker directly, with no BYOK group and nothing to paste.

The CLI leaves the key in `~/.deepvariance/handoff.json` (mode `0600`). The extension moves it into
SecretStorage on activation and deletes the file, so the plaintext copy exists for seconds rather
than forever.

**The extension stays installed** — it's what serves the model to Chat. Uninstalling it removes the
model from the picker. Run **Deep Variance: Remove API Key** to clear your key.

## Health check

```bash
npx deepvariance-vscode --health
```

Checks the gateway and exits — installs nothing, writes nothing, non-zero when it's down. A `530`
usually just means the GPU instance is paused; cold start is about 140 seconds.

## Options

| Flag | |
|---|---|
| `--health` | Only check the gateway, then exit |
| `--email <email>` | Skip the email prompt |
| `--invite <token>` | Override the built-in tester invite |
| `--gateway <url>` | Point at a different gateway |
| `--yes` | Ask nothing; take the defaults |

Also read from the environment: `DEEPVARIANCE_EMAIL`, `DEEPVARIANCE_INVITE`, `DEEPVARIANCE_GATEWAY`.

## Notes

- **Re-running is safe.** `POST /register` mints a *new* key each call and leaves earlier keys
  working, so setting up again won't break a key you use elsewhere.
- The model is reached through the gateway alias **`qwen-coder`**. Don't substitute the underlying
  model id — the gateway 404s on it.
- Images are capped at **4 per prompt** by the server.
- VS Code forks (Cursor, Windsurf, VSCodium, Insiders) are detected too. If more than one is
  installed, you pick.

## Development

```bash
npm test                  # CLI (18)
npm run build:extension   # rebuild + repackage the bundled .vsix
cd extension && npm test  # provider: streaming, tool calls, images, auth errors (9)
```
