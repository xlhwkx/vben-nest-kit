/** Read emitted configuration as data. Never evaluate JavaScript from dist. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { assertBackendConfig } from '../../internal/vite-config/src/utils/backend-config.ts';

for (const app of ['apps/admin']) {
  const root = new URL(`../../${app}/dist/`, import.meta.url);
  const entries = await readdir(root);
  const files = entries.filter((name) => /^_app-config-.*\.js$/u.test(name));
  assert.equal(
    files.length,
    1,
    `${app}: expected exactly one runtime configuration`,
  );
  const source = await readFile(new URL(files[0], root), 'utf8');
  const match = /^window\._VBEN_ADMIN_PRO_APP_CONF_=(\{[^\r\n]*\});/u.exec(
    source,
  );
  assert.ok(match, `${app}: unexpected runtime configuration format`);
  const config = JSON.parse(match[1]);
  assert.ok(config && !Array.isArray(config) && typeof config === 'object');
  for (const [key, value] of Object.entries(config)) {
    assert.ok(
      key.startsWith('VITE_GLOB_'),
      `${app}: non-public environment key`,
    );
    assert.ok(
      !/SECRET|PASSWORD|PRIVATE|TOKEN/iu.test(key),
      `${app}: credential-like public key`,
    );
    assert.equal(typeof value, 'string', `${app}: non-string public setting`);
  }
  assertBackendConfig(config);
  assert.equal(
    config.VITE_GLOB_API_URL,
    process.env.VITE_GLOB_API_URL ?? '/api',
    `${app}: emitted API differs from delivery target`,
  );
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.ok(
    html.includes(files[0]),
    `${app}: index does not load the checked configuration`,
  );
  console.log(`Checked runtime configuration: ${fileURLToPath(root)}`);
}
