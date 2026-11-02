import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // Nest 后端（apps/server，默认 5320）
            target: 'http://localhost:5320/api',
            ws: true,
          },
        },
      },
    },
  };
});
