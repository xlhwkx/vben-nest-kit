import { Injectable, Logger } from '@nestjs/common';
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

const SENSITIVE_KEY =
  /password|passwd|refreshToken|authorization|tokenHash|passwordHash|accessToken|cookie/i;

function sanitizeDetail(
  detail: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (detail === null || detail === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out as Prisma.InputJsonValue;
}

function parsePage(v: number | string | undefined, fallback: number): number {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
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

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget write; never throws to callers. */
  record(input: AuditRecordInput): void {
    void this.persist(input).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`audit write failed action=${input.action}: ${msg}`);
    });
  }

  private async persist(input: AuditRecordInput): Promise<void> {
    const ctx = getRequestContext();
    const detail = sanitizeDetail(input.detail ?? undefined);

    await this.prisma.auditLog.create({
      data: {
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
      },
    });
  }

  async list(query: AuditListQuery): Promise<{ items: AuditListItem[]; total: number }> {
    const page = parsePage(query.page, 1);
    let pageSize = parsePage(query.pageSize, 20);
    if (pageSize > 100) pageSize = 100;

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
    if (query.startTime || query.endTime) {
      where.createdAt = {};
      if (query.startTime) {
        const t = new Date(query.startTime);
        if (!Number.isNaN(t.getTime())) where.createdAt.gte = t;
      }
      if (query.endTime) {
        const t = new Date(query.endTime);
        if (!Number.isNaN(t.getTime())) where.createdAt.lte = t;
      }
    }

    const total = await this.prisma.auditLog.count({ where });
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
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
