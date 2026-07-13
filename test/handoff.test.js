import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { consumeHandoff, writeHandoff } from '../src/handoff.js';

test('the handoff is written 0600 and consumed exactly once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-h-'));
  const path = join(dir, 'handoff.json');

  await writeHandoff({ apiKey: 'sk-wh-x', gateway: 'https://g', email: 'a@b.com', path });
  assert.equal((await stat(path)).mode & 0o777, 0o600, 'the key must not be world-readable');

  const first = await consumeHandoff(path);
  assert.equal(first.apiKey, 'sk-wh-x');

  // The extension deletes it, so a second read finds nothing — the key does not linger.
  assert.equal(await consumeHandoff(path), null);
});

test('a corrupt handoff is discarded rather than half-applied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-h-'));
  const path = join(dir, 'handoff.json');
  await writeFile(path, '{ broken');

  assert.equal(await consumeHandoff(path), null);
  assert.equal(await consumeHandoff(path), null);
});
