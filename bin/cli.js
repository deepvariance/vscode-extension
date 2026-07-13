#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from '@clack/prompts';

import { buildConfig, configPath, writeConfig, MODEL_NAME } from '../src/continue-config.js';
import { EXTENSION_ID, VSCODE_DOWNLOAD_URL, detectEditors, installExtension, installVsix, isExtensionInstalled, vsixPath } from '../src/editor.js';
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../src/gateway.js';
import { writeHandoff } from '../src/handoff.js';
import { removeStaleGroup } from '../src/vscode-byok.js';

const TARGETS = ['chat', 'continue', 'both'];

const HELP = `
  deepvariance-vscode — set up ${MODEL_NAME} in VS Code

  Usage
    npx deepvariance-vscode [options]

  Options
    --health             Only check that the gateway is up, then exit
    --target <where>     chat | continue | both  (default: ask)
                           chat     — VS Code's built-in Chat (installs our provider)
                           continue — the Continue extension
    --email <email>      Your email address
    --invite <token>     Override the built-in tester invite token
    --gateway <url>      Gateway URL (default: ${DEFAULT_GATEWAY})
    --yes                Don't ask for confirmation before writing config
    --help               Show this message

  Environment
    DEEPVARIANCE_EMAIL, DEEPVARIANCE_INVITE, DEEPVARIANCE_GATEWAY
`;

const { values } = parseArgs({
  options: {
    health: { type: 'boolean', default: false },
    target: { type: 'string' },
    email: { type: 'string' },
    invite: { type: 'string' },
    gateway: { type: 'string' },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.target && !TARGETS.includes(values.target)) {
  console.error(`--target must be one of: ${TARGETS.join(', ')}`);
  process.exit(1);
}

/** Any cancelled prompt (Ctrl+C) exits cleanly rather than continuing with undefined. */
function required(value) {
  if (isCancel(value)) {
    cancel('Setup cancelled. Nothing was changed.');
    process.exit(0);
  }
  return value;
}

/** Nothing below this is worth doing against a gateway that cannot answer. */
async function healthGate(gateway) {
  const s = spinner();
  s.start(`Checking ${gateway}`);
  const health = await checkHealth({ gateway });
  s.stop(health.detail, health.ok ? 0 : 1);
  return health;
}

async function main() {
  const gateway = values.gateway ?? process.env.DEEPVARIANCE_GATEWAY ?? DEFAULT_GATEWAY;

  if (values.health) {
    intro('Gateway health check');
    const health = await healthGate(gateway);
    if (health.ok) {
      outro('Gateway is up.');
      return;
    }
    cancel('Gateway is down. Nothing was installed or configured.');
    process.exit(1);
  }

  intro(`Setting up ${MODEL_NAME} for VS Code`);

  // Fail before we touch the editor or the filesystem.
  const health = await healthGate(gateway);
  if (!health.ok) {
    cancel('Gateway is down, so your API key cannot be created. Nothing was installed or configured — try again later.');
    process.exit(1);
  }

  const target = required(
    values.target ??
      (await select({
        message: 'Where should the model be set up?',
        options: [
          { value: 'chat', label: "VS Code's built-in Chat", hint: 'no extension needed' },
          { value: 'continue', label: 'The Continue extension', hint: 'installs Continue' },
          { value: 'both', label: 'Both' },
        ],
      })),
  );

  const wantsChat = target === 'chat' || target === 'both';
  const wantsContinue = target === 'continue' || target === 'both';

  // Both targets install something now: the provider extension, or Continue.
  let editor = null;
  {
    const editors = detectEditors();
    if (editors.length === 0) {
      // handled per-target below
    } else if (editors.length === 1 || values.yes) {
      // --yes means ask nothing: take the first match (VS Code before its forks).
      editor = editors[0];
    } else {
      editor = required(
        await select({
          message: 'Which editor should it be installed into?',
          options: editors.map((e) => ({ value: e, label: e.name, hint: e.bin })),
        }),
      );
    }
  }

  const email = required(
    values.email ??
      process.env.DEEPVARIANCE_EMAIL ??
      (await text({
        message: 'Your email address',
        placeholder: 'you@example.com',
        validate: (value) => (isValidEmail(value) ? undefined : 'That does not look like an email address.'),
      })),
  ).trim();

  if (!isValidEmail(email)) {
    cancel(`"${email}" does not look like an email address.`);
    process.exit(1);
  }

  // Testers share one invite, so we ship it and only ask for what is actually personal.
  const invite = values.invite ?? process.env.DEEPVARIANCE_INVITE ?? DEFAULT_INVITE;

  if (!values.yes) {
    const proceed = required(
      await confirm({ message: 'Create your API key and configure VS Code? Any existing config is backed up first.' }),
    );
    if (!proceed) {
      cancel('Setup cancelled. Nothing was changed.');
      process.exit(0);
    }
  }

  const s = spinner();

  s.start('Creating your personal API key');
  let apiKey;
  try {
    const result = await register({ gateway, email, invite: invite.trim() });
    apiKey = result.apiKey;
    // Every call mints a fresh key — created_user only says whether the account was new.
    // Keys accumulate rather than rotate, so any key you already use stays valid.
    s.stop(`New key issued for ${result.email}${result.createdUser ? '' : ' (account already existed)'}`);
  } catch (error) {
    s.stop('Could not create your API key', 1);
    cancel(error.message);
    process.exit(1);
  }

  if (!apiKey.startsWith('sk-wh-')) {
    log.warn('The gateway returned a key that does not start with "sk-wh-". Using it anyway.');
  }

  if (wantsChat) {
    const chatEditor = editor;
    if (!chatEditor) {
      log.warn(`No VS Code install found. Install it from ${VSCODE_DOWNLOAD_URL}, then re-run.`);
    } else {
      s.start(`Adding ${MODEL_NAME} to ${chatEditor.name}'s Chat`);
      try {
        // The extension IS the model provider, so it stays installed. Only the key handoff
        // is transient: the extension moves it into SecretStorage and deletes the file.
        installVsix(chatEditor.bin, vsixPath());
        await writeHandoff({ apiKey, gateway, email });
        s.stop(`Installed the Deep Variance provider into ${chatEditor.name}`);
      } catch (error) {
        s.stop('Could not install the Deep Variance provider', 1);
        log.warn(error.message);
      }

      // An older run may have left a keyless BYOK group that shows a broken duplicate model.
      const stale = await removeStaleGroup();
      if (stale.removed) log.info('Removed the old key-pasting setup from chatLanguageModels.json');
    }
  }

  if (wantsContinue) {
    if (editor) {
      s.start(`Installing the Continue extension into ${editor.name}`);
      try {
        if (isExtensionInstalled(editor.bin)) {
          s.stop(`Continue is already installed in ${editor.name}`);
        } else {
          installExtension(editor.bin);
          s.stop(`Installed Continue into ${editor.name}`);
        }
      } catch (error) {
        s.stop('Could not install the Continue extension', 1);
        log.warn(`${error.message}\nInstall "${EXTENSION_ID}" from the Extensions panel by hand.`);
      }
    }

    s.start('Writing Continue configuration');
    try {
      const written = await writeConfig({ apiKey, gateway, email, path: configPath() });
      s.stop(written.unchanged ? 'Continue already up to date' : `Wrote ${written.path}`);
      if (written.backup) log.info(`Your previous Continue config was saved to ${written.backup}`);
    } catch (error) {
      s.stop('Could not write the Continue configuration', 1);
      log.warn(`${error.message}\n\nPaste this into ${configPath()} yourself:\n\n${buildConfig({ apiKey, gateway, email })}`);
    }
  }

  const next = [];
  if (wantsChat) next.push(`Reload VS Code, then pick "${MODEL_NAME}" in the Chat model picker.`);
  if (wantsContinue) next.push(`Open the Continue panel and pick "${MODEL_NAME}".`);
  note(next.join('\n'), 'You are set — no key to paste');

  outro('Happy coding!');
}

main().catch((error) => {
  cancel(error?.stack ?? String(error));
  process.exit(1);
});
