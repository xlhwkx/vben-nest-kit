import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';

describe('QueueService (disabled by default)', () => {
  it('enqueue is no-op when QUEUE_ENABLED is false', async () => {
    const config = {
      get: (key: string) => {
        if (key === 'QUEUE_ENABLED') return false;
        if (key === 'QUEUE_WORKER_ENABLED') return false;
        return undefined;
      },
      getOrThrow: (key: string) => {
        throw new Error(`unexpected getOrThrow ${key}`);
      },
    } as unknown as ConfigService;

    const svc = new QueueService(config);
    await svc.onModuleInit();
    expect(svc.isEnabled()).toBe(false);
    await expect(svc.enqueueMail({ to: 'a@b.c' })).resolves.toBeNull();
    await expect(svc.enqueueAuditArchive({ id: 1 })).resolves.toBeNull();
    await svc.onModuleDestroy();
  });
});
