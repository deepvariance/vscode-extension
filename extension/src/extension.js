import * as vscode from 'vscode';

import { consumeHandoff } from '../../src/handoff.js';
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../../src/gateway.js';
import { MODEL_NAME, VENDOR } from './constants.js';
import { DeepVarianceProvider } from './provider.js';

async function storeKey(context, { apiKey, gateway, email }) {
  await context.secrets.store('deepvariance.apiKey', apiKey);
  await context.globalState.update('deepvariance.gateway', gateway ?? DEFAULT_GATEWAY);
  await context.globalState.update('deepvariance.email', email ?? '');
}

/**
 * VS Code 1.128+ agent mode calls a small "utility model" for background tasks (titles, etc.). With
 * a BYOK model and no Copilot plan its default `copilot-utility-small` is unavailable, so agent mode
 * errors: "No utility model is configured for 'copilot-utility-small' …". The fix is the setting
 * `chat.byokUtilityModelDefault: mainAgent`, which routes utility calls to the selected BYOK model.
 * We set it on the user's behalf so testers don't have to.
 *
 * Guarded: skip if the setting doesn't exist in this VS Code version (update() would throw), and
 * never override a value the user set themselves — only flip the default `none`.
 */
export async function ensureByokUtilityDefault(configuration = vscode.workspace.getConfiguration('chat')) {
  const info = configuration.inspect('byokUtilityModelDefault');
  if (!info || info.defaultValue === undefined) return false; // setting not in this VS Code version
  const current = info.globalValue ?? info.workspaceValue ?? info.defaultValue;
  if (current !== 'none') return false; // user chose one, or already non-default — leave it
  await configuration.update('byokUtilityModelDefault', 'mainAgent', vscode.ConfigurationTarget.Global);
  return true;
}

/**
 * The CLI leaves the key in ~/.deepvariance/handoff.json. Move it into SecretStorage and
 * delete the file, so the plaintext copy lives for seconds rather than forever.
 */
async function importHandoff(context, provider) {
  const handoff = await consumeHandoff();
  if (!handoff) return false;

  await storeKey(context, handoff);
  provider.refresh();
  vscode.window.showInformationMessage(`${MODEL_NAME} is ready — pick it in the Chat model picker.`);
  return true;
}

/** Fallback when someone installs the extension without running the CLI. */
async function setupCommand(context, provider) {
  const gateway = context.globalState.get('deepvariance.gateway') ?? DEFAULT_GATEWAY;

  const health = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Checking ${gateway}…` },
    () => checkHealth({ gateway }),
  );

  if (!health.ok) {
    vscode.window.showErrorMessage(`${health.detail} Nothing was configured.`);
    return;
  }

  const email = await vscode.window.showInputBox({
    title: `Set up ${MODEL_NAME}`,
    prompt: 'Your email address — used to create your personal API key.',
    placeHolder: 'you@example.com',
    ignoreFocusOut: true,
    validateInput: (value) => (isValidEmail(value) ? null : 'That does not look like an email address.'),
  });

  if (!email) return;

  try {
    const { apiKey } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating your personal API key…' },
      () => register({ gateway, email: email.trim(), invite: DEFAULT_INVITE }),
    );

    await storeKey(context, { apiKey, gateway, email: email.trim() });
    provider.refresh();
    vscode.window.showInformationMessage(`${MODEL_NAME} is ready — pick it in the Chat model picker.`);
  } catch (error) {
    vscode.window.showErrorMessage(`Setup failed: ${error.message}`);
  }
}

async function signOutCommand(context, provider) {
  await context.secrets.delete('deepvariance.apiKey');
  provider.refresh();
  vscode.window.showInformationMessage('Deep Variance key removed.');
}

export async function activate(context) {
  const provider = new DeepVarianceProvider(context);

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
    vscode.commands.registerCommand('deepvariance.setup', () => setupCommand(context, provider)),
    vscode.commands.registerCommand('deepvariance.signOut', () => signOutCommand(context, provider)),
  );

  // Best-effort: never let a config write break activation.
  try {
    await ensureByokUtilityDefault();
  } catch {
    /* leave it to the user's manual setting */
  }

  await importHandoff(context, provider);
}

export function deactivate() {}
