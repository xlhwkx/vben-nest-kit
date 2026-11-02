import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeRecipients, redactEmail } from './mail.types';
import type { MailMessage, MailProvider } from './mail.types';

/**
 * SMTP skeleton (tech plan §26). Reads SMTP_* env only.
 * Does **not** open a real SMTP connection in this knife (dry-run / no-op).
 * Missing config → no-op with a clear log (never prints passwords).
 */
@Injectable()
export class SmtpMailProvider implements MailProvider {
  readonly driver = 'smtp' as const;
  private readonly logger = new Logger(SmtpMailProvider.name);
  private readonly configured: boolean;
  private readonly host: string;
  private readonly port: number;
  private readonly from: string;
  private readonly userPresent: boolean;

  constructor(private readonly config: ConfigService) {
    this.host = (this.config.get<string>('SMTP_HOST') ?? '').trim();
    this.port = Number(this.config.get<number>('SMTP_PORT') ?? 587);
    this.from = (this.config.get<string>('SMTP_FROM') ?? '').trim();
    const user = (this.config.get<string>('SMTP_USER') ?? '').trim();
    this.userPresent = Boolean(user);
    // Password is read only to know whether credentials exist — never logged.
    const pass = (this.config.get<string>('SMTP_PASS') ?? '').trim();
    this.configured = Boolean(this.host && this.from && this.port > 0);
    if (!this.configured) {
      this.logger.warn('SMTP driver selected but SMTP_HOST/SMTP_FROM incomplete; send() is no-op');
    } else if (!pass && this.userPresent) {
      this.logger.warn('SMTP_USER set without SMTP_PASS; send() remains dry-run no-op');
    } else {
      this.logger.log(
        `SMTP skeleton ready host=${this.host} port=${this.port} from=${redactEmail(this.from)} (dry-run, no socket)`,
      );
    }
  }

  send(message: MailMessage): Promise<void> {
    const tos = normalizeRecipients(message.to).map((addr) => redactEmail(addr));
    const subject = String(message.subject ?? '').slice(0, 80);
    if (!this.configured) {
      this.logger.warn(
        `smtp mail skipped (not configured) to=[${tos.join(',')}] subject=${JSON.stringify(subject)}`,
      );
      return Promise.resolve();
    }
    // Skeleton: do not connect. Wire nodemailer / SES here later.
    this.logger.log(
      `smtp dry-run → host=${this.host} to=[${tos.join(',')}] subject=${JSON.stringify(subject)}`,
    );
    return Promise.resolve();
  }
}
