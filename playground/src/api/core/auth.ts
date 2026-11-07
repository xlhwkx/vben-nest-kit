import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  return requestClient.post<AuthApi.LoginResult>('/auth/login', data, {
    withCredentials: true,
    skipAuthRefresh: true,
  });
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi(expectedUserId?: string) {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>(
    '/auth/refresh',
    expectedUserId ? { expectedUserId } : undefined,
    {
      withCredentials: true,
    },
  );
}

/**
 * 退出登录
 */
export async function logoutApi(expectedUserId?: string) {
  return baseRequestClient.post(
    '/auth/logout',
    expectedUserId ? { expectedUserId } : undefined,
    {
      withCredentials: true,
    },
  );
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  return requestClient.get<string[]>('/auth/codes');
}
