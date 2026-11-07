/**
 * Real Chromium regression against a Vite frontend and an isolated, seeded Nest API.
 * Required: AUTH_BROWSER_FRONTEND_URL, AUTH_BROWSER_API_URL,
 * AUTH_BROWSER_USERNAME, AUTH_BROWSER_PASSWORD. No default credentials/target.
 * The frontend's VITE_GLOB_API_URL must point to this API and Nitro mock must be off.
 * Run after starting both services: node scripts/qingzhan/browser-auth-regression.mjs
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

function required(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required`);
  return value;
}

async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Browser synchronization timed out')),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const frontend = required('AUTH_BROWSER_FRONTEND_URL').replace(/\/$/, '');
const api = required('AUTH_BROWSER_API_URL').replace(/\/$/, '');
const credentials = {
  username: required('AUTH_BROWSER_USERNAME'),
  password: required('AUTH_BROWSER_PASSWORD'),
};
const storesModule = `/@fs/${fileURLToPath(new URL('../../packages/stores/src/index.ts', import.meta.url)).replaceAll('\\', '/')}`;
assert.notEqual(
  new URL(frontend).origin,
  new URL(api).origin,
  'Use different frontend/API origins to test credentials',
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  const refreshStatuses = [];
  let logoutRequests = 0;
  const cookie = async () => {
    const cookies = await context.cookies(api);
    return cookies.find((item) => item.name === 'jwt');
  };
  for (const page of pages) {
    page.on('request', (request) => {
      if (request.url().startsWith(`${api}/auth/logout`)) logoutRequests++;
    });
    page.on('response', (response) => {
      if (response.url() === `${api}/auth/refresh`)
        refreshStatuses.push(response.status());
    });
    await page.goto(`${frontend}/auth/login`);
    await page.locator('input[name="username"]').waitFor();
    assert.ok(
      await page.evaluate(() => Boolean(navigator.locks)),
      'Chromium Web Locks are required for this regression',
    );
  }

  // Call the actual frontend API module: Axios, interceptors and stores are real.
  const loginToken = await pages[0].evaluate(async (data) => {
    const { loginApi } = await import('/src/api/core/auth.ts');
    const result = await loginApi(data);
    return result.accessToken;
  }, credentials);
  for (const page of pages) {
    await page.evaluate(
      async ({ token, stores }) => {
        const { useAccessStore } = await import(stores);
        useAccessStore().setAccessToken(token);
      },
      { token: loginToken, stores: storesModule },
    );
    let firstProtectedRequest = true;
    await page.route(`${api}/auth/codes`, async (route) => {
      if (!firstProtectedRequest) return route.continue();
      firstProtectedRequest = false;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': new URL(frontend).origin,
          'access-control-allow-credentials': 'true',
        },
        body: '{}',
      });
    });
  }
  const initial = await cookie();
  assert.ok(
    initial?.httpOnly,
    'Cross-origin login must store the HttpOnly refresh cookie',
  );
  const staleCookie = `jwt=${initial.value}`;

  // Hold the first rotation response so the second tab must wait on a real
  // browser lock. Without cross-tab coordination it would send the stale cookie.
  let firstArrived;
  let firstFailed;
  let releaseFirst;
  const firstReady = new Promise((resolve, reject) => {
    firstArrived = resolve;
    firstFailed = reject;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  await pages[0].route(`${api}/auth/refresh`, async (route) => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      firstArrived();
      await firstGate;
      await route.fulfill({ response });
    } catch (error) {
      firstFailed(error);
      await route.abort();
    }
  });
  const protectedRequest = (page) =>
    page.evaluate(async () => {
      const { requestClient } = await import('/src/api/request.ts');
      return requestClient.get('/auth/codes');
    });
  const firstCodes = protectedRequest(pages[0]);
  void firstCodes.catch(firstFailed);
  await within(firstReady);
  let secondRefreshRequests = 0;
  pages[1].on('request', (request) => {
    if (request.url() === `${api}/auth/refresh`) secondRefreshRequests++;
  });
  const secondCodes = protectedRequest(pages[1]);
  void secondCodes.catch(() => {});
  await pages[1].waitForFunction(async () => {
    const locks = await navigator.locks.query();
    return locks.pending.some((lock) => lock.name.startsWith('vben:refresh:'));
  });
  assert.equal(
    secondRefreshRequests,
    0,
    'The second tab must wait before sending a refresh',
  );
  releaseFirst();
  const codes = await Promise.all([firstCodes, secondCodes]);
  await pages[0].unroute(`${api}/auth/refresh`);
  assert.ok(
    codes.every((items) => Array.isArray(items)),
    'Both protected requests must replay successfully',
  );
  assert.deepEqual(
    refreshStatuses,
    [200, 200],
    'The two tabs must rotate sequentially using the newest cookie',
  );
  const rotated = await cookie();
  assert.ok(rotated && rotated.value !== initial.value);

  // Inject the old cookie into one browser request and deliver its rejected response
  // after a successful rotation in the other tab.
  let captured;
  let captureFailed;
  let release;
  const ready = new Promise((resolve, reject) => {
    captured = resolve;
    captureFailed = reject;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await pages[0].route(`${api}/auth/refresh?stale=1`, async (route) => {
    try {
      const response = await route.fetch({
        headers: { ...route.request().headers(), cookie: staleCookie },
      });
      assert.equal(response.status(), 403);
      assert.equal(response.headers()['set-cookie'], undefined);
      captured();
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      captureFailed(error);
      await route.abort();
    }
  });
  const delayed = pages[0].evaluate(async (url) => {
    const response = await fetch(`${url}/auth/refresh?stale=1`, {
      method: 'POST',
      credentials: 'include',
    });
    return response.status;
  }, api);
  void delayed.catch(() => {});
  await within(ready);
  await pages[1].evaluate(async () => {
    const { refreshTokenApi } = await import('/src/api/core/auth.ts');
    await refreshTokenApi();
  });
  const winner = await cookie();
  release();
  assert.equal(await delayed, 403);
  const afterLateRejection = await cookie();
  assert.ok(
    afterLateRejection?.value === winner?.value,
    'Late rejection must not erase the winning cookie',
  );

  // A failed refresh must clear only local auth state, with no server logout call.
  const cors = {
    'access-control-allow-origin': new URL(frontend).origin,
    'access-control-allow-credentials': 'true',
  };
  const previousRefreshes = refreshStatuses.length;
  await pages[0].route(`${api}/auth/codes`, (route) =>
    route.fulfill({
      status: 401,
      headers: cors,
      contentType: 'application/json',
      body: '{}',
    }),
  );
  await pages[0].route(`${api}/auth/refresh`, (route) =>
    route.fulfill({
      status: 403,
      headers: cors,
      contentType: 'application/json',
      body: '{}',
    }),
  );
  await pages[0].evaluate(async () => {
    const { requestClient } = await import('/src/api/request.ts');
    await requestClient.get('/auth/codes').catch(() => undefined);
  });
  assert.equal(
    logoutRequests,
    0,
    'Passive reauthentication must not revoke another tab',
  );
  assert.equal(
    refreshStatuses.length,
    previousRefreshes + 1,
    'The injected 401 must enter the refresh failure branch',
  );
  assert.equal(refreshStatuses.at(-1), 403);
  const afterPassiveReauthentication = await cookie();
  assert.ok(
    afterPassiveReauthentication?.value === winner?.value,
    'Passive reauthentication must preserve the cookie',
  );
  await pages[1].evaluate(async () => {
    const { refreshTokenApi } = await import('/src/api/core/auth.ts');
    await refreshTokenApi();
  });

  await pages[1].evaluate(async () => {
    const { logoutApi } = await import('/src/api/core/auth.ts');
    await logoutApi();
  });
  assert.equal(logoutRequests, 1);
  assert.ok(!(await cookie()), 'Explicit logout must still clear the cookie');
  console.log(
    JSON.stringify({
      frontend: new URL(frontend).origin,
      crossOriginLogin: true,
      concurrentRefreshStatuses: refreshStatuses.slice(0, 2),
      lateRejectionPreservesCookie: true,
      passiveReauthenticationPreservesSession: true,
      explicitLogoutClearsCookie: true,
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
