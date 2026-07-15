import assert from 'node:assert/strict';
import { test } from 'node:test';

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








test('register rejects a 2xx whose body is literally null (no raw TypeError)', async () => {
  await assert.rejects(
    register({ gateway: GATEWAY, email: 'a@b.com', invite: 'x', fetchImpl: stubFetch({ body: 'null' }) }),
    /without an api_key/,
  );
});
