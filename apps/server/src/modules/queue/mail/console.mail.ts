import { Injectable, Logger } from '@nestjs/common';
import { normalizeRecipients, redactEmail } from './mail.types';
import type { MailMessage, MailProvider } from './mail.types';

/** Dev / default sink: log redacted fields only; never send over the network. */
@Injectable()
export class ConsoleMailProvider implements MailProvider {
  readonly driver = 'console' as const;
  private readonly logger = new Logger(ConsoleMailProvider.name);

  send(message: MailMessage): Promise<void> {
    const tos = normalizeRecipients(message.to).map((addr) => redactEmail(addr));
    const subject = String(message.subject ?? '').slice(0, 80);
    this.logger.log(
      `console mail → to=[${tos.join(',')}] subject=${JSON.stringify(subject)} template=${message.template ?? '-'}`,
    );
    return Promise.resolve();
  }
}
