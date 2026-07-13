import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { enableProposedApi, stripComments, withProposedApi } from '../src/argv.js';

const EXT = 'deepvariance.deepvariance-vscode';

// This is what VS Code actually ships in ~/.vscode/argv.json — JSON with comments.
const SHIPPED = `// This configuration file allows you to pass permanent command line arguments.
// PLEASE DO NOT CHANGE WITHOUT UNDERSTANDING THE IMPACT
{
	// Allows to disable crash reporting.
	"enable-crash-reporter": true,

	// Do not edit this value.
	"crash-reporter-id": "af58f0b0-720c-4a48-8ca2-56d424c970a1"
}
`;

test('stripComments turns the shipped JSONC into parseable JSON', () => {
  const parsed = JSON.parse(stripComments(SHIPPED));
  assert.equal(parsed['enable-crash-reporter'], true);
  assert.equal(parsed['crash-reporter-id'], 'af58f0b0-720c-4a48-8ca2-56d424c970a1');
});

test('withProposedApi appends without dropping other entries, and is idempotent', () => {
  const once = withProposedApi({ 'enable-proposed-api': ['other.ext'] }, EXT);
  assert.deepEqual(once['enable-proposed-api'], ['other.ext', EXT]);

  const twice = withProposedApi(once, EXT);
  assert.equal(twice, once, 'a second run must not duplicate the entry');
});

test('enableProposedApi preserves the settings VS Code put there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-argv-'));
  const path = join(dir, 'argv.json');
  await writeFile(path, SHIPPED);

  const result = await enableProposedApi({ extensionId: EXT, path });
  assert.equal(result.changed, true);

  const next = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(next['enable-proposed-api'], [EXT]);
  assert.equal(next['enable-crash-reporter'], true, 'existing settings must survive');
  assert.equal(next['crash-reporter-id'], 'af58f0b0-720c-4a48-8ca2-56d424c970a1');

  // and the original is kept
  assert.match(await readFile(`${path}.backup`, 'utf8'), /DO NOT CHANGE/);
});

test('enableProposedApi reports no change on a re-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-argv-'));
  const path = join(dir, 'argv.json');
  await writeFile(path, SHIPPED);

  await enableProposedApi({ extensionId: EXT, path });
  assert.equal((await enableProposedApi({ extensionId: EXT, path })).changed, false);
});

test('enableProposedApi creates argv.json when VS Code has never written one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-argv-'));
  const path = join(dir, '.vscode', 'argv.json');

  await enableProposedApi({ extensionId: EXT, path });

  assert.deepEqual(JSON.parse(await readFile(path, 'utf8'))['enable-proposed-api'], [EXT]);
});

test('a hand-broken argv.json is left alone rather than clobbered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-argv-'));
  const path = join(dir, 'argv.json');
  await writeFile(path, '{ oops');

  await assert.rejects(enableProposedApi({ extensionId: EXT, path }), /not valid JSON/);
  assert.equal(await readFile(path, 'utf8'), '{ oops');
});
