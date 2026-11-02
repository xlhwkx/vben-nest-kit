import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local.storage';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('StorageProvider (local default)', () => {
  it('LocalStorageProvider puts file and returns public url', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qz-upload-'));
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          UPLOAD_DIR: dir,
          UPLOAD_PUBLIC_PATH: '/uploads',
          APP_PUBLIC_URL: 'http://localhost:5320',
        };
        return map[key];
      },
    } as unknown as ConfigService;

    const local = new LocalStorageProvider(config);
    await local.onModuleInit();
    expect(local.driver).toBe('local');

    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await local.put({
      key: '2026/11/test.bin',
      body,
      contentType: 'application/octet-stream',
    });
    expect(result.url).toBe('http://localhost:5320/uploads/2026/11/test.bin');
    const abs = path.join(dir, '2026', '11', 'test.bin');
    const saved = await fs.readFile(abs);
    expect(Buffer.compare(saved, body)).toBe(0);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('STORAGE_DRIVER default is local (env schema)', async () => {
    const { loadEnv } = await import('../../../common/config/env');
    const env = loadEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379/0',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
    });
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.QUEUE_ENABLED).toBe(false);
    expect(env.QUEUE_WORKER_ENABLED).toBe(false);
  });
});
