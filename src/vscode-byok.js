import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * We used to configure the model through VS Code's built-in BYOK ("customendpoint") provider,
 * which cannot work unattended: VS Code keeps the API key in SecretStorage and only ever
 * collects it through an interactive prompt. The extension is the model provider now, so the
 * only thing left to do here is clear out a group left behind by an older run — otherwise the
 * picker shows a second, keyless "Qwen3-VL Coder" that 401s.
 */
export const GROUP_NAME = 'Deep Variance';

export function byokConfigPath({ home = homedir(), platform = process.platform, product = 'Code' } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', product, 'User', 'chatLanguageModels.json');
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, product, 'User', 'chatLanguageModels.json');
  }
  return join(home, '.config', product, 'User', 'chatLanguageModels.json');
}

export function withoutGroup(groups, name = GROUP_NAME) {
  return groups.filter((group) => group?.name !== name);
}

/** Best-effort: a missing or hand-edited file is not a reason to fail setup. */
export async function removeStaleGroup({ path = byokConfigPath() } = {}) {
  let groups;
  try {
    groups = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { removed: false };
  }

  if (!Array.isArray(groups)) return { removed: false };

  const next = withoutGroup(groups);
  if (next.length === groups.length) return { removed: false };

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return { removed: true, path };
}
