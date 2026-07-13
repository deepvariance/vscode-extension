'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

/**
 * Loads the built bundle exactly as VS Code does — require() with `vscode` resolved from
 * outside — so this covers the real dist/extension.js, not the sources.
 */
function loadExtension(vscodeStub) {
  const load = Module._load;
  Module._load = (request, ...rest) => (request === 'vscode' ? vscodeStub : load(request, ...rest));
  try {
    delete require.cache[require.resolve('../dist/extension.js')];
    return require('../dist/extension.js');
  } finally {
    Module._load = load;
  }
}

function makeVscode({ settings = {}, installedExtensions = [] } = {}) {
  const shown = { info: [], error: [], warning: [] };
  const commands = new Map();
  const executed = [];

  return {
    shown,
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return { dispose() {} };
      },
      executeCommand: async (id, ...args) => {
        executed.push([id, ...args]);
      },
    },
    window: {
      withProgress: (_opts, task) => task({ report() {} }),
      showInformationMessage: async (message) => {
        shown.info.push(message);
        return undefined;
      },
      showErrorMessage: async (message) => {
        shown.error.push(message);
        return undefined;
      },
      showWarningMessage: async (message) => {
        shown.warning.push(message);
        return undefined;
      },
      showInputBox: async () => undefined,
    },
    workspace: {
      getConfiguration: () => ({ get: (key) => settings[key] }),
    },
    extensions: {
      getExtension: (id) => (installedExtensions.includes(id) ? { id } : undefined),
    },
    ProgressLocation: { Notification: 15 },
    // exposed for assertions
    _registered: commands,
    _executed: executed,
  };
}

/** Stub global fetch so the tests never touch the network. */
function withFetch(status, body, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  });
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = real;
  });
}

test('activate registers both commands', () => {
  const vscode = makeVscode();
  loadExtension(vscode).activate({ subscriptions: [] });

  assert.deepEqual([...vscode._registered.keys()].sort(), ['deepvariance.health', 'deepvariance.setup']);
});

test('health command reports a healthy gateway', async () => {
  const vscode = makeVscode();
  loadExtension(vscode).activate({ subscriptions: [] });

  await withFetch(200, JSON.stringify({ status: 'ok', detail: 'upstream ok' }), () =>
    vscode._registered.get('deepvariance.health')(),
  );

  assert.equal(vscode.shown.error.length, 0);
  assert.match(vscode.shown.info[0], /upstream ok/);
});

test('health command reports a down gateway as an error', async () => {
  const vscode = makeVscode();
  loadExtension(vscode).activate({ subscriptions: [] });

  await withFetch(530, '', () => vscode._registered.get('deepvariance.health')());

  assert.equal(vscode.shown.info.length, 0);
  assert.match(vscode.shown.error[0], /530/);
});

test('setup aborts before prompting when the gateway is down', async () => {
  const vscode = makeVscode();
  let prompted = false;
  vscode.window.showInputBox = async () => {
    prompted = true;
    return 'a@b.com';
  };
  loadExtension(vscode).activate({ subscriptions: [] });

  await withFetch(530, '', () => vscode._registered.get('deepvariance.setup')());

  assert.equal(prompted, false, 'must not ask for an email against a dead gateway');
  assert.match(vscode.shown.error[0], /Nothing was installed or configured/);
  assert.equal(vscode._executed.length, 0, 'must not install anything');
});

test('setup uses the configured gateway override', async () => {
  const vscode = makeVscode({ settings: { gateway: 'https://staging.example.com' } });
  loadExtension(vscode).activate({ subscriptions: [] });

  let requested;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({ status: 'ok' }) };
  };
  try {
    await vscode._registered.get('deepvariance.health')();
  } finally {
    globalThis.fetch = real;
  }

  assert.equal(requested, 'https://staging.example.com/health');
});
