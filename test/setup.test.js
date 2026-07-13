import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { backupPath, buildConfig, configPath, writeConfig } from '../src/continue-config.js';
import { checkHealth, isValidEmail, normalizeGateway, register } from '../src/gateway.js';

const GATEWAY = 'https://demo.deepvariance.com';

/** Minimal fetch double: returns the given status/body, records the call. */
function stubFetch({ status = 200, body = '', throws = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw throws;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  impl.calls = calls;
  return impl;
}

test('normalizeGateway strips trailing slashes so paths never double up', () => {
  assert.equal(normalizeGateway(`${GATEWAY}/`), GATEWAY);
  assert.equal(normalizeGateway(`${GATEWAY}///`), GATEWAY);
});

test('isValidEmail accepts real addresses and rejects junk', () => {
  assert.ok(isValidEmail('tester@example.com'));
  assert.ok(!isValidEmail('tester'));
  assert.ok(!isValidEmail('tester@example'));
  assert.ok(!isValidEmail(''));
});

test('health: any status below 500 means the gateway is answering', async () => {
  for (const status of [200, 401, 404]) {
    const health = await checkHealth({ gateway: GATEWAY, fetchImpl: stubFetch({ status }) });
    assert.equal(health.ok, true, `HTTP ${status} should count as reachable`);
  }
});

test('health: 5xx (incl. Cloudflare 530) means the gateway is down', async () => {
  for (const status of [500, 502, 530]) {
    const health = await checkHealth({ gateway: GATEWAY, fetchImpl: stubFetch({ status }) });
    assert.equal(health.ok, false, `HTTP ${status} should count as down`);
    assert.match(health.detail, new RegExp(String(status)));
  }
});

test('health: the real gateway body ("upstream ok") reads as up', async () => {
  const body = JSON.stringify({ status: 'ok', detail: 'upstream ok' });
  const health = await checkHealth({ gateway: GATEWAY, fetchImpl: stubFetch({ status: 200, body }) });

  assert.equal(health.ok, true);
  assert.match(health.detail, /upstream ok/);
});

test('health: a 200 whose body reports a bad upstream is down', async () => {
  const body = JSON.stringify({ status: 'degraded', detail: 'upstream unreachable' });
  const health = await checkHealth({ gateway: GATEWAY, fetchImpl: stubFetch({ status: 200, body }) });

  assert.equal(health.ok, false, 'a healthy gateway in front of a dead model is not usable');
  assert.match(health.detail, /upstream unreachable/);
});

test('health: a transport failure is down, not a crash', async () => {
  const boom = Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' });
  const health = await checkHealth({ gateway: GATEWAY, fetchImpl: stubFetch({ throws: boom }) });
  assert.equal(health.ok, false);
  assert.match(health.detail, /Cannot reach/);
});

test('register posts email + invite and returns the api key', async () => {
  const fetchImpl = stubFetch({ body: JSON.stringify({ api_key: 'sk-wh-abc', email: 'a@b.com', created_user: true }) });
  const result = await register({ gateway: `${GATEWAY}/`, email: 'a@b.com', invite: 'inv-x', fetchImpl });

  assert.equal(result.apiKey, 'sk-wh-abc');
  assert.equal(result.createdUser, true);
  assert.equal(fetchImpl.calls[0].url, `${GATEWAY}/register`);
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { email: 'a@b.com', invite: 'inv-x' });
});

test('register turns 403 and 404 into the guide\'s explanations', async () => {
  await assert.rejects(
    register({ gateway: GATEWAY, email: 'a@b.com', invite: 'bad', fetchImpl: stubFetch({ status: 403, body: 'forbidden' }) }),
    /invite token was rejected/,
  );
  await assert.rejects(
    register({ gateway: GATEWAY, email: 'a@b.com', invite: 'x', fetchImpl: stubFetch({ status: 404, body: 'nope' }) }),
    /not a register endpoint/,
  );
});

test('register rejects a 200 that carries no api_key', async () => {
  await assert.rejects(
    register({ gateway: GATEWAY, email: 'a@b.com', invite: 'x', fetchImpl: stubFetch({ body: '{"detail":"weird"}' }) }),
    /without an api_key/,
  );
});

test('buildConfig writes valid YAML carrying the key and the /v1 apiBase', () => {
  const yaml = buildConfig({ apiKey: 'sk-wh-abc', gateway: `${GATEWAY}/` });
  assert.match(yaml, /^ {4}apiKey: sk-wh-abc$/m);
  assert.match(yaml, /^ {4}apiBase: https:\/\/demo\.deepvariance\.com\/v1$/m);
  assert.match(yaml, /^ {4}model: qwen-coder$/m);
  assert.match(yaml, /^schema: v1$/m);
});

test('configPath points at the file Continue actually reads', () => {
  assert.equal(configPath('/home/t'), join('/home/t', '.continue', 'config.yaml'));
});

test('writeConfig backs up an existing config instead of destroying it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-'));
  const path = join(dir, 'config.yaml');
  await writeFile(path, 'models: [my-own-model]\n');

  const result = await writeConfig({ apiKey: 'sk-wh-new', gateway: GATEWAY, path, stamp: 'STAMP' });

  assert.equal(result.backup, backupPath(path, 'STAMP'));
  assert.equal(await readFile(result.backup, 'utf8'), 'models: [my-own-model]\n');
  assert.match(await readFile(path, 'utf8'), /sk-wh-new/);
});

test('writeConfig creates the .continue directory when it is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-'));
  const path = join(dir, '.continue', 'config.yaml');

  const result = await writeConfig({ apiKey: 'sk-wh-new', gateway: GATEWAY, path });

  assert.equal(result.backup, null);
  assert.match(await readFile(path, 'utf8'), /sk-wh-new/);
});

test('writeConfig is a no-op when the config already matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dv-'));
  const path = join(dir, 'config.yaml');
  await writeFile(path, buildConfig({ apiKey: 'sk-wh-same', gateway: GATEWAY }));

  const result = await writeConfig({ apiKey: 'sk-wh-same', gateway: GATEWAY, path });

  assert.equal(result.unchanged, true);
  assert.equal(result.backup, null);
});
