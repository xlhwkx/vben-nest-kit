import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { MAIL_PROVIDER, normalizeRecipients, redactEmail } from './mail/mail.types';
import type { MailMessage, MailProvider } from './mail/mail.types';
import { ConsoleMailProvider } from './mail/console.mail';

/**
 * Optional BullMQ façade (tech plan §19.2 / §27).
 * Default: disabled — no Queue/Worker connections; app starts without workers.
 * Enable with QUEUE_ENABLED=true; optionally QUEUE_WORKER_ENABLED=true for
 * in-process processors (mail / audit-archive). Prefer separate worker
 * process in production.
 *
 * Mail jobs: worker calls MailProvider (console default / smtp dry-run).
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private enabled = false;
  private workerEnabled = false;
  private connection: ConnectionOptions | null = null;
  private mailQueue: Queue | null = null;
  private auditQueue: Queue | null = null;
  private workers: Worker[] = [];
  private readonly mail: MailProvider;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(MAIL_PROVIDER) mailProvider?: MailProvider,
  ) {
    this.mail = mailProvider ?? new ConsoleMailProvider();
  }

  async onModuleInit(): Promise<void> {
    this.enabled = Boolean(this.config.get<boolean>('QUEUE_ENABLED'));
    this.workerEnabled = Boolean(this.config.get<boolean>('QUEUE_WORKER_ENABLED'));

    if (!this.enabled) {
      this.logger.log('Queue disabled (QUEUE_ENABLED≠true); enqueue calls are no-ops');
      await Promise.resolve();
      return;
    }

    this.connection = this.buildConnection();
    this.mailQueue = new Queue(QUEUE_NAMES.mail, {
      connection: this.connection,
      prefix: this.config.get<string>('QUEUE_PREFIX') ?? 'qingzhan',
    });
    this.auditQueue = new Queue(QUEUE_NAMES.auditArchive, {
      connection: this.connection,
      prefix: this.config.get<string>('QUEUE_PREFIX') ?? 'qingzhan',
    });
    this.logger.log(
      `Queue enabled: ${QUEUE_NAMES.mail}, ${QUEUE_NAMES.auditArchive} (mail driver=${this.mail.driver})`,
    );

    if (this.workerEnabled) {
      this.startWorkers();
    } else {
      this.logger.log('Queue workers off (QUEUE_WORKER_ENABLED≠true); producers only');
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const w of this.workers) {
      await w.close().catch(() => undefined);
    }
    this.workers = [];
    await this.mailQueue?.close().catch(() => undefined);
    await this.auditQueue?.close().catch(() => undefined);
    this.mailQueue = null;
    this.auditQueue = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMailDriver(): string {
    return this.mail.driver;
  }

  /** Enqueue a mail job; no-op when queue disabled. */
  async enqueueMail(payload: MailMessage | Record<string, unknown>): Promise<string | null> {
    if (!this.mailQueue) {
      this.logger.debug('enqueueMail skipped (queue disabled)');
      return null;
    }
    const job = await this.mailQueue.add('send', payload, {
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    return job.id ?? null;
  }

  /** Direct send via MailProvider (bypasses queue; useful in unit tests). */
  async sendMailNow(message: MailMessage): Promise<void> {
    await this.mail.send(message);
  }

  /** Enqueue an audit-archive stub job; no-op when queue disabled. */
  async enqueueAuditArchive(payload: Record<string, unknown>): Promise<string | null> {
    if (!this.auditQueue) {
      this.logger.debug('enqueueAuditArchive skipped (queue disabled)');
      return null;
    }
    const job = await this.auditQueue.add('archive', payload, {
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    return job.id ?? null;
  }

  private buildConnection(): ConnectionOptions {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    const db = this.config.get<number>('QUEUE_REDIS_DB');
    // Prefer dedicated DB index when set (tech plan §19.4); else reuse URL as-is.
    if (db !== undefined && Number.isFinite(db)) {
      try {
        const u = new URL(url);
        u.pathname = `/${db}`;
        return { url: u.toString(), maxRetriesPerRequest: null };
      } catch {
        // fall through
      }
    }
    return { url, maxRetriesPerRequest: null };
  }

  private startWorkers(): void {
    if (!this.connection) return;
    const prefix = this.config.get<string>('QUEUE_PREFIX') ?? 'qingzhan';

    const mailWorker = new Worker(
      QUEUE_NAMES.mail,
      async (job: Job) => {
        await this.processMailJob(job);
      },
      { connection: this.connection, prefix },
    );
    const auditWorker = new Worker(
      QUEUE_NAMES.auditArchive,
      async (job: Job) => {
        // Stub only: log id+name. Never dump full job.data.
        this.logger.debug(`audit-archive job id=${job.id} name=${job.name} (stub)`);
        await Promise.resolve();
      },
      { connection: this.connection, prefix },
    );
    this.workers.push(mailWorker, auditWorker);
    this.logger.log(`Queue workers started (mail→${this.mail.driver}, audit-archive stub)`);
  }

  private async processMailJob(job: Job): Promise<void> {
    const data = (job.data ?? {}) as Partial<MailMessage> & Record<string, unknown>;
    const tos = normalizeRecipients(data.to ?? []);
    const redacted = tos.map((addr) => redactEmail(addr)).join(',') || '-';
    const subject = String(data.subject ?? '').slice(0, 80);
    this.logger.log(
      `mail job id=${job.id} name=${job.name} to=[${redacted}] subject=${JSON.stringify(subject)} driver=${this.mail.driver}`,
    );
    if (tos.length === 0) {
      this.logger.warn(`mail job id=${job.id} missing to; skipped`);
      return;
    }
    await this.mail.send({
      to: tos,
      subject: String(data.subject ?? ''),
      text: typeof data.text === 'string' ? data.text : undefined,
      html: typeof data.html === 'string' ? data.html : undefined,
      template: typeof data.template === 'string' ? data.template : undefined,
      context: data.context && typeof data.context === 'object' ? data.context : undefined,
    });
  }
}
