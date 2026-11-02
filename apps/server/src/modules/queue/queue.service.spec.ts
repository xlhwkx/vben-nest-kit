import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { ConsoleMailProvider } from './mail/console.mail';

describe('queueService (disabled by default)', () => {
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

    const mail = new ConsoleMailProvider();
    const svc = new QueueService(config, mail);
    await svc.onModuleInit();
    expect(svc.isEnabled()).toBe(false);
    expect(svc.getMailDriver()).toBe('console');
    await expect(svc.enqueueMail({ to: 'a@b.c', subject: 't' })).resolves.toBeNull();
    await expect(svc.enqueueAuditArchive({ id: 1 })).resolves.toBeNull();
    await svc.onModuleDestroy();
  });

  it('sendMailNow uses console provider', async () => {
    const config = {
      get: () => false,
      getOrThrow: (key: string) => {
        throw new Error(`unexpected getOrThrow ${key}`);
      },
    } as unknown as ConfigService;
    const svc = new QueueService(config, new ConsoleMailProvider());
    await expect(
      svc.sendMailNow({ to: 'alice@example.com', subject: 'hello' }),
    ).resolves.toBeUndefined();
  });
});
