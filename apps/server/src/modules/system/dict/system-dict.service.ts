import { authorizationMutation } from '../../../common/authorization/authorization-mutation';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  listQuerySchema,
  withListOffsetLimit,
  listOffsetError,
} from '../../../common/validation/list-query';
import {
  parseQuery,
  optionalQueryText,
  optionalQueryEnum,
  requiredText,
} from '../../../common/validation/request-validation';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { formatCreateTimeIso } from '../../../common/format-create-time';

export type DictTypeItem = {
  id: string;
  name: string;
  code: string;
  status: number;
  remark?: string;
  createTime: string;
};

export type DictDataItem = {
  id: string;
  dictCode: string;
  label: string;
  value: string | number;
  sort: number;
  status: number;
  color?: string;
  remark?: string;
  createTime: string;
};

export type DictTypeInput = {
  name?: string;
  code?: string;
  remark?: string | null;
  status?: number;
};

export type DictDataInput = {
  dictCode?: string;
  label?: string;
  value?: string | number;
  color?: string | null;
  remark?: string | null;
  sort?: number;
  status?: number;
};

export type DictTypeListQuery = {
  page?: number | string;
  pageSize?: number | string;
  name?: string;
  code?: string;
  status?: string | number;
};

export type DictDataListQuery = {
  page?: number | string;
  pageSize?: number | string;
  dictCode?: string;
  label?: string;
  status?: string | number;
};

function asDictValue(v: Prisma.JsonValue): string | number {
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return '';
  return JSON.stringify(v);
}

function toTypeItem(row: {
  id: string;
  name: string;
  code: string;
  status: number;
  remark: string | null;
  createdAt: Date;
}): DictTypeItem {
  const item: DictTypeItem = {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    createTime: formatCreateTimeIso(row.createdAt),
  };
  if (row.remark) item.remark = row.remark;
  return item;
}

function toDataItem(row: {
  id: string;
  dictCode: string;
  label: string;
  value: Prisma.JsonValue;
  sort: number;
  status: number;
  color: string | null;
  remark: string | null;
  createdAt: Date;
}): DictDataItem {
  const item: DictDataItem = {
    id: row.id,
    dictCode: row.dictCode,
    label: row.label,
    value: asDictValue(row.value),
    sort: row.sort,
    status: row.status,
    createTime: formatCreateTimeIso(row.createdAt),
  };
  if (row.color) item.color = row.color;
  if (row.remark) item.remark = row.remark;
  return item;
}

function isP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const dictTypeListSchema = listQuerySchema
  .extend({
    name: optionalQueryText(128),
    code: optionalQueryText(64),
    status: optionalQueryEnum([0, 1]),
  })
  .refine(withListOffsetLimit, listOffsetError);

const dictDataListSchema = listQuerySchema
  .extend({
    label: optionalQueryText(128),
    dictCode: requiredText(64),
    status: optionalQueryEnum([0, 1]),
  })
  .refine(withListOffsetLimit, listOffsetError);

type DictOption = { label: string; value: string | number; color?: string };

function toOption(row: {
  label: string;
  value: Prisma.JsonValue;
  color: string | null;
}): DictOption {
  return {
    label: row.label,
    value: asDictValue(row.value),
    ...(row.color ? { color: row.color } : {}),
  };
}

@Injectable()
export class SystemDictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getVersion(): Promise<number> {
    const state = await this.prisma.dictionaryRevision.findUniqueOrThrow({
      where: { id: 1 },
    });
    return Number(state.version);
  }

  async getAllEnabled(): Promise<Record<string, DictOption[]>> {
    return this.prisma.$transaction(
      async (tx) => {
        const types = await tx.dictType.findMany({
          where: { status: 1 },
          orderBy: [{ code: 'asc' }],
          select: { code: true },
        });
        const items = await tx.dictItem.findMany({
          where: { status: 1, type: { status: 1 } },
          orderBy: [{ dictCode: 'asc' }, { sort: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { dictCode: true, label: true, value: true, color: true },
        });
        const result = new Map<string, DictOption[]>(types.map((type) => [type.code, []]));
        for (const item of items) result.get(item.dictCode)?.push(toOption(item));
        // Own data properties also preserve codes such as "__proto__".
        return Object.fromEntries(result);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getEnabledByCode(code: string): Promise<DictOption[]> {
    if (!code?.trim()) return [];
    const rows = await this.prisma.dictItem.findMany({
      where: { dictCode: code.trim(), status: 1, type: { status: 1 } },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toOption);
  }

  async listTypes(rawQuery: DictTypeListQuery): Promise<{ items: DictTypeItem[]; total: number }> {
    const query = parseQuery(dictTypeListSchema, rawQuery);
    const { page, pageSize } = query;

    const where: Prisma.DictTypeWhereInput = {};
    if (query.name?.trim()) {
      where.name = { contains: query.name.trim(), mode: 'insensitive' };
    }
    if (query.code?.trim()) {
      where.code = { contains: query.code.trim(), mode: 'insensitive' };
    }
    if (query.status !== undefined) where.status = query.status;

    const total = await this.prisma.dictType.count({ where });
    const rows = await this.prisma.dictType.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((row) => toTypeItem(row)), total };
  }

  async codeExists(code?: string, id?: string): Promise<boolean> {
    if (!code?.trim()) return false;
    const row = await this.prisma.dictType.findUnique({
      where: { code: code.trim() },
    });
    if (!row) return false;
    if (id?.trim() && row.id === id.trim()) return false;
    return true;
  }

  async createType(input: DictTypeInput, actor: AuthUser): Promise<DictTypeItem> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Create', (tx) =>
      this.createTypeAuthorized(input, actor.userId, tx),
    );
  }

  private async createTypeAuthorized(
    input: DictTypeInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<DictTypeItem> {
    const name = input.name?.trim();
    const code = input.code?.trim();
    if (!name) throw new BadRequestException('name is required');
    if (!code) throw new BadRequestException('code is required');

    const dup = await db.dictType.findUnique({ where: { code } });
    if (dup) throw new ConflictException('Dict code already exists');

    try {
      const row = await db.dictType.create({
        data: {
          name,
          code,
          status: input.status === 0 ? 0 : 1,
          remark: input.remark?.trim() || null,
        },
      });
      await this.audit.recordInTransaction(db, {
        userId: actorId,
        action: 'system.dict.create',
        module: 'system.dict',
        status: 200,
        detail: { kind: 'type', id: row.id, code: row.code },
      });
      return toTypeItem(row);
    } catch (error) {
      if (isP2002(error)) throw new ConflictException('Dict code already exists');
      throw error;
    }
  }

  async updateType(id: string, input: DictTypeInput, actor: AuthUser): Promise<DictTypeItem> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Update', (tx) =>
      this.updateTypeAuthorized(id, input, actor.userId, tx),
    );
  }

  private async updateTypeAuthorized(
    id: string,
    input: DictTypeInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<DictTypeItem> {
    const existing = await this.requireType(id, db);

    const data: Prisma.DictTypeUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name?.trim();
      if (!name) throw new BadRequestException('name is required');
      data.name = name;
    }
    if (input.code !== undefined) {
      const code = input.code?.trim();
      if (!code) throw new BadRequestException('code is required');
      if (code !== existing.code) {
        const dup = await db.dictType.findUnique({ where: { code } });
        if (dup) throw new ConflictException('Dict code already exists');
        data.code = code;
      }
    }
    if (input.status === 0 || input.status === 1) {
      data.status = input.status;
    }
    if (input.remark !== undefined) {
      data.remark = input.remark?.trim() || null;
    }

    try {
      const row = await db.dictType.update({
        where: { id },
        data,
      });
      await this.audit.recordInTransaction(db, {
        userId: actorId,
        action: 'system.dict.update',
        module: 'system.dict',
        status: 200,
        detail: { kind: 'type', id: row.id, code: row.code },
      });
      return toTypeItem(row);
    } catch (error) {
      if (isP2002(error)) throw new ConflictException('Dict code already exists');
      throw error;
    }
  }

  async deleteType(id: string, actor: AuthUser): Promise<null> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Delete', (tx) =>
      this.deleteTypeAuthorized(id, actor.userId, tx),
    );
  }

  private async deleteTypeAuthorized(
    id: string,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<null> {
    await this.requireType(id, db);
    await db.dictType.delete({ where: { id } });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.dict.delete',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'type', id },
    });
    return null;
  }

  async listData(rawQuery: DictDataListQuery): Promise<{ items: DictDataItem[]; total: number }> {
    const query = parseQuery(dictDataListSchema, rawQuery);
    if (!query.dictCode?.trim()) {
      throw new BadRequestException('dictCode is required');
    }
    const dictCode = query.dictCode.trim();
    const { page, pageSize } = query;

    const where: Prisma.DictItemWhereInput = { dictCode };
    if (query.label?.trim()) {
      where.label = { contains: query.label.trim(), mode: 'insensitive' };
    }
    if (query.status !== undefined) where.status = query.status;

    const total = await this.prisma.dictItem.count({ where });
    const rows = await this.prisma.dictItem.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((row) => toDataItem(row)), total };
  }

  async createData(input: DictDataInput, actor: AuthUser): Promise<DictDataItem> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Create', (tx) =>
      this.createDataAuthorized(input, actor.userId, tx),
    );
  }

  private async createDataAuthorized(
    input: DictDataInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<DictDataItem> {
    const dictCode = input.dictCode?.trim();
    const label = input.label?.trim();
    if (!dictCode) throw new BadRequestException('dictCode is required');
    if (!label) throw new BadRequestException('label is required');
    if (input.value === undefined || input.value === null) {
      throw new BadRequestException('value is required');
    }
    await this.requireTypeByCode(dictCode, db);

    const row = await db.dictItem.create({
      data: {
        dictCode,
        label,
        value: input.value,
        sort: typeof input.sort === 'number' ? input.sort : 0,
        status: input.status === 0 ? 0 : 1,
        color: input.color?.trim() || null,
        remark: input.remark?.trim() || null,
      },
    });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.dict.create',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id: row.id, dictCode: row.dictCode },
    });
    return toDataItem(row);
  }

  async updateData(id: string, input: DictDataInput, actor: AuthUser): Promise<DictDataItem> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Update', (tx) =>
      this.updateDataAuthorized(id, input, actor.userId, tx),
    );
  }

  private async updateDataAuthorized(
    id: string,
    input: DictDataInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<DictDataItem> {
    const existing = await this.requireData(id, db);
    if (input.dictCode !== undefined && input.dictCode.trim() !== existing.dictCode) {
      throw new BadRequestException(
        'dictCode cannot be changed; create an item in the target dictionary',
      );
    }
    const data: Prisma.DictItemUpdateInput = {};

    if (input.label !== undefined) {
      const label = input.label?.trim();
      if (!label) throw new BadRequestException('label is required');
      data.label = label;
    }
    if (input.value !== undefined && input.value !== null) {
      data.value = input.value;
    }
    if (input.sort !== undefined) {
      data.sort = Number.isFinite(Number(input.sort)) ? Number(input.sort) : existing.sort;
    }
    if (input.status === 0 || input.status === 1) {
      data.status = input.status;
    }
    if (input.color !== undefined) {
      data.color = input.color?.trim() || null;
    }
    if (input.remark !== undefined) {
      data.remark = input.remark?.trim() || null;
    }

    const row = await db.dictItem.update({
      where: { id },
      data,
    });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.dict.update',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id: row.id, dictCode: row.dictCode },
    });
    return toDataItem(row);
  }

  async deleteData(id: string, actor: AuthUser): Promise<null> {
    return authorizationMutation(this.prisma, actor, 'System:Dict:Delete', (tx) =>
      this.deleteDataAuthorized(id, actor.userId, tx),
    );
  }

  private async deleteDataAuthorized(
    id: string,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<null> {
    await this.requireData(id, db);
    await db.dictItem.delete({ where: { id } });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.dict.delete',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id },
    });
    return null;
  }

  private async requireType(id: string, db: Prisma.TransactionClient) {
    const row = await db.dictType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dict type not found');
    return row;
  }

  private async requireTypeByCode(code: string, db: Prisma.TransactionClient) {
    const row = await db.dictType.findUnique({ where: { code } });
    if (!row) throw new NotFoundException('Dict type not found');
    return row;
  }

  private async requireData(id: string, db: Prisma.TransactionClient) {
    const row = await db.dictItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dict data not found');
    return row;
  }
}
