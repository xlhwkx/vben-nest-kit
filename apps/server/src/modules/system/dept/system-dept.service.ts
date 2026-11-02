import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";

export type SystemDeptNode = {
  id: string;
  /** Contract: 0 for root, else parent uuid */
  pid: string | number;
  name: string;
  status: number;
  createTime: string;
  remark?: string;
  children?: SystemDeptNode[];
};

export type SystemDeptInput = {
  name: string;
  pid?: string | number | null;
  status?: number;
  remark?: string | null;
};

type DeptRow = {
  id: string;
  parentId: string | null;
  name: string;
  status: number;
  remark: string | null;
  sortOrder: number;
  createdAt: Date;
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

/** Normalize contract pid: 0 / null / undefined / "" => null (root). */
function normalizePid(pid: string | number | null | undefined): string | null {
  if (pid === undefined || pid === null) return null;
  const s = String(pid).trim();
  if (!s || s === "0" || s === "null" || s === "undefined") return null;
  return s;
}

function toNode(row: DeptRow): SystemDeptNode {
  const node: SystemDeptNode = {
    id: row.id,
    pid: row.parentId ?? 0,
    name: row.name,
    status: row.status,
    createTime: formatCreateTime(row.createdAt),
  };
  if (row.remark) node.remark = row.remark;
  return node;
}

@Injectable()
export class SystemDeptService {
  constructor(private readonly prisma: PrismaService) {}

  /** Non-paginated admin tree (all non-deleted depts). */
  async list(): Promise<SystemDeptNode[]> {
    const rows = await this.prisma.dept.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    });
    return this.buildTree(rows);
  }

  async create(input: SystemDeptInput): Promise<SystemDeptNode> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException("name is required");

    const parentId = normalizePid(input.pid);
    if (parentId) {
      await this.requireActiveDept(parentId);
    }

    const row = await this.prisma.dept.create({
      data: {
        parentId,
        name,
        status: input.status === 0 ? 0 : 1,
        remark: input.remark?.trim() || null,
      },
    });
    return toNode(row);
  }

  async update(id: string, input: SystemDeptInput): Promise<SystemDeptNode> {
    const existing = await this.requireActiveDept(id);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException("name is required");

    const parentId = normalizePid(input.pid);
    if (parentId === id) {
      throw new BadRequestException("Dept cannot be its own parent");
    }
    if (parentId) {
      await this.requireActiveDept(parentId);
      const descendantIds = await this.collectDescendantIds(id);
      if (descendantIds.has(parentId)) {
        throw new BadRequestException("Cannot move dept under its descendant");
      }
    }

    const row = await this.prisma.dept.update({
      where: { id },
      data: {
        parentId,
        name,
        status: input.status === 0 || input.status === 1 ? input.status : existing.status,
        remark:
          input.remark === undefined
            ? existing.remark
            : input.remark?.trim() || null,
      },
    });
    return toNode(row);
  }

  /**
   * Soft-delete one dept. Refuse when active children exist or users still reference it.
   */
  async remove(id: string): Promise<{ id: string }> {
    await this.requireActiveDept(id);

    const childCount = await this.prisma.dept.count({
      where: { parentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new ConflictException("Dept has child departments; remove children first");
    }

    const userCount = await this.prisma.user.count({
      where: { deptId: id, deletedAt: null },
    });
    if (userCount > 0) {
      throw new ConflictException("Dept still has users assigned; reassign first");
    }

    const now = new Date();
    await this.prisma.dept.update({
      where: { id },
      data: { deletedAt: now, status: 0 },
    });
    return { id };
  }

  /** Ensure dept exists and is not soft-deleted (for User.deptId etc.). */
  async assertActiveDeptId(deptId: string): Promise<void> {
    await this.requireActiveDept(deptId);
  }

  private async requireActiveDept(id: string): Promise<DeptRow> {
    const row = await this.prisma.dept.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException("Dept not found");
    }
    return row;
  }

  private async collectDescendantIds(rootId: string): Promise<Set<string>> {
    const all = await this.prisma.dept.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const children = new Map<string, string[]>();
    for (const row of all) {
      if (!row.parentId) continue;
      const list = children.get(row.parentId) ?? [];
      list.push(row.id);
      children.set(row.parentId, list);
    }
    const out = new Set<string>();
    const stack = [...(children.get(rootId) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
    return out;
  }

  private buildTree(rows: DeptRow[]): SystemDeptNode[] {
    const byId = new Map<string, DeptRow>();
    for (const row of rows) byId.set(row.id, row);

    const childrenMap = new Map<string | null, DeptRow[]>();
    for (const row of rows) {
      if (row.parentId && !byId.has(row.parentId)) {
        const list = childrenMap.get(null) ?? [];
        list.push(row);
        childrenMap.set(null, list);
        continue;
      }
      const key = row.parentId;
      const list = childrenMap.get(key) ?? [];
      list.push(row);
      childrenMap.set(key, list);
    }

    const toTreeNode = (row: DeptRow): SystemDeptNode => {
      const kids = childrenMap.get(row.id) ?? [];
      const node = toNode(row);
      if (kids.length > 0) {
        node.children = kids.map(toTreeNode);
      }
      return node;
    };

    return (childrenMap.get(null) ?? []).map(toTreeNode);
  }
}
