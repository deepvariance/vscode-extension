#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from '@clack/prompts';

import { enableProposedApi } from '../src/argv.js';
import { VSCODE_DOWNLOAD_URL, detectEditors, installVsix, vsixPath } from '../src/editor.js';
import { DEFAULT_GATEWAY, DEFAULT_INVITE, checkHealth, isValidEmail, register } from '../src/gateway.js';
import { writeHandoff } from '../src/handoff.js';
import { MODEL_NAME } from '../src/model.js';

const PROVIDER_EXTENSION_ID = 'deepvariance.deepvariance-vscode';

/**
 * The agent window is a VS Code feature. Its settings don't exist in forks — Cursor's base is
 * VS Code 1.105 and has no `chat.agentHost.*` at all — so don't offer it where it can't work.
 */
const HAS_AGENT_WINDOW = new Set(['code', 'code-insiders']);

const HELP = `
  deepvariance-vscode — set up ${MODEL_NAME} in VS Code

  Usage
    npx @deepvariance/vscode [options]

  Options
    --health           Only check that the gateway is up, then exit
    --email <email>    Your email address
    --invite <token>   Override the built-in tester invite token
    --gateway <url>    Gateway URL (default: ${DEFAULT_GATEWAY})
    --yes              Ask nothing; take the defaults
    --help             Show this message

  Environment
    DEEPVARIANCE_EMAIL, DEEPVARIANCE_INVITE, DEEPVARIANCE_GATEWAY
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      health: { type: 'boolean', default: false },
      email: { type: 'string' },
      invite: { type: 'string' },
      gateway: { type: 'string' },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch (error) {
  // A bad flag should print a clear message and the help, not a raw Node stack trace.
  console.error(`${error.message}\n${HELP}`);
  process.exit(1);
}

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

  // Fail before we touch the editor or the filesystem. A 530 here usually just means the GPU
  // instance is paused.
  const health = await healthGate(gateway);
  if (!health.ok) {
    cancel('Gateway is down, so your API key cannot be created. Nothing was installed or configured — try again later.');
    process.exit(1);
  }

  const editors = detectEditors();
  if (editors.length === 0) {
    cancel(`No VS Code install found. Install it from ${VSCODE_DOWNLOAD_URL}, then re-run.`);
    process.exit(1);
  }

  const editor =
    editors.length === 1 || values.yes
      ? editors[0] // --yes means ask nothing: take the first match (VS Code before its forks)
      : required(
          await select({
            message: 'Which editor should it be installed into?',
            options: editors.map((e) => ({ value: e, label: e.name, hint: e.bin })),
          }),
        );

  // --yes (and any non-TTY, e.g. CI) means don't prompt. @clack's text() never resolves without a
  // TTY, so without this guard `npx … --yes` with no email would hang forever.
  const givenEmail = values.email ?? process.env.DEEPVARIANCE_EMAIL;
  if (!givenEmail && (values.yes || !process.stdin.isTTY)) {
    cancel('No email address. Pass --email or set DEEPVARIANCE_EMAIL.');
    process.exit(1);
  }

  const email = required(
    givenEmail ??
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
    const proceed = required(await confirm({ message: `Create your API key and add ${MODEL_NAME} to ${editor.name}?` }));
    if (!proceed) {
      cancel('Setup cancelled. Nothing was changed.');
      process.exit(0);
    }
  }

  // The agent window is experimental and off by default on stable VS Code, and a BYOK model needs
  // two settings flipped before it shows up there at all. That's their editor to change, so ask —
  // defaulting to yes, since running the model in agent mode is why most testers are here.
  // --yes (and any non-TTY) takes that default rather than hanging on a prompt nobody can answer.
  const agents =
    HAS_AGENT_WINDOW.has(editor.bin) &&
    (values.yes || !process.stdin.isTTY
      ? true
      : required(
          await confirm({
            message: `Turn on the ${editor.name} agent window for ${MODEL_NAME}?`,
            initialValue: true,
          }),
        ));

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

  s.start(`Adding ${MODEL_NAME} to ${editor.name}`);
  try {
    // The extension IS the model provider, so it stays installed. Only the key handoff is
    // transient: the extension moves it into SecretStorage and deletes the file.
    installVsix(editor.bin, vsixPath());
    await writeHandoff({ apiKey, gateway, email, agents });
    s.stop(`Installed the Deep Variance provider into ${editor.name}`);
  } catch (error) {
    s.stop('Could not install the Deep Variance provider', 1);
    cancel(error.message);
    process.exit(1);
  }

  // Showing the model's chain of thought needs a proposed API, which VS Code only grants to an
  // extension named in argv.json. Takes effect on a full restart.
  try {
    const argv = await enableProposedApi({ extensionId: PROVIDER_EXTENSION_ID });
    if (argv.changed) log.info(`Enabled the thinking view (${argv.path})`);
  } catch (error) {
    log.warn(`${error.message}\nThe model will still work; you just won't see it think.`);
  }

  note(`Quit and reopen ${editor.name}, then pick "${MODEL_NAME}" in the Chat model picker.`, 'You are set — no key to paste');

  outro('Happy coding!');
}

main().catch((error) => {
  cancel(error?.stack ?? String(error));
  process.exit(1);
});
