import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { ConsoleMailProvider } from './mail/console.mail';
import { SmtpMailProvider } from './mail/smtp.mail';
import { MAIL_PROVIDER } from './mail/mail.types';
import type { MailProvider } from './mail/mail.types';

/**
 * Optional async job skeleton (BullMQ). Safe when QUEUE_ENABLED=false:
 * QueueService is a no-op façade and does not open BullMQ connections.
 * MailProvider defaults to console sink (no network).
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailProvider => {
        const driver = config.get<string>('MAIL_DRIVER') ?? 'console';
        if (driver === 'smtp') {
          return new SmtpMailProvider(config);
        }
        return new ConsoleMailProvider();
      },
    },
    QueueService,
  ],
  exports: [QueueService, MAIL_PROVIDER],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class QueueModule {}
