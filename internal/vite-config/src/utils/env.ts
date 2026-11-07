import type { ApplicationPluginOptions } from '../typing';

import { loadEnv as loadViteEnv } from 'vite';

const getBoolean = (value: string | undefined) => value === 'true';

const getString = (value: string | undefined, fallback: string) =>
  value ?? fallback;

const getNumber = (value: string | undefined, fallback: number) =>
  Number(value) || fallback;

/**
 * 获取当前环境下生效的配置文件名
 */
function resolveMode(explicitMode?: string) {
  const script = process.env.npm_lifecycle_script ?? '';
  const reg = /--mode ([\d_a-z]+)/;
  const result = reg.exec(script);
  let mode = explicitMode ?? 'production';
  if (result && !explicitMode) {
    mode = result[1] as string;
  }
  return mode;
}

/**
 * Get the environment variables starting with the specified prefix
 * @param match prefix
 * @param mode explicit Vite mode; lifecycle inference is a compatibility fallback
 */
async function loadEnv<T = Record<string, string>>(
  match = 'VITE_GLOB_',
  mode = resolveMode(),
) {
  // Use Vite's parser for file order, ${...} expansion and CI overrides alike.
  return loadViteEnv(mode, process.cwd(), match) as T;
}

async function loadAndConvertEnv(
  match = 'VITE_',
  mode = resolveMode(),
): Promise<
  Partial<ApplicationPluginOptions> & {
    appTitle: string;
    base: string;
    port: number;
  }
> {
  const envConfig = await loadEnv(match, mode);

  const {
    VITE_APP_TITLE,
    VITE_ARCHIVER,
    VITE_BASE,
    VITE_COMPRESS,
    VITE_DEVTOOLS,
    VITE_INJECT_APP_LOADING,
    VITE_NITRO_MOCK,
    VITE_PORT,
    VITE_PWA,
    VITE_VISUALIZER,
  } = envConfig;

  const compressTypes = (VITE_COMPRESS ?? '')
    .split(',')
    .filter((item) => item === 'brotli' || item === 'gzip');

  return {
    appTitle: getString(VITE_APP_TITLE, 'Vben Admin'),
    archiver: getBoolean(VITE_ARCHIVER),
    base: getString(VITE_BASE, '/'),
    compress: compressTypes.length > 0,
    compressTypes,
    devtools: getBoolean(VITE_DEVTOOLS),
    injectAppLoading: getBoolean(VITE_INJECT_APP_LOADING),
    nitroMock: getBoolean(VITE_NITRO_MOCK),
    port: getNumber(VITE_PORT, 5173),
    pwa: getBoolean(VITE_PWA),
    visualizer: getBoolean(VITE_VISUALIZER),
  };
}

export { loadAndConvertEnv, loadEnv, resolveMode };
