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
import { formatCreateTimeIso } from '../../../common/format-create-time';

const DICT_VERSION_KEY = 'qingzhan:dict:version';

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

function parsePage(v: number | string | undefined, fallback: number): number {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

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

@Injectable()
export class SystemDictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async getVersion(): Promise<number> {
    // Redis down: never return a sticky `1` (would freeze frontend dict cache).
    const reachable = await this.redis.ping();
    if (!reachable) {
      return Date.now();
    }
    const raw = await this.redis.get(DICT_VERSION_KEY);
    const n = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(n) && n >= 1) return n;
    await this.redis.set(DICT_VERSION_KEY, '1', 60 * 60 * 24 * 365);
    return 1;
  }

  private async bumpVersion(): Promise<void> {
    const next = await this.redis.incr(DICT_VERSION_KEY);
    if (next <= 0) {
      await this.redis.set(DICT_VERSION_KEY, '1', 60 * 60 * 24 * 365);
    }
  }

  async getAllEnabled(): Promise<
    Record<string, { label: string; value: string | number; color?: string }[]>
  > {
    const types = await this.prisma.dictType.findMany({
      where: { status: 1 },
      orderBy: [{ code: 'asc' }],
    });
    const result: Record<string, { label: string; value: string | number; color?: string }[]> = {};
    for (const t of types) {
      result[t.code] = await this.getEnabledByCode(t.code);
    }
    return result;
  }

  async getEnabledByCode(
    code: string,
  ): Promise<{ label: string; value: string | number; color?: string }[]> {
    if (!code?.trim()) return [];
    const rows = await this.prisma.dictItem.findMany({
      where: { dictCode: code.trim(), status: 1 },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => {
      const item: { label: string; value: string | number; color?: string } = {
        label: row.label,
        value: asDictValue(row.value),
      };
      if (row.color) item.color = row.color;
      return item;
    });
  }

  async listTypes(query: DictTypeListQuery): Promise<{ items: DictTypeItem[]; total: number }> {
    const page = parsePage(query.page, 1);
    let pageSize = parsePage(query.pageSize, 20);
    if (pageSize > 100) pageSize = 100;

    const where: Prisma.DictTypeWhereInput = {};
    if (query.name?.trim()) {
      where.name = { contains: query.name.trim(), mode: 'insensitive' };
    }
    if (query.code?.trim()) {
      where.code = { contains: query.code.trim(), mode: 'insensitive' };
    }
    if (query.status === 0 || query.status === '0' || query.status === 1 || query.status === '1') {
      where.status = Number(query.status);
    }

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

  async createType(input: DictTypeInput): Promise<DictTypeItem> {
    const name = input.name?.trim();
    const code = input.code?.trim();
    if (!name) throw new BadRequestException('name is required');
    if (!code) throw new BadRequestException('code is required');

    const dup = await this.prisma.dictType.findUnique({ where: { code } });
    if (dup) throw new ConflictException('Dict code already exists');

    try {
      const row = await this.prisma.dictType.create({
        data: {
          name,
          code,
          status: input.status === 0 ? 0 : 1,
          remark: input.remark?.trim() || null,
        },
      });
      await this.bumpVersion();
      this.audit.record({
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

  async updateType(id: string, input: DictTypeInput): Promise<DictTypeItem> {
    const existing = await this.requireType(id);

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
        const dup = await this.prisma.dictType.findUnique({ where: { code } });
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
      const row = await this.prisma.dictType.update({
        where: { id },
        data,
      });
      await this.bumpVersion();
      this.audit.record({
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

  async deleteType(id: string): Promise<null> {
    await this.requireType(id);
    await this.prisma.dictType.delete({ where: { id } });
    await this.bumpVersion();
    this.audit.record({
      action: 'system.dict.delete',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'type', id },
    });
    return null;
  }

  async listData(query: DictDataListQuery): Promise<{ items: DictDataItem[]; total: number }> {
    if (!query.dictCode?.trim()) {
      throw new BadRequestException('dictCode is required');
    }
    const dictCode = query.dictCode.trim();
    const page = parsePage(query.page, 1);
    let pageSize = parsePage(query.pageSize, 20);
    if (pageSize > 100) pageSize = 100;

    const where: Prisma.DictItemWhereInput = { dictCode };
    if (query.label?.trim()) {
      where.label = { contains: query.label.trim(), mode: 'insensitive' };
    }
    if (query.status === 0 || query.status === '0' || query.status === 1 || query.status === '1') {
      where.status = Number(query.status);
    }

    const total = await this.prisma.dictItem.count({ where });
    const rows = await this.prisma.dictItem.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((row) => toDataItem(row)), total };
  }

  async createData(input: DictDataInput): Promise<DictDataItem> {
    const dictCode = input.dictCode?.trim();
    const label = input.label?.trim();
    if (!dictCode) throw new BadRequestException('dictCode is required');
    if (!label) throw new BadRequestException('label is required');
    if (input.value === undefined || input.value === null) {
      throw new BadRequestException('value is required');
    }
    await this.requireTypeByCode(dictCode);

    const row = await this.prisma.dictItem.create({
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
    await this.bumpVersion();
    this.audit.record({
      action: 'system.dict.create',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id: row.id, dictCode: row.dictCode },
    });
    return toDataItem(row);
  }

  async updateData(id: string, input: DictDataInput): Promise<DictDataItem> {
    const existing = await this.requireData(id);
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

    const row = await this.prisma.dictItem.update({
      where: { id },
      data,
    });
    await this.bumpVersion();
    this.audit.record({
      action: 'system.dict.update',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id: row.id, dictCode: row.dictCode },
    });
    return toDataItem(row);
  }

  async deleteData(id: string): Promise<null> {
    await this.requireData(id);
    await this.prisma.dictItem.delete({ where: { id } });
    await this.bumpVersion();
    this.audit.record({
      action: 'system.dict.delete',
      module: 'system.dict',
      status: 200,
      detail: { kind: 'data', id },
    });
    return null;
  }

  private async requireType(id: string) {
    const row = await this.prisma.dictType.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dict type not found');
    return row;
  }

  private async requireTypeByCode(code: string) {
    const row = await this.prisma.dictType.findUnique({ where: { code } });
    if (!row) throw new NotFoundException('Dict type not found');
    return row;
  }

  private async requireData(id: string) {
    const row = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Dict data not found');
    return row;
  }
}
