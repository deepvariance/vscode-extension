'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

/** The part classes VS Code hands a provider. The bundle uses `instanceof` against these. */
class LanguageModelTextPart {
  constructor(value) {
    this.value = value;
  }
}
class LanguageModelToolCallPart {
  constructor(callId, name, input) {
    Object.assign(this, { callId, name, input });
  }
}
class LanguageModelToolResultPart {
  constructor(callId, content) {
    Object.assign(this, { callId, content });
  }
}
class LanguageModelDataPart {
  constructor(data, mimeType) {
    Object.assign(this, { data, mimeType });
  }
}

const vscodeStub = {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  EventEmitter: class {
    constructor() {
      this.fired = 0;
      this.event = () => ({ dispose() {} });
    }
    fire() {
      this.fired++;
    }
  },
  lm: { registerLanguageModelChatProvider: () => ({ dispose() {} }) },
  commands: { registerCommand: () => ({ dispose() {} }) },
  window: { showInformationMessage: async () => undefined },
  workspace: { getConfiguration: () => ({ inspect: () => undefined, update: async () => {} }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { Notification: 15 },
};

function load() {
  const original = Module._load;
  Module._load = (request, ...rest) => (request === 'vscode' ? vscodeStub : original(request, ...rest));
  try {
    delete require.cache[require.resolve('../dist/test-entry.cjs')];
    return require('../dist/test-entry.cjs');
  } finally {
    Module._load = original;
  }
}

const { toOpenAIMessages, toOpenAITools, DeepVarianceProvider, ensureAgentWindow, ensureByokUtilityDefault, ensureDefaultModel, activate } =
  load();
const USER = 1;
const ASSISTANT = 2;

/** Fake `chat` configuration: records update() calls, seeds inspect(). */
function fakeConfig(inspectResult) {
  const updates = [];
  return {
    inspect: () => inspectResult,
    update: async (key, value, target) => updates.push({ key, value, target }),
    updates,
  };
}

test('byok utility: flips the default none -> mainAgent so agent mode does not error', async () => {
  const cfg = fakeConfig({ defaultValue: 'none', globalValue: undefined });
  const changed = await ensureByokUtilityDefault(cfg);
  assert.equal(changed, true);
  assert.deepEqual(cfg.updates, [{ key: 'byokUtilityModelDefault', value: 'mainAgent', target: 1 }]);
});

test('byok utility: never overrides a value the user set', async () => {
  const cfg = fakeConfig({ defaultValue: 'none', globalValue: 'copilot' });
  assert.equal(await ensureByokUtilityDefault(cfg), false);
  assert.deepEqual(cfg.updates, [], 'must not touch a user-chosen value');
});

test('byok utility: no-op when the setting is absent (older VS Code)', async () => {
  const cfg = fakeConfig(undefined); // inspect() returns undefined -> setting not registered
  assert.equal(await ensureByokUtilityDefault(cfg), false);
  assert.deepEqual(cfg.updates, [], 'update() would throw on an unregistered key');
});

/** Fake `chat` config keyed per setting, so the two agent-window keys can differ. */
function fakeConfigByKey(inspectByKey) {
  const updates = [];
  return {
    inspect: (key) => inspectByKey[key],
    update: async (key, value, target) => updates.push({ key, value, target }),
    updates,
  };
}

test('agent window: turns on both settings, which are off by default on stable VS Code', async () => {
  // A BYOK model reaches the agent host only when both are true; neither is by default on stable.
  const cfg = fakeConfigByKey({
    'agentHost.enabled': { defaultValue: false },
    'agentHost.byokModels.enabled': { defaultValue: false },
  });

  assert.deepEqual(await ensureAgentWindow(cfg), ['agentHost.enabled', 'agentHost.byokModels.enabled']);
  assert.deepEqual(cfg.updates, [
    { key: 'agentHost.enabled', value: true, target: 1 },
    { key: 'agentHost.byokModels.enabled', value: true, target: 1 },
  ]);
});

test('agent window: leaves alone what is already on by default (Insiders)', async () => {
  const cfg = fakeConfigByKey({
    'agentHost.enabled': { defaultValue: true }, // Insiders: quality !== 'stable'
    'agentHost.byokModels.enabled': { defaultValue: false },
  });

  assert.deepEqual(await ensureAgentWindow(cfg), ['agentHost.byokModels.enabled'], 'only the one that is actually off');
});

test('agent window: never overrides a user or policy choice', async () => {
  const cfg = fakeConfigByKey({
    'agentHost.enabled': { defaultValue: false, globalValue: false }, // user turned it off on purpose
    'agentHost.byokModels.enabled': { defaultValue: false, policyValue: false },
  });

  assert.deepEqual(await ensureAgentWindow(cfg), []);
  assert.deepEqual(cfg.updates, [], 'an explicit "off" is an answer, not an omission');
});

test('agent window: no-op where the settings do not exist (older VS Code, Cursor)', async () => {
  // Cursor's base is VS Code 1.105 and has no chat.agentHost.* at all.
  const cfg = fakeConfigByKey({});
  assert.deepEqual(await ensureAgentWindow(cfg), []);
  assert.deepEqual(cfg.updates, [], 'update() would throw on an unregistered key');
});

test('default model: fills the empty default so a new chat starts on our model', async () => {
  const cfg = fakeConfig({ defaultValue: '', globalValue: undefined });
  assert.equal(await ensureDefaultModel(cfg), true);
  // VS Code matches this against the model id, case-insensitively — it must be the id we register.
  assert.deepEqual(cfg.updates, [{ key: 'defaultModel', value: 'Qwen/Qwen3.6-27B-FP8', target: 1 }]);
});

test('default model: never overrides a model the user picked', async () => {
  const cfg = fakeConfig({ defaultValue: '', globalValue: 'gpt-4o' });
  assert.equal(await ensureDefaultModel(cfg), false);
  assert.deepEqual(cfg.updates, [], 'must not touch a user-chosen model');
});

test('default model: never overrides an enterprise policy', async () => {
  const cfg = fakeConfig({ defaultValue: '', policyValue: 'gpt-4o', globalValue: undefined });
  assert.equal(await ensureDefaultModel(cfg), false);
  assert.deepEqual(cfg.updates, [], 'policy wins; writing would be pointless or throw');
});

test('default model: no-op when the setting is absent (older VS Code)', async () => {
  const cfg = fakeConfig(undefined);
  assert.equal(await ensureDefaultModel(cfg), false);
  assert.deepEqual(cfg.updates, [], 'update() would throw on an unregistered key');
});

/** Runs activate() against a temp HOME seeded with the given handoff; records what the user saw. */
async function activateWithHandoff(handoff, { agentSettingsAreOff = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-handoff-'));
  fs.mkdirSync(path.join(home, '.deepvariance'));
  fs.writeFileSync(path.join(home, '.deepvariance', 'handoff.json'), JSON.stringify(handoff));

  const realHome = process.env.HOME;
  const realWindow = vscodeStub.window;
  const realWorkspace = vscodeStub.workspace;
  const realCommands = vscodeStub.commands;
  const messages = [];
  const executed = [];
  const updated = [];

  process.env.HOME = home;
  vscodeStub.window = {
    showInformationMessage: async (message, ...actions) => {
      messages.push({ message, actions });
      return actions[0]; // the user clicks the offered button
    },
  };
  // Stable VS Code's real defaults: everything we manage is off/unset out of the box.
  const DEFAULTS = {
    byokUtilityModelDefault: 'none',
    defaultModel: '',
    'agentHost.enabled': false, // `quality !== "stable"` is false on stable
    'agentHost.byokModels.enabled': false,
  };

  vscodeStub.workspace = {
    getConfiguration: () => ({
      inspect: (key) => (agentSettingsAreOff && key in DEFAULTS ? { defaultValue: DEFAULTS[key] } : undefined),
      update: async (key, value) => updated.push({ key, value }),
    }),
  };
  vscodeStub.commands = { registerCommand: () => ({ dispose() {} }), executeCommand: async (c) => executed.push(c) };

  try {
    await activate({
      subscriptions: [],
      secrets: { get: async () => 'sk-wh-x', store: async () => {}, delete: async () => {} },
      globalState: { get: () => undefined, update: async () => {} },
    });
    return { messages, executed, updated, handoffGone: !fs.existsSync(path.join(home, '.deepvariance', 'handoff.json')) };
  } finally {
    process.env.HOME = realHome;
    vscodeStub.window = realWindow;
    vscodeStub.workspace = realWorkspace;
    vscodeStub.commands = realCommands;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('handoff with agents:yes turns the agent window on and offers the reload it needs', async () => {
  // The agent host only starts at window load, so settings written now need one more restart.
  const { messages, executed, updated, handoffGone } = await activateWithHandoff({
    apiKey: 'sk-wh-x',
    gateway: 'https://demo.deepvariance.com',
    email: 'a@b.com',
    agents: true,
  });

  assert.ok(handoffGone, 'the plaintext key must not be left on disk');
  assert.deepEqual(
    updated.map((u) => u.key).sort(),
    ['agentHost.byokModels.enabled', 'agentHost.enabled', 'byokUtilityModelDefault', 'defaultModel'],
  );
  assert.match(messages.at(-1).message, /Reload/, 'must tell them a reload is needed');
  assert.deepEqual(messages.at(-1).actions, ['Reload Window']);
  assert.deepEqual(executed, ['workbench.action.reloadWindow'], 'clicking it must actually reload');
});

test('handoff with agents:no leaves the agent window alone and does not nag about reloading', async () => {
  const { messages, executed, updated } = await activateWithHandoff({
    apiKey: 'sk-wh-x',
    gateway: 'https://demo.deepvariance.com',
    email: 'a@b.com',
    agents: false,
  });

  assert.deepEqual(
    updated.map((u) => u.key).sort(),
    ['byokUtilityModelDefault', 'defaultModel'],
    'a "no" must not touch chat.agentHost.*',
  );
  assert.deepEqual(executed, [], 'nothing to reload for');
  assert.doesNotMatch(messages.at(-1).message, /Reload/);
});

test('activation resolves our models, so Agent Sessions can see them', async () => {
  // Registering a provider does not populate VS Code's model cache — only resolving a vendor does,
  // and the only triggers are the regular Chat picker or the provider's change event. The agent-host
  // bridge behind Agent Sessions just reads that cache, so without this fire it finds nothing and
  // offers only "Auto".
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-activate-')); // keep the real handoff safe
  const realHome = process.env.HOME;
  const realRegister = vscodeStub.lm.registerLanguageModelChatProvider;
  let registered;

  process.env.HOME = home;
  vscodeStub.lm.registerLanguageModelChatProvider = (vendor, provider) => {
    registered = { vendor, provider };
    return { dispose() {} };
  };

  try {
    await activate({
      subscriptions: [],
      secrets: { get: async () => 'sk-wh-x', store: async () => {}, delete: async () => {} },
      globalState: { get: () => undefined, update: async () => {} },
    });

    assert.equal(registered.vendor, 'deepvariance');
    assert.ok(registered.provider._onDidChange.fired > 0, 'activate() must fire the change event or Agent Sessions only offers "Auto"');
  } finally {
    process.env.HOME = realHome;
    vscodeStub.lm.registerLanguageModelChatProvider = realRegister;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a plain user turn becomes a plain string message', () => {
  const out = toOpenAIMessages([{ role: USER, content: [new LanguageModelTextPart('hello')] }]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
});

test('an image turn becomes an OpenAI image_url data URI', () => {
  const out = toOpenAIMessages([
    {
      role: USER,
      content: [new LanguageModelTextPart('what is this?'), new LanguageModelDataPart(Buffer.from([1, 2, 3]), 'image/png')],
    },
  ]);

  assert.equal(out.length, 1);
  assert.equal(out[0].content[0].type, 'text');
  assert.equal(out[0].content[1].type, 'image_url');
  assert.match(out[0].content[1].image_url.url, /^data:image\/png;base64,AQID$/);
});

test('an assistant tool call becomes tool_calls with stringified arguments', () => {
  const out = toOpenAIMessages([
    { role: ASSISTANT, content: [new LanguageModelToolCallPart('call_1', 'get_weather', { city: 'Paris' })] },
  ]);

  assert.equal(out[0].role, 'assistant');
  assert.deepEqual(out[0].tool_calls, [
    { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
  ]);
});

test('a tool result becomes its own tool message keyed by call id', () => {
  const out = toOpenAIMessages([
    { role: ASSISTANT, content: [new LanguageModelToolCallPart('call_1', 'get_weather', { city: 'Paris' })] },
    { role: USER, content: [new LanguageModelToolResultPart('call_1', [new LanguageModelTextPart('18C')])] },
  ]);

  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { role: 'tool', tool_call_id: 'call_1', content: '18C' });
});

test('a tool result followed by user text keeps the tool message first', () => {
  const out = toOpenAIMessages([
    {
      role: USER,
      content: [new LanguageModelToolResultPart('call_1', [new LanguageModelTextPart('18C')]), new LanguageModelTextPart('thanks')],
    },
  ]);

  assert.deepEqual(out.map((m) => m.role), ['tool', 'user'], 'the tool result must precede the user turn');
});

test('tools are converted, and a tool with no schema still gets a valid one', () => {
  const tools = toOpenAITools([
    { name: 'a', description: 'does a', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
    { name: 'b', description: 'does b' },
  ]);

  assert.equal(tools[0].function.parameters.properties.x.type, 'string');
  assert.deepEqual(tools[1].function.parameters, { type: 'object', properties: {} });
  assert.equal(toOpenAITools([]), undefined);
});

test('no model is offered until a key exists', async () => {
  const noKey = new DeepVarianceProvider({ secrets: { get: async () => undefined }, globalState: { get: () => undefined } });
  assert.deepEqual(await noKey.provideLanguageModelChatInformation({ silent: true }), []);

  const withKey = new DeepVarianceProvider({ secrets: { get: async () => 'sk-wh-x' }, globalState: { get: () => undefined } });
  const [model] = await withKey.provideLanguageModelChatInformation({ silent: true });

  assert.equal(model.id, 'Qwen/Qwen3.6-27B-FP8', 'the exact served id, no alias');
  assert.equal(model.capabilities.toolCalling, true);
  assert.equal(model.capabilities.imageInput, true);
  assert.ok(model.maxInputTokens > 0 && model.maxInputTokens < 131072);
});

test('a streamed response emits text parts and a completed tool call', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Paris\\"}"}}]}}]}\n',
    'data: [DONE]\n',
  ];

  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () =>
            i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined },
        };
      },
    },
  });

  try {
    const provider = new DeepVarianceProvider({
      secrets: { get: async () => 'sk-wh-x' },
      globalState: { get: () => undefined },
    });

    const reported = [];
    await provider.provideLanguageModelChatResponse(
      { id: 'Qwen/Qwen3.6-27B-FP8', maxOutputTokens: 100 },
      [{ role: USER, content: [new LanguageModelTextPart('hi')] }],
      { tools: [], toolMode: 1 },
      { report: (part) => reported.push(part) },
      { onCancellationRequested: () => ({ dispose() {} }) },
    );

    const text = reported.filter((p) => p instanceof LanguageModelTextPart).map((p) => p.value).join('');
    assert.equal(text, 'Hello', 'streamed text must arrive in order');

    const call = reported.find((p) => p instanceof LanguageModelToolCallPart);
    assert.equal(call.name, 'get_weather');
    assert.deepEqual(call.input, { city: 'Paris' }, 'argument fragments must be reassembled across chunks');
  } finally {
    globalThis.fetch = real;
  }
});

test('a 401 tells the user how to fix it', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => '{"detail":"invalid or disabled api key"}' });

  try {
    const provider = new DeepVarianceProvider({ secrets: { get: async () => 'sk-wh-bad' }, globalState: { get: () => undefined } });
    await assert.rejects(
      provider.provideLanguageModelChatResponse(
        { id: 'Qwen/Qwen3.6-27B-FP8', maxOutputTokens: 100 },
        [{ role: USER, content: [new LanguageModelTextPart('hi')] }],
        { tools: [] },
        { report() {} },
        { onCancellationRequested: () => ({ dispose() {} }) },
      ),
      /npx @deepvariance\/vscode/,
    );
  } finally {
    globalThis.fetch = real;
  }
});

test('images are capped at the server limit, keeping the most recent', () => {
  // The cap is per request, and a request carries the whole conversation.
  const img = (n) => new LanguageModelDataPart(Buffer.from([n]), 'image/png');
  const messages = [
    { role: USER, content: [new LanguageModelTextPart('first'), img(1), img(2)] },
    { role: USER, content: [img(3), img(4), img(5), new LanguageModelTextPart('what is this?')] },
  ];

  const out = toOpenAIMessages(messages);
  const parts = out.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const images = parts.filter((p) => p.type === 'image_url');
  const notes = parts.filter((p) => p.type === 'text' && p.text.includes('left out'));

  assert.equal(images.length, 4, 'never send more images than the server accepts');
  assert.equal(notes.length, 1, 'the dropped image is announced, not silently swallowed');

  // The kept images must be the LAST four (2,3,4,5) — the oldest is the one dropped.
  const kept = images.map((i) => i.image_url.url.split(',')[1]);
  assert.deepEqual(kept, [2, 3, 4, 5].map((n) => Buffer.from([n]).toString('base64')));
});

test('a conversation under the cap is untouched', () => {
  const img = new LanguageModelDataPart(Buffer.from([9]), 'image/png');
  const out = toOpenAIMessages([{ role: USER, content: [new LanguageModelTextPart('hi'), img] }]);
  const parts = out.flatMap((m) => (Array.isArray(m.content) ? m.content : []));

  assert.equal(parts.filter((p) => p.type === 'image_url').length, 1);
  assert.equal(parts.filter((p) => p.type === 'text' && p.text.includes('left out')).length, 0);
});

test('an image inside a tool result becomes a short placeholder, not a byte blob', () => {
  const out = toOpenAIMessages([
    {
      role: USER,
      content: [new LanguageModelToolResultPart('call_1', [new LanguageModelDataPart(Buffer.from([1, 2, 3, 4]), 'image/png')])],
    },
  ]);

  const toolMsg = out.find((m) => m.role === 'tool');
  assert.equal(toolMsg.content, '[tool returned an image]');
  assert.ok(!/\d,\d/.test(toolMsg.content), 'must not dump the raw Uint8Array');
});
