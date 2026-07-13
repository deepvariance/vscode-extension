# Deep Variance — Qwen3-VL Coder

Adds **Qwen3-VL Coder** to VS Code's built-in Chat model picker. No Continue, no BYOK key pasting.

Normally installed by `npx deepvariance-vscode`, which registers your personal API key and hands
it to this extension. If you installed it by hand, run **Deep Variance: Set Up Qwen3-VL Coder**
from the Command Palette.

The key is kept in VS Code's SecretStorage. **Deep Variance: Remove API Key** clears it.

This extension *is* the model provider — uninstalling it removes the model from the picker.
