# deepvariance-vscode

Sets up the **Qwen3-VL Coder** assistant in VS Code. One command, no key to paste.

```bash
npx deepvariance-vscode
```

It asks for your email — the tester invite is built in — and does the rest:

1. Checks the gateway is up. Nothing is installed or changed if it isn't.
2. Asks where you want the model: **VS Code's built-in Chat**, the **Continue** extension, or both.
3. Registers your personal API key (`POST /register`).
4. Configures the target and hands the key over.

Then reload VS Code and pick **Qwen3-VL Coder** in the Chat model picker. It reads code and
images, and can call tools.

## How the built-in Chat path works

VS Code's own BYOK ("Custom Endpoint") **cannot** be set up unattended: the API key lives in
SecretStorage, which is only ever filled from an interactive password prompt, and a provider
group without a key doesn't even appear in the picker.

So this package ships a small extension that *is* the model provider — it registers the vendor
`deepvariance` through VS Code's `lm.registerLanguageModelChatProvider` API, so the model shows
up in the picker directly, with no BYOK group and nothing to paste.

The CLI leaves the key in `~/.deepvariance/handoff.json` (mode `0600`). The extension moves it
into SecretStorage on activation and deletes the file, so the plaintext copy exists for seconds
rather than forever.

**The extension stays installed** — it's what serves the model to Chat. Uninstalling it removes
the model from the picker. Run **Deep Variance: Remove API Key** to clear your key.

## Health check

```bash
npx deepvariance-vscode --health
```

Checks the gateway and exits — installs nothing, writes nothing, non-zero when it's down. Any
HTTP response below 500 counts as up, and the gateway's own `{"status": ...}` body is trusted:
a gateway answering `200` in front of a dead model reads as down.

## Options

| Flag | |
|---|---|
| `--health` | Only check the gateway, then exit |
| `--target <where>` | `chat`, `continue`, or `both` (default: ask) |
| `--email <email>` | Skip the email prompt |
| `--invite <token>` | Override the built-in tester invite |
| `--gateway <url>` | Point at a different gateway |
| `--yes` | Ask nothing; take the defaults |

Also read from the environment: `DEEPVARIANCE_EMAIL`, `DEEPVARIANCE_INVITE`, `DEEPVARIANCE_GATEWAY`.

## Notes

- **Existing config is never destroyed.** Continue's `config.yaml` is backed up to a timestamped
  file before being replaced.
- **Re-running is safe.** `POST /register` mints a *new* key each call and leaves earlier keys
  working, so setting up again won't break a key you use elsewhere.
- The model is reached through the gateway alias **`qwen-coder`**. Don't substitute the
  underlying model id — the gateway 404s on it.
- VS Code forks (Cursor, Windsurf, VSCodium, Insiders) are detected too. If more than one is
  installed, you pick.

## Development

```bash
npm test                  # CLI
npm run build:extension   # rebuild + repackage the bundled .vsix
cd extension && npm test  # provider: streaming, tool calls, images, auth errors
```
