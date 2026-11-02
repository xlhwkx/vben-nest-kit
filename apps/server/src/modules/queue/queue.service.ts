import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';

/**
 * Optional BullMQ façade (tech plan §19.2 / §27).
 * Default: disabled — no Queue/Worker connections; app starts without workers.
 * Enable with QUEUE_ENABLED=true; optionally QUEUE_WORKER_ENABLED=true for
 * in-process stub processors (mail / audit-archive). Prefer separate worker
 * process in production.
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

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.enabled = Boolean(this.config.get<boolean>('QUEUE_ENABLED'));
    this.workerEnabled = Boolean(
      this.config.get<boolean>('QUEUE_WORKER_ENABLED'),
    );

    if (!this.enabled) {
      this.logger.log(
        'Queue disabled (QUEUE_ENABLED≠true); enqueue calls are no-ops',
      );
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
      `Queue enabled: ${QUEUE_NAMES.mail}, ${QUEUE_NAMES.auditArchive}`,
    );

    if (this.workerEnabled) {
      this.startStubWorkers();
    } else {
      this.logger.log(
        'Queue workers off (QUEUE_WORKER_ENABLED≠true); producers only',
      );
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

  /** Enqueue a mail stub job; no-op when queue disabled. */
  async enqueueMail(payload: Record<string, unknown>): Promise<string | null> {
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

  /** Enqueue an audit-archive stub job; no-op when queue disabled. */
  async enqueueAuditArchive(
    payload: Record<string, unknown>,
  ): Promise<string | null> {
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

  private startStubWorkers(): void {
    if (!this.connection) return;
    const prefix = this.config.get<string>('QUEUE_PREFIX') ?? 'qingzhan';

    const mailWorker = new Worker(
      QUEUE_NAMES.mail,
      async (job: Job) => {
        this.logger.debug(`mail job ${job.id} (stub): ${JSON.stringify(job.data)}`);
      },
      { connection: this.connection, prefix },
    );
    const auditWorker = new Worker(
      QUEUE_NAMES.auditArchive,
      async (job: Job) => {
        this.logger.debug(
          `audit-archive job ${job.id} (stub): ${JSON.stringify(job.data)}`,
        );
      },
      { connection: this.connection, prefix },
    );
    this.workers.push(mailWorker, auditWorker);
    this.logger.log('Queue stub workers started (mail, audit-archive)');
  }
}
