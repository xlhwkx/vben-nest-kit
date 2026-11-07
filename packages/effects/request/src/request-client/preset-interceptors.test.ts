import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticateResponseInterceptor } from './preset-interceptors';
import { RequestClient } from './request-client';

describe('authenticateResponseInterceptor', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.reset();
  });

  function createClient(
    doRefreshToken: () => Promise<string>,
    getToken: () => null | string = () => null,
  ) {
    const client = new RequestClient();
    const reAuthenticate = vi.fn(async () => {});
    // Applications attach the current token in a request interceptor, which is
    // also how the retried request picks up the refreshed token.
    client.addRequestInterceptor({
      fulfilled: (config) => {
        const token = getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
    });
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        doReAuthenticate: reAuthenticate,
        doRefreshToken,
        enableRefreshToken: true,
        formatToken: (token) => (token ? `Bearer ${token}` : null),
      }),
    );
    return { client, reAuthenticate };
  }

  it('does not refresh or replay requests belonging to a stale session', async () => {
    const client = new RequestClient();
    const refresh = vi.fn(async () => 'another-account-token');
    const reAuthenticate = vi.fn(async () => {});
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        doRefreshToken: refresh,
        doReAuthenticate: reAuthenticate,
        enableRefreshToken: true,
        formatToken: (token) => `Bearer ${token}`,
        isSessionCurrent: () => false,
      }),
    );
    const endpoint = vi.fn(() => [401, {}] as [number, object]);
    mock.onPost('/write').reply(endpoint);
    await expect(
      client.post('/write', { operation: 'A' }),
    ).rejects.toBeDefined();
    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(reAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a rejected login', async () => {
    const refresh = vi.fn(async () => 'token');
    const { client, reAuthenticate } = createClient(refresh);
    mock.onPost('/auth/login').reply(401);
    await expect(
      client.post('/auth/login', {}, { skipAuthRefresh: true }),
    ).rejects.toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(reAuthenticate).not.toHaveBeenCalled();
  });

  it('drops a write when the session changes during its refresh', async () => {
    const client = new RequestClient();
    let current = true;
    const reAuthenticate = vi.fn(async () => {});
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        doRefreshToken: async () => {
          current = false;
          return 'new-token';
        },
        doReAuthenticate: reAuthenticate,
        enableRefreshToken: true,
        formatToken: (token) => `Bearer ${token}`,
        isSessionCurrent: () => current,
      }),
    );
    const endpoint = vi.fn(() => [401, {}] as [number, object]);
    mock.onPost('/write').reply(endpoint);
    await expect(client.post('/write', { operation: 'A' })).rejects.toThrow(
      '登录状态已变化',
    );
    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(reAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('fails the queued requests when the token refresh fails', async () => {
    const refreshToken = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('refresh failed'));
          }, 100);
        }),
    );
    const { client, reAuthenticate } = createClient(refreshToken);

    const calls: string[] = [];
    mock.onGet('/initiator').reply(() => {
      calls.push('/initiator');
      return [401];
    });
    // Arrives while the refresh is still in flight, so it waits in the queue.
    mock.onGet('/queued').reply(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            calls.push('/queued');
            resolve([401]);
          }, 20);
        }),
    );

    const results = await Promise.allSettled([
      client.get('/initiator'),
      client.get('/queued'),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    // One failed refresh must not start another one from the queue, and every
    // queued request must fail instead of being replayed without a token.
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(reAuthenticate).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['/initiator', '/queued']);
  });

  it('replays the queued requests with the refreshed token', async () => {
    let currentToken: null | string = null;
    const refreshToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            currentToken = 'new-token';
            resolve('new-token');
          }, 100);
        }),
    );
    const { client, reAuthenticate } = createClient(
      refreshToken,
      () => currentToken,
    );

    const initiatorHeaders: (null | string)[] = [];
    const queuedHeaders: (null | string)[] = [];

    mock.onGet('/initiator').reply((config) => {
      const authorization = (config.headers?.Authorization as string) ?? null;
      initiatorHeaders.push(authorization);
      return authorization === 'Bearer new-token' ? [200, {}] : [401];
    });
    mock.onGet('/queued').reply((config) => {
      const authorization = (config.headers?.Authorization as string) ?? null;
      queuedHeaders.push(authorization);
      if (authorization === 'Bearer new-token') {
        return [200, {}];
      }
      return new Promise((resolve) => {
        setTimeout(() => resolve([401]), 20);
      });
    });

    await Promise.all([client.get('/initiator'), client.get('/queued')]);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(reAuthenticate).not.toHaveBeenCalled();
    expect(initiatorHeaders).toEqual([null, 'Bearer new-token']);
    expect(queuedHeaders).toEqual([null, 'Bearer new-token']);
  });

  it('does not refresh again when a queued replay is still unauthorized', async () => {
    let token: null | string = null;
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      token = 'new-token';
      return token;
    });
    const { client, reAuthenticate } = createClient(refresh, () => token);
    mock
      .onGet('/initiator')
      .reply((config) => (config.headers?.Authorization ? [200, {}] : [401]));
    mock.onGet('/queued').reply(401);
    const results = await Promise.allSettled([
      client.get('/initiator'),
      client.get('/queued'),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reAuthenticate).toHaveBeenCalledTimes(1);
  });
});
