import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { normalizeGateway } from './gateway.js';
import { MODEL_ID, MODEL_NAME } from './continue-config.js';

/** The built-in VS Code vendor for an arbitrary OpenAI-compatible endpoint. */
export const VENDOR = 'customendpoint';
export const GROUP_NAME = 'Deep Variance';

/**
 * Reported by the gateway itself (`max_model_len` on GET /v1/models) rather than guessed.
 * maxOutputTokens is a conservative cap, not a server limit.
 */
export const CONTEXT_WINDOW = 131072;
export const MAX_OUTPUT_TOKENS = 8192;

/** VS Code's user-data directory, where chatLanguageModels.json lives beside settings.json. */
export function byokConfigPath({ home = homedir(), platform = process.platform, product = 'Code' } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', product, 'User', 'chatLanguageModels.json');
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, product, 'User', 'chatLanguageModels.json');
  }
  return join(home, '.config', product, 'User', 'chatLanguageModels.json');
}

/**
 * One provider group for VS Code's built-in Chat. The API key is deliberately absent:
 * VS Code marks it `secret: true` and keeps it in secret storage, so it cannot be written
 * here — the user pastes it once via "Chat: Manage Language Models".
 */
export function buildGroup({ gateway, email }) {
  const model = {
    id: MODEL_ID,
    name: MODEL_NAME,
    url: `${normalizeGateway(gateway)}/v1/chat/completions`,
    toolCalling: true,
    vision: true,
    thinking: true,
    contextWindow: CONTEXT_WINDOW,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };

  // Authorization is a forbidden requestHeaders value (VS Code strips it); the key rides
  // the secret-storage apiKey instead. X-User-Email is allowed and matches the other installers.
  if (email) model.requestHeaders = { 'X-User-Email': email };

  return { name: GROUP_NAME, vendor: VENDOR, apiType: 'chat-completions', models: [model] };
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
 * Replaces our own group in place and leaves every other provider the user configured alone —
 * this file is shared with Anthropic, OpenAI, Ollama and friends, so it is never overwritten.
 */
export function mergeGroup(groups, group) {
  const isOurs = (entry) => entry?.vendor === group.vendor && entry?.name === group.name;
  const index = groups.findIndex(isOurs);
  if (index === -1) return [...groups, group];
  return groups.map((entry, i) => (i === index ? group : entry));
}

export async function writeByokConfig({ gateway, email, path = byokConfigPath(), stamp }) {
  const raw = await readIfExists(path);

  let groups = [];
  if (raw?.trim()) {
    try {
      groups = JSON.parse(raw);
    } catch (cause) {
      throw new Error(`${path} is not valid JSON, so it was left untouched. Fix or delete it, then re-run.`, { cause });
    }
    if (!Array.isArray(groups)) {
      throw new Error(`${path} should contain a JSON array of provider groups. It was left untouched.`);
    }
  }

  const group = buildGroup({ gateway, email });
  const next = mergeGroup(groups, group);
  const contents = `${JSON.stringify(next, null, 2)}\n`;

  if (raw === contents) return { path, backup: null, unchanged: true };

  let backup = null;
  if (raw !== null) {
    backup = `${path}.backup-${stamp ?? new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(path, backup);
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);

  return { path, backup, unchanged: false };
}
