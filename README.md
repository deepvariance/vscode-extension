# deepvariance-vscode

Sets up the **Qwen3-VL Coder** assistant in VS Code, so testers don't have to follow the six-step
setup guide by hand.

```bash
npx deepvariance-vscode
```

It asks for your email — the tester invite is built in — and does the rest:

1. Checks the gateway is up — nothing is installed or changed if it isn't.
2. Installs the [Continue](https://marketplace.visualstudio.com/items?itemName=Continue.continue) extension.
3. Exchanges your invite token for a personal API key (`POST /register`).
4. Writes `~/.continue/config.yaml` with the model pointed at the gateway.

Continue reloads the config on save, so there is nothing to restart. Open the Continue panel,
pick **Qwen3-VL Coder**, and go. The model takes images as well as code.

## Health check

```bash
npx deepvariance-vscode --health
```

Checks the gateway and exits — installs nothing, writes nothing. Exits non-zero when it's down.
Any HTTP response below 500 counts as up; a 5xx (including Cloudflare's 52x/530 when the origin
is unreachable) or a connection failure counts as down.

## Options

| Flag | |
|---|---|
| `--health` | Only check the gateway, then exit |
| `--email <email>` | Skip the email prompt |
| `--invite <token>` | Skip the invite prompt |
| `--gateway <url>` | Point at a different gateway (default `https://demo.deepvariance.com`) |
| `--skip-extension` | Write the config, don't install the extension |
| `--yes` | Don't ask before overwriting `config.yaml` |

Also read from the environment: `DEEPVARIANCE_EMAIL`, `DEEPVARIANCE_INVITE`, `DEEPVARIANCE_GATEWAY`.

## Notes

- **Your existing Continue config is never destroyed.** If `~/.continue/config.yaml` already
  exists, it's copied to a timestamped `config.yaml.backup-…` before being replaced.
- **Re-running is safe.** `POST /register` mints a *new* key each call and leaves earlier keys
  working, so setting up again won't break a key you already use elsewhere.
- The model is reached through the gateway alias `qwen-coder`. Don't replace it with the
  underlying model id — the gateway 404s on that.
- VS Code forks (Cursor, Windsurf, VSCodium, Insiders) are detected too — they share
  `~/.continue`, so they work the same. If more than one is installed, you pick.
- Your API key is personal. Don't share it. `config.yaml` is written `0600`.
- Errors: **403** means the invite token is wrong, **404** means the gateway URL is wrong, and
  **401** later in Continue means the key didn't save.

## Development

```bash
npm test
```
