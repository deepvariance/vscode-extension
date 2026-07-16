import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * How the CLI hands the freshly-minted key to the extension.
 *
 * The extension moves this into VS Code's SecretStorage on activation and deletes the file,
 * so the key sits in plaintext for seconds rather than forever (Continue's config.yaml keeps
 * it on disk permanently). Written 0600.
 */
export function handoffPath(home = homedir()) {
  return join(home, '.deepvariance', 'handoff.json');
}

export async function writeHandoff({ apiKey, gateway, email, agents = false, path = handoffPath() }) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // `agents` carries the CLI's answer about the agent window: those are VS Code settings, so only
  // the extension can apply them, and only the CLI can ask.
  await writeFile(path, `${JSON.stringify({ apiKey, gateway, email, agents }, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Returns the handoff and removes it, or null when there is nothing to import. */
export async function consumeHandoff(path = handoffPath()) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // a corrupt handoff is not worth keeping around
  }

  await rm(path, { force: true });

  return parsed?.apiKey ? parsed : null;
}
