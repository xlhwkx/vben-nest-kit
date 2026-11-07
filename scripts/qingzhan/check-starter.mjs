/** Static starter contract: no services, builds or browser execution. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (path) =>
  readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n');
const manifest = (path) => JSON.parse(read(path));
const apps = readdirSync(new URL('apps/', root)).filter((name) =>
  existsSync(new URL(`apps/${name}/package.json`, root)),
);
assert.deepEqual(apps.toSorted(), ['admin', 'server']);
assert.equal(manifest('apps/admin/package.json').name, '@qingzhan/admin');
assert.equal(manifest('apps/server/package.json').name, '@qingzhan/server');
const production = read('apps/admin/.env.production');
assert.ok(/^VITE_GLOB_API_URL=\/api$/mu.test(production));
assert.ok(/^VITE_APP_NAMESPACE=qingzhan-admin-v1$/mu.test(production));
const workspace = read('pnpm-workspace.yaml');
assert.ok(workspace.includes('  - apps/admin\n'));
assert.ok(workspace.includes('  - apps/server\n'));
assert.ok(!/^ {2}- (?:apps\/\*|docs|playground)$/mu.test(workspace));
assert.ok(!existsSync(new URL('docs/package.json', root)));

const removed =
  /(?:@vben\/(?:playground|web-[\w-]+|backend-mock)|\bplayground\/|\bapps\/(?:web-[\w-]+|backend-mock)\/)/u;
for (const path of [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'qingzhan.code-workspace',
  'scripts/deploy/Dockerfile',
  'scripts/qingzhan/run-browser-regression.mjs',
  'scripts/qingzhan/browser-delivery-regression.mjs',
  'scripts/qingzhan/check-delivery-artifacts.mjs',
  '.github/workflows/qingzhan-delivery.yml',
]) {
  assert.ok(
    !removed.test(read(path)),
    `${path}: removed application reference`,
  );
}

// Backend menu components must resolve in the only supported admin application.
for (const path of [
  'apps/server/prisma/seed.ts',
  'apps/server/src/common/authorization/admin-routes.ts',
]) {
  for (const [, component] of read(path).matchAll(/component:\s*'([^']+)'/gu)) {
    if (!component.startsWith('/')) continue;
    const view = `apps/admin/src/views${component}.vue`;
    assert.ok(existsSync(new URL(view, root)), `${path}: missing ${view}`);
  }
}
assert.ok(!read('apps/server/prisma/seed.ts').includes("path: '/demos'"));
for (const folder of ['demos', 'examples']) {
  assert.ok(
    !existsSync(new URL(`apps/admin/src/views/${folder}/index.vue`, root)),
  );
}
console.log(`Single-admin starter structure verified: ${fileURLToPath(root)}`);
