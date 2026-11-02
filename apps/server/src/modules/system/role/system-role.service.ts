import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { RedisService } from "../../../redis/redis.service";
import { AuditService } from "../../audit/audit.service";

export type SystemRoleItem = {
  id: string;
  name: string;
  code: string;
  status: number;
  createTime: string;
  permissions: string[];
  remark?: string;
};

export type SystemRoleInput = {
  name: string;
  code: string;
  status?: number;
  remark?: string | null;
  permissions?: string[];
};

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

const createTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatCreateTime(d: Date): string {
  return createTimeFormatter.format(d);
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

  async list(
    query: SystemRoleListQuery,
  ): Promise<{ items: SystemRoleItem[]; total: number }> {
    const page = parsePage(query.page, 1);
    let pageSize = parsePage(query.pageSize, 20);
    if (pageSize > 100) pageSize = 100;

    const where: Prisma.RoleWhereInput = {};

    if (query.name?.trim()) {
      where.name = { contains: query.name.trim(), mode: "insensitive" };
    }
    if (query.id?.trim()) {
      where.id = query.id.trim();
    }
    if (query.remark?.trim()) {
      where.remark = { contains: query.remark.trim(), mode: "insensitive" };
    }
    if (
      query.status === 0 ||
      query.status === "0" ||
      query.status === 1 ||
      query.status === "1"
    ) {
      where.status = Number(query.status);
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

    const total = await this.prisma.role.count({ where });
    const rows = await this.prisma.role.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
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

  async create(input: SystemRoleInput): Promise<SystemRoleItem> {
    const name = input.name?.trim();
    const code = input.code?.trim();
    if (!name) throw new BadRequestException("name is required");
    if (!code) throw new BadRequestException("code is required");

    const dupCode = await this.prisma.role.findUnique({ where: { code } });
    if (dupCode) throw new ConflictException("Role code already exists");

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
      if (menuIds.length) {
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
      action: "system.role.create",
      module: "system.role",
      status: 200,
      detail: { id: row.id, code: row.code },
    });
    return this.toItem(row);
  }

  async update(id: string, input: SystemRoleInput): Promise<SystemRoleItem> {
    const existing = await this.requireRole(id);
    const name = input.name?.trim();
    const code = input.code?.trim();
    if (!name) throw new BadRequestException("name is required");
    if (!code) throw new BadRequestException("code is required");

    if (code !== existing.code) {
      const dupCode = await this.prisma.role.findUnique({ where: { code } });
      if (dupCode) throw new ConflictException("Role code already exists");
    }

    // Only replace RoleMenu when `permissions` is explicitly present (incl. []).
    const hasPermissionsField = input.permissions !== undefined;
    const menuIds = hasPermissionsField
      ? await this.validateMenuIds(input.permissions ?? [])
      : null;
    const nextStatus = input.status === 0 ? 0 : 1;

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          name,
          code,
          status: nextStatus,
          remark: input.remark?.trim() || null,
        },
      });
      if (menuIds !== null) {
        await tx.roleMenu.deleteMany({ where: { roleId: id } });
        if (menuIds.length) {
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

    if (nextStatus !== existing.status) {
      await this.clearPermCacheForRole(id);
    }

    this.audit.record({
      action: "system.role.update",
      module: "system.role",
      status: 200,
      detail: { id: row.id, code: row.code },
    });
    return this.toItem(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.requireRole(id);
    const assigned = await this.prisma.userRole.count({ where: { roleId: id } });
    if (assigned > 0) {
      throw new ConflictException("Role has users assigned; unassign first");
    }

    await this.clearPermCacheForRole(id);
    await this.prisma.role.delete({ where: { id } });
    this.audit.record({
      action: "system.role.delete",
      module: "system.role",
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
    if (!row) throw new NotFoundException("Role not found");
    return row;
  }

  private async validateMenuIds(ids: string[]): Promise<string[]> {
    const unique = Array.from(
      new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean)),
    );
    if (!unique.length) return [];
    const found = await this.prisma.menu.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException("One or more menu ids are invalid");
    }
    return unique;
  }

  private async clearPermCacheForRole(roleId: string): Promise<void> {
    const links = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await Promise.all(
      links.map((l) => this.redis.del(`perm:codes:${l.userId}`)),
    );
  }
}
