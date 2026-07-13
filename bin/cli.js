#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from '@clack/prompts';

import { buildConfig, configPath, writeConfig, MODEL_NAME } from '../src/continue-config.js';
import { EXTENSION_ID, VSCODE_DOWNLOAD_URL, detectEditors, installExtension, isExtensionInstalled } from '../src/editor.js';
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../src/gateway.js';

const HELP = `
  deepvariance-vscode — set up ${MODEL_NAME} in VS Code

  Usage
    npx deepvariance-vscode [options]

  Options
    --health             Only check that the gateway is up, then exit
    --email <email>      Your email address
    --invite <token>     Override the built-in tester invite token
    --gateway <url>      Gateway URL (default: ${DEFAULT_GATEWAY})
    --skip-extension     Don't install the Continue extension
    --yes                Don't ask for confirmation before overwriting config.yaml
    --help               Show this message

  Environment
    DEEPVARIANCE_EMAIL, DEEPVARIANCE_INVITE, DEEPVARIANCE_GATEWAY
`;

const { values } = parseArgs({
  options: {
    health: { type: 'boolean', default: false },
    email: { type: 'string' },
    invite: { type: 'string' },
    gateway: { type: 'string' },
    'skip-extension': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
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

  // Step 2 — the Continue extension.
  const editors = detectEditors();
  let editor = null;

  if (values['skip-extension']) {
    log.info('Skipping extension install (--skip-extension).');
  } else if (editors.length === 0) {
    log.warn(`No VS Code install found. Install it from ${VSCODE_DOWNLOAD_URL}, then install the "Continue" extension by hand.`);
  } else if (editors.length === 1) {
    editor = editors[0];
  } else {
    const choice = required(
      await select({
        message: 'Which editor should the Continue extension go into?',
        options: editors.map((e) => ({ value: e, label: e.name, hint: e.bin })),
      }),
    );
    editor = choice;
  }

  // Step 3 — trade the invite token for a personal API key.
  const email = required(
    values.email ??
      process.env.DEEPVARIANCE_EMAIL ??
      (await text({
        message: 'Your email address',
        placeholder: 'you@example.com',
        validate: (value) => (isValidEmail(value) ? undefined : 'That does not look like an email address.'),
      })),
  );

  if (!isValidEmail(email)) {
    cancel(`"${email}" does not look like an email address.`);
    process.exit(1);
  }

  // Testers share one invite, so we ship it and only ask for what is actually personal.
  const invite = values.invite ?? process.env.DEEPVARIANCE_INVITE ?? DEFAULT_INVITE;

  const s = spinner();

  s.start('Creating your personal API key');
  let apiKey;
  try {
    const result = await register({ gateway, email: email.trim(), invite: invite.trim() });
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
    log.warn(`The gateway returned a key that does not start with "sk-wh-". Using it anyway.`);
  }

  // Step 2, continued — install the extension now that we know registration worked.
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
      log.warn(`${error.message}\nInstall "${EXTENSION_ID}" from the Extensions panel by hand — the config below is still written.`);
    }
  }

  // Steps 4 and 5 — write the config Continue reads.
  const path = configPath();

  if (!values.yes) {
    const proceed = required(
      await confirm({
        message: `Write ${MODEL_NAME} to ${path}? Any existing config is backed up first.`,
      }),
    );
    if (!proceed) {
      note(buildConfig({ apiKey, gateway, email }), `Nothing written. Paste this into ${path} yourself:`);
      outro('Done.');
      return;
    }
  }

  s.start('Writing Continue configuration');
  let written;
  try {
    written = await writeConfig({ apiKey, gateway, email, path });
  } catch (error) {
    s.stop('Could not write the configuration', 1);
    cancel(`${error.message}\n\nPaste this into ${path} yourself:\n\n${buildConfig({ apiKey, gateway, email })}`);
    process.exit(1);
  }

  s.stop(written.unchanged ? 'Configuration already up to date' : `Wrote ${written.path}`);
  if (written.backup) log.info(`Your previous config was saved to ${written.backup}`);

  note(
    [
      'Open the Continue panel in the sidebar.',
      `Pick "${MODEL_NAME}" as the model.`,
      'Ask it something — it reads code and images.',
    ].join('\n'),
    'You are set',
  );

  outro('Happy coding!');
}

main().catch((error) => {
  cancel(error?.stack ?? String(error));
  process.exit(1);
});
