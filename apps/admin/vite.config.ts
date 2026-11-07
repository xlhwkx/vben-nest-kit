import process from 'node:process';

import { assertBackendConfig, defineConfig } from '@vben/vite-config';

import { loadEnv } from 'vite';

export default defineConfig(async ({ mode }) => {
  assertBackendConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    application: {},
    vite: {
      build: { target: 'es2022' },
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // Nest API; Nitro mock stays disabled for the supported admin.
            target: 'http://localhost:5320/api',
            ws: true,
          },
        },
      },
    },
  };
});
