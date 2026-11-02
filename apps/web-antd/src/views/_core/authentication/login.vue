<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { BasicOption } from '@vben/types';

import { computed, markRaw } from 'vue';

import { AuthenticationLogin, SliderCaptcha, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();

/**
 * Captcha UI + ticket wiring (default off for contract-compatible login).
 * - VITE_CAPTCHA_REQUIRED=true → authStore fetches GET /auth/captcha and
 *   submits captchaId+captchaToken (pair with server CAPTCHA_REQUIRED=true).
 * - VITE_CAPTCHA_E2E_BYPASS=true → hide SliderCaptcha / auto-pass UI field
 *   (headless only; pair with server CAPTCHA_E2E_BYPASS=1; never production).
 */
const captchaE2eBypass =
  import.meta.env.VITE_CAPTCHA_E2E_BYPASS === 'true' ||
  import.meta.env.VITE_CAPTCHA_E2E_BYPASS === '1';

const MOCK_USER_OPTIONS: BasicOption[] = [
  {
    label: 'Super',
    value: 'vben',
  },
  {
    label: 'Admin',
    value: 'admin',
  },
  {
    label: 'User',
    value: 'jack',
  },
];

const formSchema = computed((): VbenFormSchema[] => {
  const schema: VbenFormSchema[] = [
    {
      component: 'VbenSelect',
      componentProps: {
        options: MOCK_USER_OPTIONS,
        placeholder: $t('authentication.selectAccount'),
      },
      fieldName: 'selectAccount',
      label: $t('authentication.selectAccount'),
      rules: z
        .string()
        .min(1, { message: $t('authentication.selectAccount') })
        .optional()
        .default('vben'),
    },
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      dependencies: {
        trigger(values, form) {
          if (values.selectAccount) {
            const findUser = MOCK_USER_OPTIONS.find(
              (item) => item.value === values.selectAccount,
            );
            if (findUser) {
              form.setValues({
                password: '123456',
                username: findUser.value,
              });
            }
          }
        },
        triggerFields: ['selectAccount'],
      },
      fieldName: 'username',
      label: $t('authentication.username'),
      rules: z.string().min(1, { message: $t('authentication.usernameTip') }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.password'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      rules: z.string().min(1, { message: $t('authentication.passwordTip') }),
    },
  ];

  if (captchaE2eBypass) {
    // Auto-pass captcha for headless E2E; do not render SliderCaptcha.
    schema.push({
      component: 'VbenInput',
      componentProps: { type: 'hidden' },
      defaultValue: true,
      fieldName: 'captcha',
      dependencies: {
        if: () => false,
        triggerFields: [],
      },
      rules: z.boolean().optional().default(true),
    });
  } else {
    schema.push({
      component: markRaw(SliderCaptcha),
      fieldName: 'captcha',
      rules: z.boolean().refine((value) => value, {
        message: $t('authentication.verifyRequiredTip'),
      }),
    });
  }

  return schema;
});
</script>

<template>
  <AuthenticationLogin
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    @submit="authStore.authLogin"
  />
</template>
