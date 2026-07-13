import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { GROUP_NAME, byokConfigPath, removeStaleGroup, withoutGroup } from '../src/vscode-byok.js';

test('byokConfigPath points at VS Code user data per platform', () => {
  assert.equal(
    byokConfigPath({ home: '/Users/t', platform: 'darwin' }),
    '/Users/t/Library/Application Support/Code/User/chatLanguageModels.json',
  );
  assert.equal(byokConfigPath({ home: '/home/t', platform: 'linux' }), '/home/t/.config/Code/User/chatLanguageModels.json');
});

test('withoutGroup drops only our group', () => {
  const groups = [{ name: 'My OpenAI', vendor: 'openai' }, { name: GROUP_NAME, vendor: 'customendpoint' }];
  assert.deepEqual(withoutGroup(groups), [{ name: 'My OpenAI', vendor: 'openai' }]);
});

test('removeStaleGroup rewrites the file and leaves other providers alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-byok-'));
  const path = join(dir, 'chatLanguageModels.json');
  await writeFile(path, JSON.stringify([{ name: 'My OpenAI', vendor: 'openai' }, { name: GROUP_NAME, vendor: 'customendpoint' }]));

  const result = await removeStaleGroup({ path });

  assert.equal(result.removed, true);
  const left = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(left, [{ name: 'My OpenAI', vendor: 'openai' }]);
});

test('removeStaleGroup is a no-op when there is nothing to clean', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-byok-'));
  const path = join(dir, 'chatLanguageModels.json');
  await writeFile(path, '[]');

  assert.equal((await removeStaleGroup({ path })).removed, false);
  assert.equal((await removeStaleGroup({ path: join(dir, 'nope.json') })).removed, false);
});
