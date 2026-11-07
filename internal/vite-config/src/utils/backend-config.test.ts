import { describe, expect, it } from 'vitest';

import { assertBackendConfig } from './backend-config';

describe('qingzhan delivery configuration', () => {
  it.each([
    '/api',
    '/api/v1',
    'https://api.example.test/api',
    'http://127.0.0.1:5320/api',
  ])('accepts a real API base: %s', (value) => {
    expect(() =>
      assertBackendConfig({
        VITE_GLOB_API_URL: value,
        VITE_NITRO_MOCK: 'false',
      }),
    ).not.toThrow();
  });
  it.each([
    '',
    '//evil.test/api',
    String.raw`/\evil.test/api`,
    String.raw`https:\evil.test/api`,
    'javascript:alert(1)',
    'https://mock-napi.vben.pro/api',
    'https://mock-napi.vben.pro./api',
    'https:evil.test/api',
    'https:///evil.test/api',
    'https://user:pass@example.test/api',
  ])('rejects an unsafe or demo target: %s', (value) => {
    expect(() => assertBackendConfig({ VITE_GLOB_API_URL: value })).toThrow(
      /API/u,
    );
  });
  it('rejects re-enabling Nitro mock or a captcha bypass', () => {
    expect(() =>
      assertBackendConfig({
        VITE_GLOB_API_URL: '/api',
        VITE_NITRO_MOCK: 'true',
      }),
    ).toThrow(/MOCK/u);
    expect(() =>
      assertBackendConfig({
        VITE_GLOB_API_URL: '/api',
        VITE_CAPTCHA_E2E_BYPASS: 'true',
      }),
    ).toThrow(/bypass/u);
  });
});
