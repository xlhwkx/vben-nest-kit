import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditService } from '../../audit/audit.service';
import { parseListCreatedAtRange } from '../../../common/parse-list-time-range';

export type SystemRoleItem = {
  id: string;
  name: string;
  code: string;
  status: number;
  createTime: string;
  permissions: string[];
  remark?: string;
};

export type SystemRoleCreateInput = {
  name: string;
  code?: string;
  status?: number;
  remark?: string | null;
  permissions?: string[];
};

export type SystemRoleUpdateInput = {
  name?: string;
  code?: string;
  status?: number;
  remark?: string | null;
  permissions?: string[];
};

/** @deprecated use SystemRoleCreateInput */
export type SystemRoleInput = SystemRoleCreateInput;

export type SystemRoleListQuery = {
  page?: number | string;
  pageSize?: number | string;
  name?: string;
  id?: string;
  remark?: string;
  startTime?: string;
  endTime?: string;
  status?: string | number;
};

const createTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatCreateTime(d: Date): string {
  return createTimeFormatter.format(d);
}

/** Mock/UI have no role.code; Nest needs unique code for RBAC — slug from name. */
function slugRoleCode(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .slice(0, 48);
  if (base) return base;
  return `role_${Date.now().toString(36)}`;
}

function parsePage(v: number | string | undefined, fallback: number): number {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

@Injectable()
export class SystemRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SystemRoleListQuery): Promise<{ items: SystemRoleItem[]; total: number }> {
    const page = parsePage(query.page, 1);
    let pageSize = parsePage(query.pageSize, 20);
    if (pageSize > 100) pageSize = 100;

    const where: Prisma.RoleWhereInput = {};

    if (query.name?.trim()) {
      where.name = { contains: query.name.trim(), mode: 'insensitive' };
    }
    if (query.id?.trim()) {
      where.id = query.id.trim();
    }
    if (query.remark?.trim()) {
      where.remark = { contains: query.remark.trim(), mode: 'insensitive' };
    }
    if (query.status === 0 || query.status === '0' || query.status === 1 || query.status === '1') {
      where.status = Number(query.status);
    }
    const createdAt = parseListCreatedAtRange(query.startTime, query.endTime);
    if (createdAt) where.createdAt = createdAt;

    const total = await this.prisma.role.count({ where });
    const rows = await this.prisma.role.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        menus: {
          where: { menu: { deletedAt: null } },
          select: { menuId: true },
        },
      },
    });

    return { items: rows.map((row) => this.toItem(row)), total };
  }

  async create(input: SystemRoleCreateInput): Promise<SystemRoleItem> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    let code = input.code?.trim() || slugRoleCode(name);
    const dupCode = await this.prisma.role.findUnique({ where: { code } });
    if (dupCode) {
      if (input.code?.trim()) {
        throw new ConflictException('Role code already exists');
      }
      code = `${code}_${Date.now().toString(36)}`.slice(0, 64);
    }

    const menuIds = await this.validateMenuIds(input.permissions ?? []);

    const row = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name,
          code,
          status: input.status === 0 ? 0 : 1,
          remark: input.remark?.trim() || null,
        },
      });
      if (menuIds.length > 0) {
        await tx.roleMenu.createMany({
          data: menuIds.map((menuId) => ({ roleId: role.id, menuId })),
          skipDuplicates: true,
        });
      }
      return tx.role.findUniqueOrThrow({
        where: { id: role.id },
        include: {
          menus: {
            where: { menu: { deletedAt: null } },
            select: { menuId: true },
          },
        },
      });
    });

    this.audit.record({
      action: 'system.role.create',
      module: 'system.role',
      status: 200,
      detail: { id: row.id, code: row.code },
    });
    return this.toItem(row);
  }

  async update(id: string, input: SystemRoleUpdateInput): Promise<SystemRoleItem> {
    const existing = await this.requireRole(id);

    const data: Prisma.RoleUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('name is required');
      data.name = name;
    }
    if (input.code !== undefined) {
      const code = input.code.trim();
      if (!code) throw new BadRequestException('code is required');
      if (code !== existing.code) {
        const dupCode = await this.prisma.role.findUnique({ where: { code } });
        if (dupCode) throw new ConflictException('Role code already exists');
        data.code = code;
      }
    }
    if (input.status === 0 || input.status === 1) {
      data.status = input.status;
    }
    if (input.remark !== undefined) {
      data.remark = input.remark?.trim() || null;
    }

    // Only replace RoleMenu when permissions is explicitly present (incl. []).
    const hasPermissionsField = input.permissions !== undefined;
    const menuIds = hasPermissionsField
      ? await this.validateMenuIds(input.permissions ?? [])
      : null;

    const row = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.role.update({ where: { id }, data });
      }
      if (menuIds !== null) {
        await tx.roleMenu.deleteMany({ where: { roleId: id } });
        if (menuIds.length > 0) {
          await tx.roleMenu.createMany({
            data: menuIds.map((menuId) => ({ roleId: id, menuId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.role.findUniqueOrThrow({
        where: { id },
        include: {
          menus: {
            where: { menu: { deletedAt: null } },
            select: { menuId: true },
          },
        },
      });
    });

    if ((input.status === 0 || input.status === 1) && input.status !== existing.status) {
      await this.clearPermCacheForRole(id);
    }

    this.audit.record({
      action: 'system.role.update',
      module: 'system.role',
      status: 200,
      detail: { id: row.id, code: row.code, fields: Object.keys(input) },
    });
    return this.toItem(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.requireRole(id);
    const assigned = await this.prisma.userRole.count({
      where: { roleId: id },
    });
    if (assigned > 0) {
      throw new ConflictException('Role has users assigned; unassign first');
    }

    await this.clearPermCacheForRole(id);
    await this.prisma.role.delete({ where: { id } });
    this.audit.record({
      action: 'system.role.delete',
      module: 'system.role',
      status: 200,
      detail: { id },
    });
    return { id };
  }

  private toItem(row: {
    id: string;
    name: string;
    code: string;
    status: number;
    remark: string | null;
    createdAt: Date;
    menus: { menuId: string }[];
  }): SystemRoleItem {
    const item: SystemRoleItem = {
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      createTime: formatCreateTime(row.createdAt),
      permissions: row.menus.map((m) => m.menuId),
    };
    if (row.remark) item.remark = row.remark;
    return item;
  }

  private async requireRole(id: string) {
    const row = await this.prisma.role.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Role not found');
    return row;
  }

  private async validateMenuIds(ids: string[]): Promise<string[]> {
    const unique = [...new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean))];
    if (unique.length === 0) return [];
    const found = await this.prisma.menu.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('One or more menu ids are invalid');
    }
    return unique;
  }

  private async clearPermCacheForRole(roleId: string): Promise<void> {
    const links = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await Promise.all(links.map((l) => this.redis.del(`perm:codes:${l.userId}`)));
  }
}
