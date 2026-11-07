import type { Recordable, UserInfo } from '@vben/types';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { accessTokenSubject } from '@vben/request';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'ant-design-vue';
import { defineStore } from 'pinia';

import {
  getAccessCodesApi,
  getCaptchaApi,
  getUserInfoApi,
  loginApi,
  logoutApi,
} from '#/api';
import { authSession, coordinateAuth } from '#/api/request';
import { $t } from '#/locales';
import { resetRoutes } from '#/router';

export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);
  const isLoggingOut = ref(false);

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param params 登录表单数据
   */
  async function authLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
  ) {
    // 异步处理用户登录操作并获取 accessToken
    let userInfo: null | UserInfo = null;
    try {
      loginLoading.value = true;
      authSession.change();
      const loginSnapshot = authSession.capture(accessStore.accessToken);
      // Default off: contract login is username+password only.
      // When VITE_CAPTCHA_REQUIRED=true, pull one-time ticket then submit.
      const captchaRequired =
        import.meta.env.VITE_CAPTCHA_REQUIRED === 'true' ||
        import.meta.env.VITE_CAPTCHA_REQUIRED === '1';
      const loginPayload: {
        username?: string;
        password?: string;
        captchaId?: string;
        captchaToken?: string;
      } = {
        username: params.username,
        password: params.password,
      };
      if (captchaRequired) {
        const challenge = await getCaptchaApi();
        loginPayload.captchaId = challenge.captchaId;
        loginPayload.captchaToken = challenge.captchaToken;
      }
      const { accessToken } = await coordinateAuth(() => {
        authSession.assertCurrent(loginSnapshot, accessStore.accessToken);
        return loginApi(loginPayload);
      });
      authSession.assertCurrent(loginSnapshot, accessStore.accessToken);

      // 如果成功获取到 accessToken
      if (accessToken) {
        if (
          accessTokenSubject(accessToken) !==
          accessTokenSubject(accessStore.accessToken)
        ) {
          resetAllStores();
          resetRoutes();
        }
        accessStore.setAccessToken(accessToken);
        const signedInSnapshot = authSession.capture(accessToken);

        // 获取用户信息并存储到 accessStore 中
        const [fetchUserInfoResult, accessCodes] = await Promise.all([
          getUserInfoApi(),
          getAccessCodesApi(),
        ]);
        authSession.assertCurrent(signedInSnapshot, accessStore.accessToken);

        userInfo = fetchUserInfoResult;

        userStore.setUserInfo(userInfo);
        accessStore.setAccessCodes(accessCodes);

        if (accessStore.loginExpired) {
          accessStore.setLoginExpired(false);
        } else {
          onSuccess
            ? await onSuccess?.()
            : await router.push(
                userInfo.homePath || preferences.app.defaultHomePath,
              );
        }

        if (userInfo?.realName) {
          notification.success({
            description: `${$t('authentication.loginSuccessDesc')}:${userInfo?.realName}`,
            duration: 3,
            message: $t('authentication.loginSuccess'),
          });
        }
      }
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  async function logout(
    redirect: boolean = true,
    options: { revokeSession?: boolean } = {},
  ) {
    if (isLoggingOut.value) return false;
    isLoggingOut.value = true;
    if (options.revokeSession === false) authSession.reset();
    else authSession.change();
    const snapshot = authSession.capture(accessStore.accessToken);
    try {
      if (options.revokeSession !== false)
        await coordinateAuth(() => {
          authSession.assertCurrent(snapshot, accessStore.accessToken);
          return logoutApi(snapshot.principal ?? undefined);
        });
    } catch {
      if (authSession.isLocalCurrent(snapshot))
        notification.error({
          message: '退出未完成',
          description: '服务端会话撤销未确认，请重试退出。当前登录状态已保留。',
          duration: 0,
        });
      return false;
    } finally {
      isLoggingOut.value = false;
    }
    if (!authSession.isLocalCurrent(snapshot)) return false;
    authSession.reset();
    resetAllStores();
    resetRoutes();
    accessStore.setLoginExpired(false);

    // 已经在登录页时不能再带 redirect：此时 currentRoute.fullPath 就是登录页本身，
    // 再编码一层会得到「登录页?redirect=编码后的登录页」，下一次又在这个基础上再包一层，
    // 反复登出会让 URL 逐跳变长，且没有上限。
    // On the login page the current route is the login page itself, so carrying it as
    // `redirect` would nest one more encoded layer on every repeat.
    const currentRoute = router.currentRoute.value;
    const alreadyOnLogin = currentRoute.path === LOGIN_PATH;

    // 回登录页带上当前路由地址
    await router.replace({
      path: LOGIN_PATH,
      query:
        redirect && !alreadyOnLogin
          ? { redirect: encodeURIComponent(currentRoute.fullPath) }
          : {},
    });
  }

  async function fetchUserInfo() {
    const userInfo = await getUserInfoApi();
    userStore.setUserInfo(userInfo);
    return userInfo;
  }

  function $reset() {
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    fetchUserInfo,
    loginLoading,
    logout,
  };
});
