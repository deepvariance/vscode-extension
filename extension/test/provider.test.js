'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
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
      this.event = () => ({ dispose() {} });
    }
    fire() {}
  },
  lm: { registerLanguageModelChatProvider: () => ({ dispose() {} }) },
  commands: { registerCommand: () => ({ dispose() {} }) },
  window: {},
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

const { toOpenAIMessages, toOpenAITools, DeepVarianceProvider } = load();
const USER = 1;
const ASSISTANT = 2;

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

  assert.equal(model.id, 'qwen-coder', 'must be the gateway alias');
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
      { id: 'qwen-coder', maxOutputTokens: 100 },
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
        { id: 'qwen-coder', maxOutputTokens: 100 },
        [{ role: USER, content: [new LanguageModelTextPart('hi')] }],
        { tools: [] },
        { report() {} },
        { onCancellationRequested: () => ({ dispose() {} }) },
      ),
      /npx deepvariance-vscode/,
    );
  } finally {
    globalThis.fetch = real;
  }
});
