import { assertRouteAncestors } from '../../../common/authorization/menu-ancestors';
import { assertEditClaim, parseEditVersion } from '../../../common/validation/edit-version';
import {
  listQuerySchema,
  withListOffsetLimit,
  listOffsetError,
} from '../../../common/validation/list-query';
import {
  parseQuery,
  optionalQueryText,
  optionalQueryId,
  optionalQueryEnum,
} from '../../../common/validation/request-validation';
import { authorizationMutation } from '../../../common/authorization/authorization-mutation';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { assertGrantableMenus } from '../../../common/authorization/permission-codes';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { parseListCreatedAtRange } from '../../../common/parse-list-time-range';
import { formatCreateTimeIso } from '../../../common/format-create-time';

export type SystemRoleItem = {
  version: number;
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
  version: number;
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

const roleListSchema = listQuerySchema
  .extend({
    name: optionalQueryText(128),
    remark: optionalQueryText(512),
    startTime: optionalQueryText(64),
    endTime: optionalQueryText(64),
    id: optionalQueryId,
    status: optionalQueryEnum([0, 1]),
  })
  .refine(withListOffsetLimit, listOffsetError);

@Injectable()
export class SystemRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(rawQuery: SystemRoleListQuery): Promise<{ items: SystemRoleItem[]; total: number }> {
    const query = parseQuery(roleListSchema, rawQuery);
    const { page, pageSize } = query;

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
    if (query.status !== undefined) where.status = query.status;
    const createdAt = parseListCreatedAtRange(query.startTime, query.endTime);
    if (createdAt) where.createdAt = createdAt;

    // The scalar revision and relation ids must come from the same DB snapshot.
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.role.count({ where });
        const rows = await tx.role.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
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
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(input: SystemRoleCreateInput, actor: AuthUser): Promise<SystemRoleItem> {
    return authorizationMutation(this.prisma, actor, 'System:Role:Create', (tx) =>
      this.createAuthorized(input, actor.userId, tx),
    );
  }

  private async createAuthorized(
    input: SystemRoleCreateInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<SystemRoleItem> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    let code = input.code?.trim() || slugRoleCode(name);
    const dupCode = await db.role.findUnique({ where: { code } });
    if (dupCode) {
      if (input.code?.trim()) {
        throw new ConflictException('Role code already exists');
      }
      code = `${code}_${Date.now().toString(36)}`.slice(0, 64);
    }

    await assertGrantableMenus(db, actorId, {
      id: { in: input.permissions ?? [] },
    });
    const menuIds = await this.validateMenuIds(input.permissions ?? [], db);

    const role = await db.role.create({
      data: {
        name,
        code,
        status: input.status === 0 ? 0 : 1,
        remark: input.remark?.trim() || null,
      },
    });
    if (menuIds.length > 0) {
      await db.roleMenu.createMany({
        data: menuIds.map((menuId) => ({ roleId: role.id, menuId })),
        skipDuplicates: true,
      });
    }
    const row = await db.role.findUniqueOrThrow({
      where: { id: role.id },
      include: {
        menus: {
          where: { menu: { deletedAt: null } },
          select: { menuId: true },
        },
      },
    });

    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.role.create',
      module: 'system.role',
      status: 200,
      detail: { id: row.id, code: row.code },
    });
    return this.toItem(row);
  }

  async update(id: string, input: SystemRoleUpdateInput, actor: AuthUser): Promise<SystemRoleItem> {
    parseEditVersion(input.version);
    return authorizationMutation(this.prisma, actor, 'System:Role:Update', (tx) =>
      this.updateAuthorized(id, input, actor.userId, tx),
    );
  }

  private async updateAuthorized(
    id: string,
    input: SystemRoleUpdateInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<SystemRoleItem> {
    await assertGrantableMenus(db, actorId, {
      roles: { some: { roleId: id } },
    });
    if (input.permissions !== undefined)
      await assertGrantableMenus(db, actorId, {
        id: { in: input.permissions },
      });
    const existing = await this.requireRole(id, db);
    const claim = await db.role.updateMany({
      where: { id, version: input.version },
      data: { version: { increment: 1 } },
    });
    assertEditClaim(claim.count);

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
        const dupCode = await db.role.findUnique({ where: { code } });
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
      ? await this.validateMenuIds(input.permissions ?? [], db)
      : null;

    if (Object.keys(data).length > 0) {
      await db.role.update({ where: { id }, data });
    }
    if (menuIds !== null) {
      await db.roleMenu.deleteMany({ where: { roleId: id } });
      if (menuIds.length > 0) {
        await db.roleMenu.createMany({
          data: menuIds.map((menuId) => ({ roleId: id, menuId })),
          skipDuplicates: true,
        });
      }
    }
    const row = await db.role.findUniqueOrThrow({
      where: { id },
      include: {
        menus: {
          where: { menu: { deletedAt: null } },
          select: { menuId: true },
        },
      },
    });

    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.role.update',
      module: 'system.role',
      status: 200,
      detail: { id: row.id, code: row.code, fields: Object.keys(input) },
    });
    return this.toItem(row);
  }

  async remove(id: string, actor: AuthUser): Promise<{ id: string }> {
    return authorizationMutation(this.prisma, actor, 'System:Role:Delete', (tx) =>
      this.removeAuthorized(id, actor.userId, tx),
    );
  }

  private async removeAuthorized(
    id: string,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    await assertGrantableMenus(db, actorId, {
      roles: { some: { roleId: id } },
    });
    await this.requireRole(id, db);
    const assigned = await db.userRole.count({
      where: { roleId: id },
    });
    if (assigned > 0) {
      throw new ConflictException('Role has users assigned; unassign first');
    }

    await db.role.delete({ where: { id } });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.role.delete',
      module: 'system.role',
      status: 200,
      detail: { id },
    });
    return { id };
  }

  private toItem(row: {
    version: number;
    id: string;
    name: string;
    code: string;
    status: number;
    remark: string | null;
    createdAt: Date;
    menus: { menuId: string }[];
  }): SystemRoleItem {
    const item: SystemRoleItem = {
      version: row.version,
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      createTime: formatCreateTimeIso(row.createdAt),
      permissions: row.menus.map((m) => m.menuId),
    };
    if (row.remark) item.remark = row.remark;
    return item;
  }

  private async requireRole(id: string, db: Prisma.TransactionClient) {
    const row = await db.role.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Role not found');
    return row;
  }

  private async validateMenuIds(ids: string[], db: Prisma.TransactionClient): Promise<string[]> {
    const unique = [...new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean))];
    if (unique.length === 0) return [];
    const menus = await db.menu.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, type: true },
    });
    assertRouteAncestors(menus, unique);
    return unique;
  }
}
