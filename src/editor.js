import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';

/** VS Code and its forks all ship the same `--install-extension` CLI, so any of them works. */
const EDITORS = [
  { name: 'VS Code', bin: 'code' },
  { name: 'VS Code Insiders', bin: 'code-insiders' },
  { name: 'Cursor', bin: 'cursor' },
  { name: 'Windsurf', bin: 'windsurf' },
  { name: 'VSCodium', bin: 'codium' },
];

/** Editors installed without their CLI symlinked onto PATH (the common macOS case). */
function fallbackPaths(bin) {
  const app = { code: 'Visual Studio Code', 'code-insiders': 'Visual Studio Code - Insiders', cursor: 'Cursor', windsurf: 'Windsurf', codium: 'VSCodium' }[bin];
  if (process.platform === 'darwin') {
    return app ? [`/Applications/${app}.app/Contents/Resources/app/bin/${bin}`] : [];
  }
  if (IS_WINDOWS) {
    const local = process.env.LOCALAPPDATA;
    const dir = { code: 'Microsoft VS Code', 'code-insiders': 'Microsoft VS Code Insiders', cursor: 'cursor', windsurf: 'Windsurf', codium: 'VSCodium' }[bin];
    return local && dir ? [join(local, 'Programs', dir, 'bin', `${bin}.cmd`)] : [];
  }
  return [`/usr/share/${bin}/bin/${bin}`, `/snap/bin/${bin}`];
}

/**
 * Windows needs a shell to run .cmd shims; quote paths that contain spaces.
 *
 * stdin is 'ignore', never inherited: an interactive prompt library may have put the
 * shared stdin into raw/flowing mode, and a synchronous child that inherits it blocks
 * forever. The timeout is the backstop for an editor CLI that wedges for its own reasons.
 */
function run(bin, args, timeout = 20_000) {
  const shell = IS_WINDOWS;
  const command = shell && bin.includes(' ') ? `"${bin}"` : bin;
  return spawnSync(command, args, { shell, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
}

function works(bin) {
  const result = run(bin, ['--version']);
  return result.status === 0;
}

/** Every editor we can actually invoke, PATH first then well-known install paths. */
export function detectEditors() {
  const found = [];
  for (const editor of EDITORS) {
    const candidate = [editor.bin, ...fallbackPaths(editor.bin)].find(works);
    if (candidate) found.push({ ...editor, bin: candidate });
  }
  return found;
}

/** The provider extension ships inside this npm package rather than a marketplace. */
export function vsixPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = readdirSync(join(here, '..', 'extension')).filter((file) => file.endsWith('.vsix'));
  if (candidates.length === 0) throw new Error('No .vsix found in this package — run `npm run build:extension` first.');
  return join(here, '..', 'extension', candidates.sort().at(-1));
}

export function installVsix(bin, path) {
  const result = run(bin, ['--install-extension', path, '--force'], 180_000);
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`Could not install ${path} into ${bin}. ${reason}`);
  }
  return (result.stdout || '').trim();
}

/** Where the user would install VS Code from, if they have none. */
export const VSCODE_DOWNLOAD_URL = 'https://code.visualstudio.com/download';

