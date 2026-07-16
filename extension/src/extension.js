import * as vscode from 'vscode';

import { consumeHandoff } from '../../src/handoff.js';
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../../src/gateway.js';
import { MODEL_ID, MODEL_NAME, VENDOR } from './constants.js';
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
 * The agent window ("Agent Sessions") is an experimental VS Code feature that is **off by default on
 * stable**, and a BYOK model needs both of these before it reaches the agent host at all:
 *
 *   chat.agentHost.enabled            default `!isWeb && quality !== 'stable'` → false on stable
 *   chat.agentHost.byokModels.enabled default false, and read with a strict `=== true`
 *
 * Turning on someone's experimental editor features is not ours to assume, so the CLI asks first
 * (defaulting to yes) and passes the answer through the handoff — we only get here on a yes.
 * Absent in VS Code < 1.126 and in forks like Cursor, where `inspect()` returns undefined.
 */
const AGENT_WINDOW_SETTINGS = ['agentHost.enabled', 'agentHost.byokModels.enabled'];

export async function ensureAgentWindow(configuration = vscode.workspace.getConfiguration('chat')) {
  const changed = [];

  for (const key of AGENT_WINDOW_SETTINGS) {
    const info = configuration.inspect(key);
    if (!info || info.defaultValue === undefined) continue; // not in this VS Code version, or a fork
    if ((info.policyValue ?? info.globalValue ?? info.workspaceValue) !== undefined) continue; // already chosen
    if (info.defaultValue === true) continue; // already on (Insiders) — nothing to write
    await configuration.update(key, true, vscode.ConfigurationTarget.Global);
    changed.push(key);
  }

  return changed;
}

/**
 * Make our model the one a new chat starts on, so testers don't have to find it in the picker.
 * VS Code matches `chat.defaultModel` against a model id or family, case-insensitively; we pass
 * MODEL_ID, which is the same constant the provider registers with, so the two can't drift.
 *
 * VS Code applies this only to an empty session and never over an explicit pick of the user's, so
 * the blast radius is "which model a fresh chat opens with". Same guards as above: skip if the
 * setting doesn't exist in this VS Code version, and only fill in the empty default — never
 * overwrite a value the user or an enterprise policy chose.
 */
export async function ensureDefaultModel(configuration = vscode.workspace.getConfiguration('chat')) {
  const info = configuration.inspect('defaultModel');
  if (!info || info.defaultValue === undefined) return false; // setting not in this VS Code version
  const current = info.policyValue ?? info.globalValue ?? info.workspaceValue ?? info.defaultValue;
  if (current !== '') return false; // somebody chose a model already — leave it alone
  await configuration.update('defaultModel', MODEL_ID, vscode.ConfigurationTarget.Global);
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

  // Only when the CLI asked and the user said yes. Best-effort: a config write must not cost them
  // the key we just imported.
  if (handoff.agents) {
    try {
      await ensureAgentWindow();
    } catch {
      /* they can still turn it on by hand */
    }
  }

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
    await ensureDefaultModel();
  } catch {
    /* leave it to the user's manual setting */
  }

  await importHandoff(context, provider);

  // Registering a provider does not make VS Code ask it for models: it fills its model cache only
  // when a vendor is *resolved*. Opening the regular Chat picker resolves every vendor, but the
  // agent-host bridge behind Agent Sessions only reads that cache — so without a nudge our model is
  // missing there until the regular picker happens to be opened first. Firing the change event is
  // what triggers a resolve (see SPEC §5.5).
  provider.refresh();
}

export function deactivate() {}
