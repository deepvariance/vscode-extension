import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

// A stub gateway so the health gate passes and we reach the email logic.
let server;
let gateway;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  gateway = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

/** Run the CLI with a dead stdin and a hard kill, so a hang shows up as a failure, not a stuck test. */
function runCli(args) {
  return new Promise(async (resolve) => {
    const home = await mkdtemp(join(tmpdir(), 'dv-cli-'));
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, DEEPVARIANCE_EMAIL: '', DEEPVARIANCE_GATEWAY: '' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));

    // Generous: detectEditors probes real editor CLIs and one can sit at its ~12s timeout.
    // We only care that the process EXITS (a hang is the bug), not how fast.
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 'TIMEOUT', out });
    }, 30000);

    child.on('exit', (code) => {
      clearTimeout(killer);
      resolve({ code, out });
    });
  });
}

// The regression: with an editor present and --yes but no email, the CLI used to hang on a prompt
// that a non-TTY can never answer. It must EXIT instead. (On a host with no editor installed it
// exits earlier at the editor check — still a clean non-zero exit, still not a hang.)
test('--yes with no email exits instead of hanging', async () => {
  const { code } = await runCli(['--yes', '--gateway', gateway]);
  assert.notEqual(code, 'TIMEOUT', 'the CLI hung on a prompt that can never be answered');
  assert.notEqual(code, 0, 'should fail, not hang, when --yes is given with no email');
});

test('an unknown flag prints a message and the help, not a raw stack trace', async () => {
  const { code, out } = await runCli(['--nope']);
  assert.notEqual(code, 'TIMEOUT');
  assert.notEqual(code, 0);
  assert.doesNotMatch(out, /at parseArgs|node:internal/, 'a raw Node stack trace leaked to the user');
  assert.match(out, /Usage/);
});
