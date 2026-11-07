/** Real Vite modules + browser cookies/locks + isolated Nest/PG/Redis. Not a dist preview test. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

function required(name) {
  assert.ok(process.env[name], `${name} is required`);
  return process.env[name];
}
assert.equal(
  required('AUTH_BROWSER_ALLOW_MUTATION'),
  'true',
  'Use a disposable database only',
);
const app = required('AUTH_BROWSER_APP');
assert.ok(['playground', 'web-antd'].includes(app));
const frontend = required('AUTH_BROWSER_FRONTEND_URL').replace(/\/$/u, '');
const api = required('AUTH_BROWSER_API_URL').replace(/\/$/u, '');
assert.notEqual(new URL(frontend).origin, new URL(api).origin);
const primary = {
  username: required('AUTH_BROWSER_USERNAME'),
  password: required('AUTH_BROWSER_PASSWORD'),
};
const secondary = {
  username: required('AUTH_BROWSER_SECONDARY_USERNAME'),
  password: required('AUTH_BROWSER_SECONDARY_PASSWORD'),
};
assert.notEqual(primary.username, secondary.username);
const stores = `/@fs/${fileURLToPath(new URL('../../packages/stores/src/index.ts', import.meta.url)).replaceAll('\\', '/')}`;
const cors = {
  'access-control-allow-origin': new URL(frontend).origin,
  'access-control-allow-credentials': 'true',
};
const prefix = `Delivery${randomUUID().replaceAll('-', '')}`;
const menuBody = (suffix) => ({
  name: `${prefix}${suffix}`,
  path: `/${prefix}${suffix}`,
  type: 'menu',
  component: '/dashboard/analytics/index',
  meta: { title: 'Delivery sentinel' },
});

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Gates can fail before the main sequence starts awaiting them.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_yes, no) => {
        timer = setTimeout(
          () => no(new Error('Browser synchronization timed out')),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
context.setDefaultTimeout(30_000);
let cleanupToken;
try {
  const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of [a, b]) {
    page.on('pageerror', (error) => {
      console.error(`[${app}] Browser error: ${error.name}: ${error.message}`);
    });
    await page.goto(`${frontend}/auth/login`);
    await page.locator('input[name="username"]').waitFor();
  }
  const signIn = (page, credentials) =>
    page.evaluate(
      async ({ credentials, stores }) => {
        const { useAuthStore } = await import('/src/store/auth.ts');
        await useAuthStore().authLogin(credentials);
        const { useAccessStore } = await import(stores);
        if (!useAccessStore().accessToken)
          throw new Error('Login did not establish a session');
        return useAccessStore().accessToken;
      },
      { credentials, stores },
    );
  const write = (page, body) =>
    page.evaluate(async (body) => {
      const { requestClient } = await import('/src/api/request.ts');
      try {
        await requestClient.post('/system/menu', body);
        return { rejected: false };
      } catch (error) {
        return { rejected: true, name: error.name };
      }
    }, body);
  const unauthorized = (route) =>
    route.fulfill({
      status: 401,
      headers: cors,
      contentType: 'application/json',
      body: '{}',
    });
  cleanupToken = await signIn(a, primary);

  // Verify the supported management pages actually invoke the real API.
  if (app === 'playground') {
    const failedRoleReads = [];
    a.on('response', (response) => {
      if (
        new URL(response.url()).pathname === '/api/system/role/list' &&
        response.request().method() === 'GET' &&
        response.status() !== 200
      ) {
        failedRoleReads.push(response.status());
      }
    });
    for (const [path, endpoint] of [
      ['/system/role', '/system/role/list'],
      ['/system/menu', '/system/menu/list'],
      ['/system/dept', '/system/dept/list'],
      ['/system/dict', '/system/dict/type/list'],
      ['/system/dict/data/user_gender', '/system/dict/data/list'],
      ['/system/user', '/system/user/list'],
    ]) {
      console.log(
        JSON.stringify({
          app,
          managementPage: path,
          expectedEndpoint: endpoint,
        }),
      );
      const response = a.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === `/api${endpoint}` &&
          item.request().method() === 'GET',
      );
      let result;
      try {
        [, result] = await Promise.all([
          a.evaluate(async (path) => {
            const { router } = await import('/src/router/index.ts');
            await router.push(path);
          }, path),
          response,
        ]);
      } catch (error) {
        const route = await a.evaluate(async () => {
          const { router } = await import('/src/router/index.ts');
          const current = router.currentRoute.value;
          return {
            path: current.path,
            name: current.name,
            matched: current.matched.map((item) => ({
              name: item.name,
              hasComponent: Boolean(item.components?.default),
            })),
          };
        });
        console.error(
          JSON.stringify({ app, failedManagementPage: path, route }),
        );
        throw error;
      }
      assert.equal(result.status(), 200, `Management page ${path}`);
      const payload = await result.json();
      assert.equal(payload.code, 0);
      assert.equal(
        await a.evaluate(async () => {
          const { router } = await import('/src/router/index.ts');
          return router.currentRoute.value.path;
        }),
        path,
      );
      // Data must reach rendered content; missing components can still have a valid route.
      await a.locator('main').waitFor();
    }
    assert.deepEqual(failedRoleReads, [], 'Role label reads must succeed');

    // More than one API page must remain selectable without an oversized request.
    const rolePages = [];
    const roleOptions = Array.from({ length: 101 }, (_, index) => ({
      id: `role-option-${index}`,
      name: `Role ${index}`,
    }));
    const roleListUrl = `${api}/system/role/list?*`;
    await a.route(roleListUrl, async (route) => {
      const query = new URL(route.request().url()).searchParams;
      assert.equal(query.get('pageSize'), '100');
      const page = Number(query.get('page'));
      rolePages.push(page);
      await route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            items: roleOptions.slice((page - 1) * 100, page * 100),
            total: roleOptions.length,
          },
        }),
      });
    });
    try {
      const options = await a.evaluate(async () => {
        const { getRoleOptions } = await import('/src/api/system/role.ts');
        return getRoleOptions();
      });
      assert.deepEqual(options, roleOptions);
      assert.deepEqual(rolePages, [1, 2]);
    } finally {
      await a.unroute(roleListUrl);
    }
  }

  // The stale tab must reject before a write is sent using the other account's cookie.
  let attempts = 0;
  const countWrite = (request) => {
    if (request.url() === `${api}/system/menu` && request.method() === 'POST')
      attempts++;
  };
  a.on('request', countWrite);
  await signIn(b, secondary);
  const staleResult = await write(a, menuBody('Stale'));
  assert.equal(staleResult.rejected, true);
  assert.equal(attempts, 0, 'Stale account must not send a write');

  // Two pending writes must both fail when account switching starts during refresh.
  cleanupToken = await signIn(a, primary);
  attempts = 0;
  await a.route(`${api}/system/menu`, unauthorized);
  const arrived = gate();
  const release = gate();
  await a.route(`${api}/auth/refresh`, async (route) => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      arrived.resolve();
      await bounded(release.promise);
      await route.fulfill({ response });
    } catch (error) {
      arrived.reject(error);
      await route.abort();
    }
  });
  const first = write(a, menuBody('First'));
  await bounded(arrived.promise);
  const second = write(a, menuBody('Queued'));
  await a.waitForFunction(async () => {
    const { requestClient } = await import('/src/api/request.ts');
    return requestClient.refreshTokenQueue.length === 1;
  });
  const switching = signIn(b, secondary);
  void switching.catch(() => {});
  await a.waitForFunction(async (stores) => {
    const { authSession } = await import('/src/api/request.ts');
    const { useAccessStore } = await import(stores);
    const token = useAccessStore().accessToken;
    return !authSession.isCurrent(authSession.capture(token), token);
  }, stores);
  release.resolve();
  const queuedResults = await bounded(Promise.all([first, second]));
  assert.ok(queuedResults.every((result) => result.rejected));
  await bounded(switching);
  assert.equal(
    attempts,
    2,
    'Queued writes must not replay under the new account',
  );
  await a.unroute(`${api}/auth/refresh`);
  await a.unroute(`${api}/system/menu`);

  // Even without a shared marker, expectedUserId must reject another account's cookie.
  cleanupToken = await signIn(a, primary);
  const directLogin = await b.evaluate(
    async ({ api, secondary }) => {
      const response = await fetch(`${api}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(secondary),
      });
      return response.status;
    },
    { api, secondary },
  );
  assert.equal(directLogin, 200);
  attempts = 0;
  await a.route(`${api}/system/menu`, unauthorized);
  const rejectedRefresh = a.waitForResponse(`${api}/auth/refresh`);
  const mismatch = write(a, menuBody('Mismatch'));
  const mismatchRefresh = await rejectedRefresh;
  const mismatchResult = await mismatch;
  assert.equal(mismatchRefresh.status(), 403);
  assert.equal(mismatchResult.rejected, true);
  assert.equal(attempts, 1);
  await a.unroute(`${api}/system/menu`);

  // A failed explicit logout keeps local state and offers a visible retry.
  cleanupToken = await signIn(a, primary);
  await a.route(`${api}/auth/logout`, (route) =>
    route.fulfill({ status: 503, headers: cors, body: '{}' }),
  );
  const logoutResult = await a.evaluate(
    async ({ stores }) => {
      const { useAuthStore } = await import('/src/store/auth.ts');
      const result = await useAuthStore().logout(false);
      const { useAccessStore } = await import(stores);
      return { result, signedIn: Boolean(useAccessStore().accessToken) };
    },
    { stores },
  );
  assert.deepEqual(logoutResult, { result: false, signedIn: true });
  await a.getByText('退出未完成', { exact: true }).waitFor();
  await a.unroute(`${api}/auth/logout`);
  await a.evaluate(async () => {
    const { useAuthStore } = await import('/src/store/auth.ts');
    await useAuthStore().logout(false);
  });
  const remainingCookies = await context.cookies(api);
  assert.ok(!remainingCookies.some((cookie) => cookie.name === 'jwt'));
  assert.equal(
    await a.evaluate(async (stores) => {
      const { useAccessStore } = await import(stores);
      return Boolean(useAccessStore().accessToken);
    }, stores),
    false,
  );

  cleanupToken = await signIn(a, primary);
  // Both the server validator and cached frontend metadata must reject dangerous URLs.
  const malicious = {
    ...menuBody('Iframe'),
    type: 'embedded',
    component: 'IFrameView',
    meta: {
      title: 'Unsafe iframe',
      iframeSrc: 'javascript:parent.document.body.dataset.deliveryPwned="yes"',
    },
  };
  const validation = await a.evaluate(
    async ({ api, token, body }) => {
      const response = await fetch(`${api}/system/menu`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { api, token: cleanupToken, body: malicious },
  );
  assert.equal(validation, 400);
  const addFrame = (iframeSrc, name) =>
    a.evaluate(
      async ({ iframeSrc, name }) => {
        const { router } = await import('/src/router/index.ts');
        const { BasicLayout, IFrameView } =
          await import('/src/layouts/index.ts');
        router.addRoute({
          name: `${name}Root`,
          path: `/${name}`,
          component: BasicLayout,
          children: [
            {
              name,
              path: 'frame',
              component: IFrameView,
              meta: { title: name, iframeSrc },
            },
          ],
        });
        await router.push(`/${name}/frame`);
      },
      { iframeSrc, name },
    );
  await addFrame(malicious.meta.iframeSrc, `${prefix}Unsafe`);
  assert.equal(await a.locator('iframe').count(), 0);
  assert.equal(
    await a.evaluate(() => document.body.dataset.deliveryPwned),
    undefined,
  );
  await a.route(`${frontend}/__delivery_frame`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body>Sandbox probe</body>',
    }),
  );
  await addFrame(`${frontend}/__delivery_frame`, `${prefix}Safe`);
  const frame = a.locator(`iframe[src="${frontend}/__delivery_frame"]`);
  await frame.waitFor();
  assert.equal(
    await frame.getAttribute('sandbox'),
    'allow-forms allow-scripts',
  );
  assert.equal(await frame.getAttribute('referrerpolicy'), 'no-referrer');
  await a
    .frameLocator(`iframe[src="${frontend}/__delivery_frame"]`)
    .getByText('Sandbox probe')
    .waitFor();
  assert.equal(
    await frame.evaluate((element) => {
      try {
        void element.contentWindow.document;
        return false;
      } catch (error) {
        return error.name === 'SecurityError';
      }
    }),
    true,
    'Even a same-origin iframe must have an opaque sandbox origin',
  );
  console.log(
    JSON.stringify({
      app,
      managementPages:
        app === 'playground' ? 6 : 'outside this UI example scope',
      staleWriteBlocked: true,
      queuedReplayBlocked: true,
      expectedUserIdEnforced: true,
      logoutRetry: true,
      iframeValidationAndSandbox: true,
    }),
  );
} finally {
  // A failed guard could have created a sentinel. Remove only this run's records.
  try {
    if (cleanupToken) {
      const headers = { authorization: `Bearer ${cleanupToken}` };
      const response = await fetch(`${api}/system/menu/list`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(
        response.status,
        200,
        'Sentinel cleanup cannot read menu list',
      );
      const flatten = (items) =>
        items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
      const payload = await response.json();
      for (const row of flatten(payload.data).filter((row) =>
        row.name.startsWith(prefix),
      )) {
        const deleted = await fetch(`${api}/system/menu/${row.id}`, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(deleted.status, 200, 'Sentinel cleanup failed');
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
