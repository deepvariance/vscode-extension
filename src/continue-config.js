import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { normalizeGateway } from './gateway.js';

export const MODEL_NAME = 'Qwen3-VL Coder';

/**
 * `qwen-coder` is a gateway-side alias, not the underlying model id — the gateway currently
 * routes it to Qwen/Qwen3.5-27B-FP8. Sending the real id instead is a 404, so keep this as-is.
 */
export const MODEL_ID = 'qwen-coder';

/** Continue v1.0+ reads ~/.continue/config.yaml and hot-reloads it on write. */
export function configPath(home = homedir()) {
  return join(home, '.continue', 'config.yaml');
}

/**
 * The model block from step 5 of the setup guide, as real YAML.
 * We write the file ourselves, so the guide's copy-paste-safe JSON styling is unnecessary.
 *
 * X-User-Email mirrors what @deepvariance/opencode sends, so gateway-side usage lines up
 * across both installers.
 */
export function buildConfig({ apiKey, gateway, email }) {
  const apiBase = `${normalizeGateway(gateway)}/v1`;
  return `name: Main Config
version: 1.0.0
schema: v1
models:
  - name: ${MODEL_NAME}
    provider: openai
    model: ${MODEL_ID}
    apiBase: ${apiBase}
    apiKey: ${apiKey}
    capabilities:
      - tool_use
      - image_input
    roles:
      - chat
      - edit
      - apply
    requestOptions:
      headers:
        X-User-Email: ${email}
`;
}

/** Timestamped so repeated runs never clobber an earlier backup. */
export function backupPath(path, stamp) {
  return `${path}.backup-${stamp}`;
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Overwrites config.yaml (as the guide instructs) but never destroys the old one:
 * any existing file is copied to a timestamped backup first.
 */
export async function writeConfig({ apiKey, gateway, email, path = configPath(), stamp }) {
  const existing = await readIfExists(path);
  const contents = buildConfig({ apiKey, gateway, email });

  if (existing === contents) {
    return { path, backup: null, unchanged: true };
  }

  let backup = null;
  if (existing !== null) {
    backup = backupPath(path, stamp ?? new Date().toISOString().replace(/[:.]/g, '-'));
    await copyFile(path, backup);
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { mode: 0o600 });

  return { path, backup, unchanged: false };
}
