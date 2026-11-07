import { oxlintConfig } from '@vben/oxlint-config';

import { defineConfig } from 'oxlint';

export default defineConfig({
  ...oxlintConfig,
  // Nest/Jest uses apps/server/eslint.config.mjs, which the ESLint hook loads.
  ignorePatterns: [...(oxlintConfig.ignorePatterns ?? []), 'apps/server/**'],
});
