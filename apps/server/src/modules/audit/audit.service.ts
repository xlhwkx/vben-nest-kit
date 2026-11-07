import { parseListCreatedAtRange } from '../../common/parse-list-time-range';
import {
  listQuerySchema,
  withListOffsetLimit,
  listOffsetError,
} from '../../common/validation/list-query';
import { parseQuery, optionalQueryText } from '../../common/validation/request-validation';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../observability/metrics.service';
import { formatCreateTimeIso } from '../../common/format-create-time';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequestContext } from '../../common/request-context';

export type AuditRecordInput = {
  action: string;
  module?: string;
  userId?: string | null;
  username?: string | null;
  method?: string | null;
  path?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  status?: number | null;
  detail?: Record<string, unknown> | null;
};

const SENSITIVE_KEY = /password|passwd|token|authorization|cookie|secret|api.?key|credential/i;

function sanitizeDetail(
  detail: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (detail === null || detail === undefined) return undefined;
  const clean = (value: unknown, depth: number): Prisma.InputJsonValue | null => {
    if (depth > 12) return '[depth limit]';
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key, item]) => !SENSITIVE_KEY.test(key) && item !== undefined)
          .map(([key, item]) => [key, clean(item, depth + 1)]),
      );
    }
    return null;
  };
  return clean(detail, 0) ?? undefined;
}

export type AuditListQuery = {
  page?: number | string;
  pageSize?: number | string;
  username?: string;
  action?: string;
  module?: string;
  startTime?: string;
  endTime?: string;
};

export type AuditListItem = {
  id: string;
  userId?: string;
  username?: string;
  action: string;
  module?: string;
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  status?: number;
  detail?: unknown;
  createTime: string;
};

const auditListSchema = listQuerySchema
  .extend({
    username: optionalQueryText(64),
    action: optionalQueryText(128),
    module: optionalQueryText(64),
    startTime: optionalQueryText(64),
    endTime: optionalQueryText(64),
  })
  .refine(withListOffsetLimit, listOffsetError);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly queue: Prisma.AuditLogUncheckedCreateInput[] = [];
  private readonly idle = new Set<() => void>();
  private active = 0;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config: ConfigService = new ConfigService(),
    @Optional() private readonly metrics: MetricsService = new MetricsService(),
  ) {}

  /** Fire-and-forget write; never throws to callers. */
  record(input: AuditRecordInput): void {
    const limit = this.config.get<number>('AUDIT_BACKGROUND_MAX_PENDING') ?? 256;
    if (this.closing || this.active + this.queue.length >= limit) {
      this.metrics.incAuditDropped(this.closing ? 'shutdown' : 'capacity');
      return;
    }
    // Snapshot identity/detail NOW: a queued write may run in another request's ALS context.
    this.queue.push(this.buildData(input));
    this.pump();
  }

  private pump(): void {
    const concurrency = this.config.get<number>('AUDIT_BACKGROUND_CONCURRENCY') ?? 4;
    while (this.active < concurrency && this.queue.length > 0) {
      const data = this.queue.shift()!;
      this.active++;
      void this.writeBackground(data);
    }
    this.metrics.setAuditBacklog(this.active, this.active + this.queue.length);
    if (this.active === 0 && this.queue.length === 0) {
      for (const resolve of this.idle) resolve();
    }
  }

  private async writeBackground(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data });
    } catch {
      this.metrics.incAuditWriteFailed();
      // Do not print the failed query, request data or credentials from driver errors.
      this.logger.warn('Background audit write failed');
    } finally {
      this.active--;
      this.pump();
    }
  }

  /** Security-sensitive mutations commit their audit in the very same transaction. */
  async recordInTransaction(tx: Prisma.TransactionClient, input: AuditRecordInput): Promise<void> {
    await tx.auditLog.create({ data: this.buildData(input) });
  }

  /** Called after HTTP drain, before Prisma destruction; failures remain logged. */
  async flush(timeoutMs: number): Promise<void> {
    this.closing = true;
    if (this.active + this.queue.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done!: () => void;
    try {
      await new Promise<void>((resolve) => {
        done = resolve;
        this.idle.add(done);
        timer = setTimeout(
          () => {
            this.logger.warn(
              `audit drain timed out with ${this.active + this.queue.length} pending writes`,
            );
            resolve();
          },
          Math.max(0, timeoutMs),
        );
      });
    } finally {
      if (timer) clearTimeout(timer);
      this.idle.delete(done);
    }
  }

  private buildData(input: AuditRecordInput): Prisma.AuditLogUncheckedCreateInput {
    const ctx = getRequestContext();
    const detail = sanitizeDetail(input.detail ?? undefined);

    return {
      userId: input.userId ?? ctx?.userId ?? null,
      username: input.username ?? ctx?.username ?? null,
      action: input.action,
      module: input.module ?? null,
      method: input.method ?? ctx?.method ?? null,
      path: input.path ?? ctx?.path ?? null,
      ip: input.ip ?? ctx?.ip ?? null,
      userAgent: input.userAgent ?? ctx?.userAgent ?? null,
      requestId: input.requestId ?? ctx?.requestId ?? null,
      status: input.status ?? null,
      ...(detail === undefined ? {} : { detail }),
    };
  }

  async list(rawQuery: AuditListQuery): Promise<{ items: AuditListItem[]; total: number }> {
    const query = parseQuery(auditListSchema, rawQuery);
    const { page, pageSize } = query;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.username?.trim()) {
      where.username = {
        contains: query.username.trim(),
        mode: 'insensitive',
      };
    }
    if (query.action?.trim()) {
      where.action = {
        contains: query.action.trim(),
        mode: 'insensitive',
      };
    }
    if (query.module?.trim()) {
      where.module = {
        contains: query.module.trim(),
        mode: 'insensitive',
      };
    }
    const createdAt = parseListCreatedAtRange(query.startTime, query.endTime);
    if (createdAt) where.createdAt = createdAt;

    const total = await this.prisma.auditLog.count({ where });
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: rows.map((row) => {
        const item: AuditListItem = {
          id: row.id,
          action: row.action,
          createTime: formatCreateTimeIso(row.createdAt),
        };
        if (row.userId) item.userId = row.userId;
        if (row.username) item.username = row.username;
        if (row.module) item.module = row.module;
        if (row.method) item.method = row.method;
        if (row.path) item.path = row.path;
        if (row.ip) item.ip = row.ip;
        if (row.userAgent) item.userAgent = row.userAgent;
        if (row.requestId) item.requestId = row.requestId;
        if (row.status !== null && row.status !== undefined) item.status = row.status;
        if (row.detail !== null && row.detail !== undefined) item.detail = row.detail;
        return item;
      }),
      total,
    };
  }
}
