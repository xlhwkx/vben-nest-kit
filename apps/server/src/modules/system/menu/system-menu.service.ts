import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";

const MENU_TYPES = ["catalog", "menu", "button", "embedded", "link"] as const;
export type MenuType = (typeof MENU_TYPES)[number];

export type SystemMenuNode = {
  id: string;
  pid?: string;
  name: string;
  path: string;
  type: string;
  status: number;
  authCode?: string;
  component?: string;
  redirect?: string;
  meta: Record<string, unknown>;
  children?: SystemMenuNode[];
};

export type SystemMenuInput = {
  name: string;
  path: string;
  type: MenuType;
  pid?: string | null;
  status?: number;
  authCode?: string | null;
  component?: string | null;
  redirect?: string | null;
  meta?: Record<string, unknown>;
};

type MenuRow = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  component: string | null;
  redirect: string | null;
  type: string;
  status: number;
  authCode: string | null;
  meta: unknown;
  sortOrder: number;
};

function normalizePid(pid: string | null | undefined): string | null {
  if (pid === undefined || pid === null) return null;
  const s = String(pid).trim();
  if (!s || s === "0" || s === "null" || s === "undefined") return null;
  return s;
}

function metaOf(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return {};
}

function toAdminNode(row: MenuRow): SystemMenuNode {
  const node: SystemMenuNode = {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type,
    status: row.status,
    meta: metaOf(row.meta),
  };
  if (row.parentId) node.pid = row.parentId;
  if (row.authCode) node.authCode = row.authCode;
  if (row.component) node.component = row.component;
  if (row.redirect) node.redirect = row.redirect;
  return node;
}

@Injectable()
export class SystemMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Full admin tree (all non-deleted menus, including buttons). */
  async list(): Promise<SystemMenuNode[]> {
    const rows = await this.prisma.menu.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return this.buildAdminTree(rows);
  }

  async nameExists(name: string, id?: string): Promise<boolean> {
    if (!name?.trim()) return false;
    const row = await this.prisma.menu.findFirst({
      where: {
        name: name.trim(),
        deletedAt: null,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async pathExists(path: string, id?: string): Promise<boolean> {
    if (path === undefined || path === null) return false;
    const row = await this.prisma.menu.findFirst({
      where: {
        path: String(path),
        deletedAt: null,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async create(input: SystemMenuInput): Promise<SystemMenuNode> {
    this.assertType(input.type);
    const parentId = normalizePid(input.pid);
    if (parentId) {
      await this.requireActiveMenu(parentId);
    }
    if (await this.nameExists(input.name)) {
      throw new ConflictException("Menu name already exists");
    }
    if (await this.pathExists(input.path)) {
      throw new ConflictException("Menu path already exists");
    }

    const sortOrder =
      typeof input.meta?.order === "number" ? (input.meta.order as number) : 0;

    const row = await this.prisma.menu.create({
      data: {
        parentId,
        name: input.name.trim(),
        path: input.path,
        type: input.type,
        status: input.status === 0 ? 0 : 1,
        authCode: input.authCode?.trim() || null,
        component: input.component?.trim() || null,
        redirect: input.redirect?.trim() || null,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        sortOrder,
      },
    });
    this.audit.record({
      action: "system.menu.create",
      module: "system.menu",
      status: 200,
      detail: { id: row.id, name: row.name },
    });
    return toAdminNode(row);
  }

  async update(id: string, input: SystemMenuInput): Promise<SystemMenuNode> {
    this.assertType(input.type);
    const existing = await this.requireActiveMenu(id);
    const parentId = normalizePid(input.pid);

    if (parentId === id) {
      throw new BadRequestException("Menu cannot be its own parent");
    }
    if (parentId) {
      await this.requireActiveMenu(parentId);
      const descendantIds = await this.collectDescendantIds(id);
      if (descendantIds.has(parentId)) {
        throw new BadRequestException("Cannot move menu under its descendant");
      }
    }

    if (await this.nameExists(input.name, id)) {
      throw new ConflictException("Menu name already exists");
    }
    if (await this.pathExists(input.path, id)) {
      throw new ConflictException("Menu path already exists");
    }

    const sortOrder =
      typeof input.meta?.order === "number"
        ? (input.meta.order as number)
        : existing.sortOrder;

    const row = await this.prisma.menu.update({
      where: { id },
      data: {
        parentId,
        name: input.name.trim(),
        path: input.path,
        type: input.type,
        status: input.status === 0 ? 0 : 1,
        authCode: input.authCode?.trim() || null,
        component: input.component?.trim() || null,
        redirect: input.redirect?.trim() || null,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        sortOrder,
      },
    });
    this.audit.record({
      action: "system.menu.update",
      module: "system.menu",
      status: 200,
      detail: { id: row.id, name: row.name },
    });
    return toAdminNode(row);
  }

  /**
   * Soft-delete menu + descendants. Renames unique `name` so the slot can be reused.
   * RoleMenu rows stay (FK); GET /menu/all already filters deletedAt.
   */
  async remove(id: string): Promise<{ id: string }> {
    await this.requireActiveMenu(id);
    const ids = [id, ...[...(await this.collectDescendantIds(id))]];
    const now = new Date();
    const stamp = now.getTime();
    await this.prisma.$transaction(
      ids.map((menuId, index) => {
        const short = menuId.replace(/-/g, "").slice(0, 8);
        return this.prisma.menu.update({
          where: { id: menuId },
          data: {
            deletedAt: now,
            status: 0,
            name: `__deleted__${short}_${stamp}_${index}`,
          },
        });
      }),
    );
    this.audit.record({
      action: "system.menu.delete",
      module: "system.menu",
      status: 200,
      detail: { id },
    });
    return { id };
  }

  private assertType(type: string): asserts type is MenuType {
    if (!(MENU_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(
        `Invalid menu type (expected ${MENU_TYPES.join("|")})`,
      );
    }
  }

  private async requireActiveMenu(id: string): Promise<MenuRow> {
    const row = await this.prisma.menu.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException("Menu not found");
    }
    return row;
  }

  private async collectDescendantIds(rootId: string): Promise<Set<string>> {
    const all = await this.prisma.menu.findMany({
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

  private buildAdminTree(rows: MenuRow[]): SystemMenuNode[] {
    const byId = new Map<string, MenuRow>();
    for (const row of rows) byId.set(row.id, row);

    const childrenMap = new Map<string | null, MenuRow[]>();
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

    const toNode = (row: MenuRow): SystemMenuNode => {
      const kids = childrenMap.get(row.id) ?? [];
      const node = toAdminNode(row);
      if (kids.length > 0) {
        node.children = kids.map(toNode);
      }
      return node;
    };

    return (childrenMap.get(null) ?? []).map(toNode);
  }
}
