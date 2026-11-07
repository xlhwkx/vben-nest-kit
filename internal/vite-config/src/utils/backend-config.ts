/** Guard the two Qingzhan frontends; upstream UI variants retain their own config. */
export function assertBackendConfig(
  env: Record<string, string | undefined>,
): void {
  if (env.VITE_NITRO_MOCK && !['0', 'false'].includes(env.VITE_NITRO_MOCK)) {
    throw new Error(
      'Qingzhan requires VITE_NITRO_MOCK=false; use an upstream frontend for mock demos',
    );
  }
  if (['1', 'true'].includes(env.VITE_CAPTCHA_E2E_BYPASS ?? '')) {
    throw new Error(
      'Qingzhan does not allow CAPTCHA E2E bypass in application builds',
    );
  }
  const value = env.VITE_GLOB_API_URL;
  if (!value || value !== value.trim() || /[\s\\?#]/u.test(value)) {
    throw new Error(
      'VITE_GLOB_API_URL must be an API base path or absolute HTTP(S) URL',
    );
  }
  if (value.startsWith('/') && !value.startsWith('//')) return;
  try {
    const url = new URL(value);
    if (
      /^https?:\/\/[^/]/u.test(value) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !/(^|\.)mock-napi\.vben\.pro$/iu.test(url.hostname.replace(/\.$/u, ''))
    )
      return;
  } catch {
    /* Rejected below without printing environment values. */
  }
  throw new Error(
    'Qingzhan API must target Nest, not the upstream mock or an invalid URL',
  );
}
