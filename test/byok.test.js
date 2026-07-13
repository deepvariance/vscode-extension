import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { GROUP_NAME, VENDOR, buildGroup, byokConfigPath, mergeGroup, writeByokConfig } from '../src/vscode-byok.js';

const GATEWAY = 'https://demo.deepvariance.com';

test('byokConfigPath points at VS Code user data per platform', () => {
  assert.equal(
    byokConfigPath({ home: '/Users/t', platform: 'darwin' }),
    '/Users/t/Library/Application Support/Code/User/chatLanguageModels.json',
  );
  assert.equal(byokConfigPath({ home: '/home/t', platform: 'linux' }), '/home/t/.config/Code/User/chatLanguageModels.json');
});

test('buildGroup matches the customendpoint schema VS Code requires', () => {
  const group = buildGroup({ gateway: `${GATEWAY}/`, email: 'a@b.com' });

  assert.equal(group.vendor, VENDOR);
  assert.equal(group.apiType, 'chat-completions');

  const [model] = group.models;
  // Required by the schema: id, name, url, toolCalling, vision, maxOutputTokens, and a window.
  for (const key of ['id', 'name', 'url', 'toolCalling', 'vision', 'maxOutputTokens', 'contextWindow']) {
    assert.ok(model[key] !== undefined, `${key} is required by VS Code`);
  }
  assert.equal(model.id, 'qwen-coder', 'must be the gateway alias, not the underlying model id');
  assert.equal(model.url, `${GATEWAY}/v1/chat/completions`);
  assert.equal(model.toolCalling, true);
  assert.equal(model.vision, true);
});

test('buildGroup never writes the API key — VS Code keeps it in secret storage', () => {
  const group = buildGroup({ gateway: GATEWAY, email: 'a@b.com' });
  assert.equal(group.apiKey, undefined);
  assert.equal(JSON.stringify(group).includes('sk-wh-'), false);
});

test('buildGroup does not send authorization as a request header (VS Code forbids it)', () => {
  const [model] = buildGroup({ gateway: GATEWAY, email: 'a@b.com' }).models;
  const headers = Object.keys(model.requestHeaders).map((h) => h.toLowerCase());
  assert.ok(!headers.includes('authorization'));
  assert.equal(model.requestHeaders['X-User-Email'], 'a@b.com');
});

test('mergeGroup leaves other providers alone', () => {
  const existing = [
    { name: 'My OpenAI', vendor: 'openai' },
    { name: 'Local', vendor: 'ollama' },
  ];
  const group = buildGroup({ gateway: GATEWAY, email: 'a@b.com' });

  const merged = mergeGroup(existing, group);

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.slice(0, 2), existing, 'other vendors must survive untouched');
  assert.equal(merged[2].name, GROUP_NAME);
});

test('mergeGroup replaces our own group instead of duplicating it', () => {
  const group = buildGroup({ gateway: GATEWAY, email: 'a@b.com' });
  const stale = { name: GROUP_NAME, vendor: VENDOR, models: [{ id: 'old' }] };

  const merged = mergeGroup([{ name: 'My OpenAI', vendor: 'openai' }, stale], group);

  assert.equal(merged.length, 2);
  assert.equal(merged[1].models[0].id, 'qwen-coder');
});

test('writeByokConfig preserves an existing file and backs it up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-byok-'));
  const path = join(dir, 'chatLanguageModels.json');
  await writeFile(path, JSON.stringify([{ name: 'My OpenAI', vendor: 'openai' }], null, 2));

  const result = await writeByokConfig({ gateway: GATEWAY, email: 'a@b.com', path, stamp: 'STAMP' });

  const written = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(written.length, 2);
  assert.equal(written[0].vendor, 'openai');
  assert.equal(written[1].vendor, VENDOR);
  assert.match(await readFile(result.backup, 'utf8'), /My OpenAI/);
});

test('writeByokConfig handles the empty array VS Code ships by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-byok-'));
  const path = join(dir, 'chatLanguageModels.json');
  await writeFile(path, '[]');

  await writeByokConfig({ gateway: GATEWAY, email: 'a@b.com', path });

  const written = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(written.length, 1);
  assert.equal(written[0].models[0].name, 'Qwen3-VL Coder');
});

test('writeByokConfig refuses to touch a file it cannot parse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-byok-'));
  const path = join(dir, 'chatLanguageModels.json');
  await writeFile(path, '{ this is not json');

  await assert.rejects(writeByokConfig({ gateway: GATEWAY, email: 'a@b.com', path }), /not valid JSON/);
  assert.equal(await readFile(path, 'utf8'), '{ this is not json', 'must be left untouched');
});
