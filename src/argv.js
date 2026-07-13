import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * VS Code renders a model's chain of thought only through LanguageModelThinkingPart, which is
 * still a proposed API. Proposed APIs need `--enable-proposed-api <ext-id>` at launch, and
 * argv.json is how that is made permanent — VS Code's main.js reads this key and pushes the
 * flag into argv itself. Changing it requires a full restart, not just a window reload.
 */
export function argvPath(home = homedir()) {
  return join(home, '.vscode', 'argv.json');
}

/** argv.json ships full of `//` comments, so it is JSONC rather than JSON. */
export function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

export function withProposedApi(config, extensionId) {
  const current = Array.isArray(config['enable-proposed-api']) ? config['enable-proposed-api'] : [];
  if (current.includes(extensionId)) return config;
  return { ...config, 'enable-proposed-api': [...current, extensionId] };
}

/**
 * Returns { changed } — false when the extension is already enabled, so a re-run doesn't
 * needlessly tell the user to restart.
 */
export async function enableProposedApi({ extensionId, path = argvPath() }) {
  let raw = null;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let config = {};
  if (raw?.trim()) {
    try {
      config = JSON.parse(stripComments(raw));
    } catch (cause) {
      throw new Error(`${path} is not valid JSON, so it was left alone. Fix it, then re-run.`, { cause });
    }
  }

  const next = withProposedApi(config, extensionId);
  if (next === config) return { changed: false, path };

  // The comments in argv.json are VS Code's own documentation; the data is what matters, but
  // keep a backup so nothing the user wrote is lost.
  if (raw !== null) await copyFile(path, `${path}.backup`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);

  return { changed: true, path };
}
