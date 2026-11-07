// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEnv, resolveMode } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('runtime app-config and Vite use the same environment', () => {
  it('uses the explicit Vite mode instead of guessing from a lifecycle script', () => {
    vi.stubEnv('npm_lifecycle_script', 'vite build --mode production');
    expect(resolveMode('staging')).toBe('staging');
  });
  it('honors CI overrides and exposes only the requested public prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingzhan-env-'));
    try {
      await writeFile(join(root, '.env'), 'VITE_GLOB_API_URL=/api\n');
      await writeFile(
        join(root, '.env.staging.local'),
        'VITE_GLOB_API_URL=/staging\n',
      );
      vi.spyOn(process, 'cwd').mockReturnValue(root);
      vi.stubEnv('VITE_GLOB_API_URL', 'https://ci.example.test/api');
      vi.stubEnv('DATABASE_URL', 'must-not-be-exposed');
      const config = await loadEnv('VITE_GLOB_', 'staging');
      expect(config.VITE_GLOB_API_URL).toBe('https://ci.example.test/api');
      expect(config).not.toHaveProperty('DATABASE_URL');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('expands API references with the same parser as the application guard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingzhan-env-'));
    try {
      await writeFile(
        join(root, '.env.staging'),
        `API_ORIGIN=https://stage.example.test\nVITE_GLOB_API_URL=\${API_ORIGIN}/api\n`,
      );
      vi.spyOn(process, 'cwd').mockReturnValue(root);
      vi.stubEnv('VITE_GLOB_API_URL', undefined);
      vi.stubEnv('API_ORIGIN', undefined);
      const config = await loadEnv('VITE_GLOB_', 'staging');
      expect(config.VITE_GLOB_API_URL).toBe('https://stage.example.test/api');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
