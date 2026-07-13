# Deep Variance — Qwen3-VL Coder Setup

One command to get the Qwen3-VL Coder assistant running in VS Code.

Run **Deep Variance: Set Up Qwen3-VL Coder** from the Command Palette (`Ctrl/Cmd+Shift+P`).
It checks the gateway, asks for your email, installs the
[Continue](https://marketplace.visualstudio.com/items?itemName=Continue.continue) extension,
registers your personal API key, and writes `~/.continue/config.yaml`.

Then open the Continue panel and pick **Qwen3-VL Coder**. The model reads code and images,
and can call tools.

## Commands

| Command | |
|---|---|
| `Deep Variance: Set Up Qwen3-VL Coder` | Full setup |
| `Deep Variance: Check Gateway Health` | Check the gateway, change nothing |

## Settings

| Setting | |
|---|---|
| `deepvariance.gateway` | Gateway URL (default `https://demo.deepvariance.com`) |
| `deepvariance.invite` | Override the built-in tester invite token |

## Notes

- Your existing Continue config is backed up to a timestamped file, never destroyed.
- Nothing is installed or written if the gateway is down.
- Re-running is safe: registering mints a new key and leaves earlier keys working.
