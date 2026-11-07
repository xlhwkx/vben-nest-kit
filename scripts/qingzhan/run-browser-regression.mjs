/** Starts and stops only its own processes. Use an isolated, seeded test DB. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const app = process.env.AUTH_BROWSER_APP ?? 'playground';
assert.ok(['playground', 'web-antd'].includes(app), 'Unsupported browser app');
assert.equal(
  process.env.AUTH_BROWSER_ALLOW_MUTATION,
  'true',
  'Explicit disposable database opt-in required',
);
assert.equal(
  process.env.NODE_ENV,
  'test',
  'Browser runner requires NODE_ENV=test',
);
const port = app === 'playground' ? 5555 : 5666;
const frontend = `http://127.0.0.1:${port}`;
const api = 'http://127.0.0.1:5320/api';
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = {
  ...process.env,
  AUTH_BROWSER_APP: app,
  APP_PORT: '5320',
  AUTH_BROWSER_FRONTEND_URL: frontend,
  AUTH_BROWSER_API_URL: api,
  VITE_GLOB_API_URL: api,
  VITE_NITRO_MOCK: 'false',
  VITE_CAPTCHA_E2E_BYPASS: 'false',
};
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertFree(portNumber) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(portNumber, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function start(command, args, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.spawnError = undefined;
  child.on('error', (error) => {
    child.spawnError = error;
  });
  children.push(child);
  return child;
}

async function ready(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.spawnError) throw child.spawnError;
    assert.ok(
      child.exitCode === null && child.signalCode === null,
      'Owned service exited before readiness',
    );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* Only retry while the owned process is alive. */
    }
    await delay(1000);
  }
  throw new Error('Owned service readiness timed out');
}

async function run(script) {
  const child = start(process.execPath, [script]);
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${script} exceeded four minutes`)),
        240_000,
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`${script} failed (${code})`)),
      );
    });
  } finally {
    clearTimeout(timer);
  }
}

async function stop(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
    return;
  }
  // The detached process group belongs to this runner; grandchildren include Vite.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await delay(2000);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* Already exited. */
  }
}

let cleaning;
function cleanup() {
  cleaning ??= Promise.all(children.toReversed().map((child) => stop(child)));
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
}

try {
  await assertFree(5320);
  await assertFree(port);
  const backend = start(process.execPath, ['apps/server/dist/main.js']);
  // Invoke the installed Vite CLI directly; no shell or pnpm shim assumptions.
  const vite = start(
    process.execPath,
    [
      fileURLToPath(
        new URL('../../node_modules/vite/bin/vite.js', import.meta.url),
      ),
      '--mode',
      'development',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    fileURLToPath(
      new URL(
        app === 'playground' ? '../../playground/' : '../../apps/web-antd/',
        import.meta.url,
      ),
    ),
  );
  await Promise.all([
    ready(`${api}/v1/health/ready`, backend),
    ready(`${frontend}/auth/login`, vite),
  ]);
  await run('scripts/qingzhan/browser-auth-regression.mjs');
  await run('scripts/qingzhan/browser-delivery-regression.mjs');
} finally {
  await cleanup();
}
