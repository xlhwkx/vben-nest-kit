import {
  appCopyrightPreferences,
  defineOverridesPreferences,
} from '@vben/preferences';

export const overridesPreferences = defineOverridesPreferences({
  app: {
    accessMode: 'backend',
    defaultHomePath: '/dashboard/workspace',
    enableRefreshToken: true,
    name: import.meta.env.VITE_APP_TITLE,
  },
  copyright: appCopyrightPreferences,
  widget: { notification: false },
});
