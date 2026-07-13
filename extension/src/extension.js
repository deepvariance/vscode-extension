import * as vscode from 'vscode';

// Bundled from the repo root by esbuild, so the CLI and the extension share one
// implementation of registration and config writing.
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../../src/gateway.js';
import { MODEL_NAME, configPath, writeConfig } from '../../src/continue-config.js';

const CONTINUE_ID = 'Continue.continue';

function settings() {
  const config = vscode.workspace.getConfiguration('deepvariance');
  return {
    gateway: config.get('gateway') || DEFAULT_GATEWAY,
    invite: config.get('invite') || DEFAULT_INVITE,
  };
}

async function checkHealthCommand() {
  const { gateway } = settings();

  const health = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Checking ${gateway}…` },
    () => checkHealth({ gateway }),
  );

  if (health.ok) vscode.window.showInformationMessage(health.detail);
  else vscode.window.showErrorMessage(health.detail);

  return health;
}

/** Installs Continue if it isn't there. VS Code no-ops when it already is. */
async function ensureContinue(progress) {
  if (vscode.extensions.getExtension(CONTINUE_ID)) return 'already installed';

  progress.report({ message: 'Installing the Continue extension…' });
  await vscode.commands.executeCommand('workbench.extensions.installExtension', CONTINUE_ID);
  return 'installed';
}

async function setupCommand() {
  const { gateway, invite } = settings();

  // Nothing below is worth doing against a gateway that cannot answer.
  const health = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Checking ${gateway}…` },
    () => checkHealth({ gateway }),
  );

  if (!health.ok) {
    vscode.window.showErrorMessage(`${health.detail} Nothing was installed or configured.`);
    return;
  }

  const email = await vscode.window.showInputBox({
    title: `Set up ${MODEL_NAME}`,
    prompt: 'Your email address — used to create your personal API key.',
    placeHolder: 'you@example.com',
    ignoreFocusOut: true,
    validateInput: (value) => (isValidEmail(value) ? null : 'That does not look like an email address.'),
  });

  if (!email) return; // cancelled

  const path = configPath();
  const overwrite = await vscode.window.showWarningMessage(
    `Write ${MODEL_NAME} to ${path}?`,
    { modal: true, detail: 'Any existing Continue config is backed up to a timestamped file first.' },
    'Set up',
  );

  if (overwrite !== 'Set up') return;

  try {
    const written = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Setting up ${MODEL_NAME}`, cancellable: false },
      async (progress) => {
        progress.report({ message: 'Creating your personal API key…' });
        const { apiKey } = await register({ gateway, email: email.trim(), invite });

        await ensureContinue(progress);

        progress.report({ message: 'Writing Continue configuration…' });
        return writeConfig({ apiKey, gateway, email: email.trim(), path });
      },
    );

    const backupNote = written.backup ? ` Your previous config was saved to ${written.backup}.` : '';
    const action = await vscode.window.showInformationMessage(
      `${MODEL_NAME} is ready. Pick it as the model in the Continue panel.${backupNote}`,
      'Open Continue',
    );

    if (action === 'Open Continue') await openContinue();
  } catch (error) {
    vscode.window.showErrorMessage(`Setup failed: ${error.message}`);
  }
}

/** Continue renames its commands between releases, so fall back to the view container. */
async function openContinue() {
  try {
    await vscode.commands.executeCommand('continue.focusContinueInput');
  } catch {
    await vscode.commands.executeCommand('workbench.view.extension.continue');
  }
}

export function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('deepvariance.setup', setupCommand),
    vscode.commands.registerCommand('deepvariance.health', checkHealthCommand),
  );
}

export function deactivate() {}
