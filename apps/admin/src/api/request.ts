/**
 * 该文件可自行根据业务逻辑进行调整
 */
import type {
  AxiosResponseHeaders,
  RequestClientConfig,
  RequestClientOptions,
} from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  AuthSessionChangedError,
  createAuthSessionBoundary,
  createRefreshCoordinator,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';
import { cloneDeep } from '@vben/utils';

import { message } from 'antdv-next';
import JSONBigInt from 'json-bigint';

import { useAuthStore } from '#/store';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
export const authSession = createAuthSessionBoundary(apiURL);
export const coordinateAuth = createRefreshCoordinator(apiURL);

function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
    transformResponse: (data: any, header: AxiosResponseHeaders) => {
      // storeAsString指示将BigInt存储为字符串，设为false则会存储为内置的BigInt类型
      if (
        header.getContentType()?.toString().includes('application/json') &&
        typeof data === 'string'
      ) {
        return cloneDeep(
          JSONBigInt({ storeAsString: true, strict: true }).parse(data),
        );
      }
      return data;
    },
  });
  const coordinateRefresh = createRefreshCoordinator(baseURL);

  /**
   * 重新认证逻辑
   */
  async function doReAuthenticate(
    error?: unknown,
    config?: RequestClientConfig,
  ) {
    const snapshot = config?.authSession;
    if (snapshot && !authSession.isLocalCurrent(snapshot)) return;
    console.warn('Access token or refresh token is invalid or expired. ');
    const accessStore = useAccessStore();
    const authStore = useAuthStore();
    const sessionCurrent =
      !snapshot || authSession.isCurrent(snapshot, accessStore.accessToken);
    accessStore.setAccessToken(null);
    if (
      !(error instanceof AuthSessionChangedError) &&
      sessionCurrent &&
      preferences.app.loginExpiredMode === 'modal' &&
      accessStore.isAccessChecked
    ) {
      accessStore.setLoginExpired(true);
    } else {
      await authStore.logout(true, { revokeSession: false });
    }
  }

  /**
   * 刷新token逻辑
   */
  async function doRefreshToken(config: RequestClientConfig) {
    const accessStore = useAccessStore();
    const snapshot = config.authSession;
    if (!snapshot?.principal) throw new AuthSessionChangedError();
    const expectedUserId = snapshot.principal;
    const newToken = await coordinateRefresh(async () => {
      authSession.assertCurrent(snapshot, accessStore.accessToken);
      const resp = await refreshTokenApi(expectedUserId);
      authSession.assertCurrent(snapshot, accessStore.accessToken);
      authSession.assertCurrent(snapshot, resp.data);
      return resp.data;
    });
    authSession.assertCurrent(snapshot, accessStore.accessToken);
    authSession.assertCurrent(snapshot, newToken);
    accessStore.setAccessToken(newToken);
    return newToken;
  }

  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  // 请求头处理
  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const accessStore = useAccessStore();
      config.authSession ??= authSession.capture(accessStore.accessToken);
      try {
        authSession.assertCurrent(config.authSession, accessStore.accessToken);
      } catch (error) {
        await doReAuthenticate(error, config);
        throw error;
      }
      config.headers.Authorization = formatToken(accessStore.accessToken);
      config.headers['Accept-Language'] = preferences.app.locale;
      return config;
    },
  });

  client.addResponseInterceptor({
    fulfilled: (response) => {
      if (response.config.authSession) {
        authSession.assertCurrent(
          response.config.authSession,
          useAccessStore().accessToken,
        );
      }
      return response;
    },
  });

  // 处理返回的响应数据格式
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    }),
  );

  // token过期的处理
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken: preferences.app.enableRefreshToken,
      formatToken,
      isSessionCurrent: (config) =>
        !!config.authSession &&
        authSession.isCurrent(config.authSession, useAccessStore().accessToken),
    }),
  );

  // 通用的错误处理,如果没有进入上面的错误处理逻辑，就会进入这里
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg: string, error) => {
      // 这里可以根据业务进行定制,你可以拿到 error 内的信息进行定制化处理，根据不同的 code 做不同的提示，而不是直接使用 message.error 提示 msg
      // 当前mock接口返回的错误字段是 error 或者 message
      const responseData = error?.response?.data ?? {};
      const errorMessage = responseData?.error ?? responseData?.message ?? '';
      // 如果没有错误信息，则会根据状态码进行提示
      message.error(errorMessage || msg);
    }),
  );

  return client;
}

export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

export const baseRequestClient = new RequestClient({ baseURL: apiURL });

export interface PageFetchParams {
  [key: string]: any;
  pageNo?: number;
  pageSize?: number;
}
