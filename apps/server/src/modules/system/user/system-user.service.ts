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
import * as argon2 from 'argon2';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { parseListCreatedAtRange } from '../../../common/parse-list-time-range';
import { formatCreateTimeIso } from '../../../common/format-create-time';

export type SystemUserItem = {
  version: number;
  id: string;
  name: string;
  username: string;
  status: number;
  gender: number;
  createTime: string;
  roles: string[];
  deptId?: string;
  remark?: string;
  homePath?: string;
  avatar?: string;
};

export type SystemUserCreateInput = {
  username: string;
  password: string;
  name: string;
  status?: number;
  gender?: number;
  deptId?: string | null;
  remark?: string | null;
  homePath?: string | null;
  avatar?: string | null;
  /** Role ids; omit or [] allowed */
  roles?: string[];
};

export type SystemUserUpdateInput = {
  version: number;
  username?: string;
  password?: string;
  name?: string;
  status?: number;
  gender?: number;
  deptId?: string | null;
  remark?: string | null;
  homePath?: string | null;
  avatar?: string | null;
  /**
   * Role ids. Only replace UserRole when explicitly present (incl. []).
   * Omit must NOT clear bindings.
   */
  roles?: string[];
};

export type SystemUserListQuery = {
  page?: number | string;
  pageSize?: number | string;
  name?: string;
  id?: string;
  remark?: string;
  startTime?: string;
  endTime?: string;
  status?: string | number;
  deptId?: string;
  gender?: string | number;
};

const USERNAME_MAX = 64;

/** Soft-delete tombstone: release @unique so the same username can be recreated. */
function softDeletedUsername(username: string, id: string): string {
  const suffix = `__deleted_${id}`;
  const maxBase = Math.max(0, USERNAME_MAX - suffix.length);
  return `${username.slice(0, maxBase)}${suffix}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const userListSchema = listQuerySchema
  .extend({
    name: optionalQueryText(128),
    remark: optionalQueryText(512),
    startTime: optionalQueryText(64),
    endTime: optionalQueryText(64),
    id: optionalQueryId,
    deptId: optionalQueryId,
    status: optionalQueryEnum([0, 1]),
    gender: optionalQueryEnum([0, 1, 2]),
  })
  .refine(withListOffsetLimit, listOffsetError);

@Injectable()
export class SystemUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(rawQuery: SystemUserListQuery): Promise<{ items: SystemUserItem[]; total: number }> {
    const query = parseQuery(userListSchema, rawQuery);
    const { page, pageSize } = query;

    const where: Prisma.UserWhereInput = { deletedAt: null };

    if (query.name?.trim()) {
      const q = query.name.trim();
      where.OR = [
        { realName: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.id?.trim()) {
      where.id = query.id.trim();
    }
    if (query.remark?.trim()) {
      where.remark = { contains: query.remark.trim(), mode: 'insensitive' };
    }
    if (query.status !== undefined) where.status = query.status;
    if (query.deptId?.trim()) {
      where.deptId = query.deptId.trim();
    }
    if (query.gender !== undefined) where.gender = query.gender;
    const createdAt = parseListCreatedAtRange(query.startTime, query.endTime);
    if (createdAt) where.createdAt = createdAt;

    // The scalar revision and relation ids must come from the same DB snapshot.
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.user.count({ where });
        const rows = await tx.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { username: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            roles: { select: { roleId: true } },
          },
        });

        return { items: rows.map((row) => this.toItem(row)), total };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(input: SystemUserCreateInput, actor: AuthUser): Promise<SystemUserItem> {
    if (!input.password || input.password.length < 6 || input.password.length > 128)
      throw new BadRequestException('password must contain 6–128 characters');
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    return authorizationMutation(this.prisma, actor, 'System:User:Create', (tx) =>
      this.createAuthorized(input, actor.userId, tx, passwordHash),
    );
  }

  private async createAuthorized(
    input: SystemUserCreateInput,
    actorId: string,
    db: Prisma.TransactionClient,
    passwordHash: string,
  ): Promise<SystemUserItem> {
    const username = input.username?.trim();
    const name = input.name?.trim();
    const password = input.password ?? '';
    if (!username) throw new BadRequestException('username is required');
    if (!name) throw new BadRequestException('name is required');
    if (!password || password.length < 6) {
      throw new BadRequestException('password must be at least 6 characters');
    }
    if (username.length > USERNAME_MAX) {
      throw new BadRequestException(`username must be <= ${USERNAME_MAX} chars`);
    }

    const dup = await db.user.findFirst({
      where: { username, deletedAt: null },
    });
    if (dup) throw new ConflictException('Username already exists');

    if (input.roles !== undefined) await this.assertRolesGrantable(actorId, input.roles, db);
    const roleIds = await this.validateRoleIds(input.roles ?? [], db);
    const deptId = await this.validateDeptId(input.deptId, db);
    const gender = this.normalizeGender(input.gender);

    try {
      const user = await db.user.create({
        data: {
          username,
          passwordHash,
          realName: name,
          status: input.status === 0 ? 0 : 1,
          gender,
          remark: input.remark?.trim() || null,
          homePath: input.homePath?.trim() || null,
          avatar: input.avatar?.trim() || null,
          ...(deptId ? { dept: { connect: { id: deptId } } } : {}),
        },
      });
      if (roleIds.length > 0) {
        await db.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
          skipDuplicates: true,
        });
      }
      const row = await db.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: { select: { roleId: true } } },
      });
      await this.audit.recordInTransaction(db, {
        userId: actorId,
        action: 'system.user.create',
        module: 'system.user',
        status: 200,
        detail: { id: row.id, username: row.username },
      });
      return this.toItem(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }

  async update(id: string, input: SystemUserUpdateInput, actor: AuthUser): Promise<SystemUserItem> {
    parseEditVersion(input.version);
    if (
      input.password !== undefined &&
      (!input.password || input.password.length < 6 || input.password.length > 128)
    )
      throw new BadRequestException('password must contain 6–128 characters');
    const passwordHash =
      input.password === undefined
        ? undefined
        : await argon2.hash(input.password, { type: argon2.argon2id });
    return authorizationMutation(this.prisma, actor, 'System:User:Update', (tx) =>
      this.updateAuthorized(id, input, actor.userId, tx, passwordHash),
    );
  }

  private async updateAuthorized(
    id: string,
    input: SystemUserUpdateInput,
    actorId: string,
    db: Prisma.TransactionClient,
    passwordHash?: string,
  ): Promise<SystemUserItem> {
    await assertGrantableMenus(db, actorId, {
      roles: { some: { role: { users: { some: { userId: id } } } } },
    });
    const existing = await this.requireUser(id, db);
    const claim = await db.user.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: { version: { increment: 1 } },
    });
    assertEditClaim(claim.count);

    const data: Prisma.UserUpdateInput = {};
    let bumpToken = false;

    if (input.username !== undefined) {
      const username = input.username.trim();
      if (!username) throw new BadRequestException('username is required');
      if (username.length > USERNAME_MAX) {
        throw new BadRequestException(`username must be <= ${USERNAME_MAX} chars`);
      }
      if (username !== existing.username) {
        const dup = await db.user.findFirst({
          where: { username, deletedAt: null, NOT: { id } },
        });
        if (dup) throw new ConflictException('Username already exists');
        data.username = username;
      }
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('name is required');
      data.realName = name;
    }

    if ((input.status === 0 || input.status === 1) && input.status !== existing.status) {
      data.status = input.status;
      bumpToken = true;
    }

    if (input.gender !== undefined) {
      data.gender = this.normalizeGender(input.gender);
    }

    if (input.deptId !== undefined) {
      const nextDeptId = await this.validateDeptId(input.deptId, db);
      data.dept = nextDeptId ? { connect: { id: nextDeptId } } : { disconnect: true };
    }

    if (input.remark !== undefined) {
      data.remark = input.remark?.trim() || null;
    }

    if (input.homePath !== undefined) {
      data.homePath = input.homePath?.trim() || null;
    }

    if (input.avatar !== undefined) {
      data.avatar = input.avatar?.trim() || null;
    }

    if (input.password !== undefined) {
      if (!input.password || input.password.length < 6) {
        throw new BadRequestException('password must be at least 6 characters');
      }
      data.passwordHash = passwordHash;
      bumpToken = true;
    }

    if (input.roles !== undefined) await this.assertRolesGrantable(actorId, input.roles, db);
    const hasRolesField = input.roles !== undefined;
    const roleIds = hasRolesField ? await this.validateRoleIds(input.roles ?? [], db) : null;

    if (bumpToken) {
      data.tokenVersion = { increment: 1 };
    }

    try {
      if (Object.keys(data).length > 0) {
        await db.user.update({ where: { id }, data });
      }
      if (roleIds !== null) {
        await db.userRole.deleteMany({ where: { userId: id } });
        if (roleIds.length > 0) {
          await db.userRole.createMany({
            data: roleIds.map((roleId) => ({ userId: id, roleId })),
            skipDuplicates: true,
          });
        }
      }
      if (bumpToken) {
        await db.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const row = await db.user.findUniqueOrThrow({
        where: { id },
        include: { roles: { select: { roleId: true } } },
      });

      await this.audit.recordInTransaction(db, {
        userId: actorId,
        action: 'system.user.update',
        module: 'system.user',
        status: 200,
        detail: {
          id: row.id,
          username: row.username,
          fields: Object.keys(input).filter((k) => k !== 'password'),
        },
      });
      return this.toItem(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }

  async remove(id: string, actor: AuthUser): Promise<{ id: string }> {
    return authorizationMutation(this.prisma, actor, 'System:User:Delete', (tx) =>
      this.removeAuthorized(id, actor.userId, tx),
    );
  }

  private async removeAuthorized(
    id: string,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    await assertGrantableMenus(db, actorId, {
      roles: { some: { role: { users: { some: { userId: id } } } } },
    });
    const existing = await this.requireUser(id, db);
    const tombstone = softDeletedUsername(existing.username, id);

    await db.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 0,
        username: tombstone,
        tokenVersion: { increment: 1 },
      },
    });
    await db.userRole.deleteMany({ where: { userId: id } });
    await db.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.user.delete',
      module: 'system.user',
      status: 200,
      detail: { id, username: existing.username },
    });
    return { id };
  }

  private async assertRolesGrantable(
    actorId: string,
    roleIds: string[],
    db: Prisma.TransactionClient,
  ): Promise<void> {
    await assertGrantableMenus(
      db,
      actorId,
      { roles: { some: { roleId: { in: roleIds } } } },
      'System:User:AssignRole',
    );
  }

  private toItem(row: {
    version: number;
    id: string;
    username: string;
    realName: string;
    status: number;
    gender: number;
    deptId: string | null;
    remark: string | null;
    homePath: string | null;
    avatar: string | null;
    createdAt: Date;
    roles: { roleId: string }[];
  }): SystemUserItem {
    const item: SystemUserItem = {
      version: row.version,
      id: row.id,
      name: row.realName,
      username: row.username,
      status: row.status,
      gender: row.gender,
      createTime: formatCreateTimeIso(row.createdAt),
      roles: row.roles.map((r) => r.roleId),
    };
    if (row.deptId) item.deptId = row.deptId;
    if (row.remark) item.remark = row.remark;
    if (row.homePath) item.homePath = row.homePath;
    if (row.avatar) item.avatar = row.avatar;
    return item;
  }

  private async validateDeptId(
    deptId: string | null | undefined,
    db: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (deptId === undefined || deptId === null) return null;
    const id = String(deptId).trim();
    if (!id || id === '0') return null;
    const row = await db.dept.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new BadRequestException('deptId not found or deleted');
    }
    return row.id;
  }

  private async requireUser(id: string, db: Prisma.TransactionClient) {
    const row = await db.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  private normalizeGender(g: number | undefined): number {
    if (g === 0 || g === 1 || g === 2) return g;
    return 2;
  }

  private async validateRoleIds(ids: string[], db: Prisma.TransactionClient): Promise<string[]> {
    const unique = [...new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean))];
    if (unique.length === 0) return [];
    const found = await db.role.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('One or more role ids are invalid');
    }
    return unique;
  }
}
