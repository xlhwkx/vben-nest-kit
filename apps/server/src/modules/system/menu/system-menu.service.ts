import { assertAffectedRoleRoutes } from '../../../common/authorization/menu-ancestors';
import { validateMenuMeta } from '../../../common/validation/menu-meta';
import { assertEditClaim, parseEditVersion } from '../../../common/validation/edit-version';
import { authorizationMutation } from '../../../common/authorization/authorization-mutation';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  assertGrantableCodes,
  assertGrantableMenus,
} from '../../../common/authorization/permission-codes';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const MENU_TYPES = ['catalog', 'menu', 'button', 'embedded', 'link'] as const;
export type MenuType = (typeof MENU_TYPES)[number];

export type SystemMenuNode = {
  version: number;
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
  meta?: Record<string, unknown> | null;
};

export type SystemMenuUpdateInput = SystemMenuInput & { version: number };

type MenuRow = {
  version: number;
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
  if (!s || s === '0' || s === 'null' || s === 'undefined') return null;
  return s;
}

function metaOf(meta: unknown): Record<string, unknown> {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return {};
}

function toAdminNode(row: MenuRow): SystemMenuNode {
  const node: SystemMenuNode = {
    version: row.version,
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
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.buildAdminTree(rows);
  }

  async nameExists(
    name: string,
    id?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    if (!name?.trim()) return false;
    const row = await db.menu.findFirst({
      where: {
        name: name.trim(),
        deletedAt: null,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async pathExists(
    path: string,
    id?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    if (path === undefined || path === null) return false;
    const row = await db.menu.findFirst({
      where: {
        path: String(path),
        deletedAt: null,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  async create(input: SystemMenuInput, actor: AuthUser): Promise<SystemMenuNode> {
    return authorizationMutation(this.prisma, actor, 'System:Menu:Create', (tx) =>
      this.createAuthorized(input, actor.userId, tx),
    );
  }

  private async createAuthorized(
    input: SystemMenuInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<SystemMenuNode> {
    await assertGrantableCodes(db, actorId, input.authCode?.trim() ? [input.authCode.trim()] : []);
    this.assertType(input.type);
    const meta = validateMenuMeta(input.meta, input.type);
    const parentId = normalizePid(input.pid);
    if (parentId) {
      const parent = await this.requireActiveMenu(parentId, db);
      if (parent.type === 'button') throw new BadRequestException('A button cannot contain menus');
    }
    if (await this.nameExists(input.name, undefined, db)) {
      throw new ConflictException('Menu name already exists');
    }
    if (input.type !== 'button' && (await this.pathExists(input.path, undefined, db))) {
      throw new ConflictException('Menu path already exists');
    }

    const sortOrder = typeof input.meta?.order === 'number' ? input.meta.order : 0;

    const row = await db.menu.create({
      data: {
        parentId,
        name: input.name.trim(),
        path: input.path,
        type: input.type,
        status: input.status === 0 ? 0 : 1,
        authCode: input.authCode?.trim() || null,
        component: input.component?.trim() || null,
        redirect: input.redirect?.trim() || null,
        meta: meta as Prisma.InputJsonValue,
        sortOrder,
      },
    });
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.menu.create',
      module: 'system.menu',
      status: 200,
      detail: { id: row.id, name: row.name },
    });
    return toAdminNode(row);
  }

  async update(id: string, input: SystemMenuUpdateInput, actor: AuthUser): Promise<SystemMenuNode> {
    parseEditVersion(input.version);
    return authorizationMutation(this.prisma, actor, 'System:Menu:Update', (tx) =>
      this.updateAuthorized(id, input, actor.userId, tx),
    );
  }

  private async updateAuthorized(
    id: string,
    input: SystemMenuUpdateInput,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<SystemMenuNode> {
    await assertGrantableCodes(db, actorId, input.authCode?.trim() ? [input.authCode.trim()] : []);
    this.assertType(input.type);
    await assertGrantableMenus(db, actorId, { id });
    const existing = await this.requireActiveMenu(id, db);
    const meta = validateMenuMeta(
      input.meta === undefined ? existing.meta : input.meta,
      input.type,
    );
    const claim = await db.menu.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: { version: { increment: 1 } },
    });
    assertEditClaim(claim.count);
    const parentId = input.pid === undefined ? existing.parentId : normalizePid(input.pid);
    const descendantIds = await this.collectDescendantIds(id, db);
    if (input.type === 'button' && descendantIds.size > 0) {
      throw new BadRequestException('A button cannot contain menus');
    }

    if (parentId === id) {
      throw new BadRequestException('Menu cannot be its own parent');
    }
    if (parentId) {
      const parent = await this.requireActiveMenu(parentId, db);
      if (parent.type === 'button') throw new BadRequestException('A button cannot contain menus');
      if (descendantIds.has(parentId)) {
        throw new BadRequestException('Cannot move menu under its descendant');
      }
    }

    if (await this.nameExists(input.name, id, db)) {
      throw new ConflictException('Menu name already exists');
    }
    if (input.type !== 'button' && (await this.pathExists(input.path, id, db))) {
      throw new ConflictException('Menu path already exists');
    }

    // meta is replaced as one object; omitting it preserves both JSON and sorting.
    const sortOrder =
      input.meta === undefined
        ? existing.sortOrder
        : typeof input.meta?.order === 'number'
          ? input.meta.order
          : 0;

    const row = await db.menu.update({
      where: { id },
      data: {
        parentId,
        name: input.name.trim(),
        path: input.path,
        type: input.type,
        status: input.status,
        authCode: input.authCode === undefined ? undefined : input.authCode?.trim() || null,
        component: input.component === undefined ? undefined : input.component?.trim() || null,
        redirect: input.redirect === undefined ? undefined : input.redirect?.trim() || null,
        meta: input.meta === undefined ? undefined : (meta as Prisma.InputJsonValue),
        sortOrder,
      },
    });
    if (parentId !== existing.parentId || input.type !== existing.type) {
      await assertAffectedRoleRoutes(db, [id, ...descendantIds]);
    }
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.menu.update',
      module: 'system.menu',
      status: 200,
      detail: { id: row.id, name: row.name },
    });
    return toAdminNode(row);
  }

  /**
   * Soft-delete menu + descendants. Renames unique `name` so the slot can be reused.
   * RoleMenu rows stay (FK); GET /menu/all already filters deletedAt.
   */
  async remove(id: string, actor: AuthUser): Promise<{ id: string }> {
    return authorizationMutation(this.prisma, actor, 'System:Menu:Delete', (tx) =>
      this.removeAuthorized(id, actor.userId, tx),
    );
  }

  private async removeAuthorized(
    id: string,
    actorId: string,
    db: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    await this.requireActiveMenu(id, db);
    const ids = [id, ...[...(await this.collectDescendantIds(id, db))]];
    await assertGrantableMenus(db, actorId, { id: { in: ids } });
    const now = new Date();
    const stamp = now.getTime();
    await Promise.all(
      ids.map((menuId, index) => {
        const short = menuId.replaceAll('-', '').slice(0, 8);
        return db.menu.update({
          where: { id: menuId },
          data: {
            deletedAt: now,
            status: 0,
            name: `__deleted__${short}_${stamp}_${index}`,
          },
        });
      }),
    );
    await this.audit.recordInTransaction(db, {
      userId: actorId,
      action: 'system.menu.delete',
      module: 'system.menu',
      status: 200,
      detail: { id },
    });
    return { id };
  }

  private assertType(type: string): asserts type is MenuType {
    if (!(MENU_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`Invalid menu type (expected ${MENU_TYPES.join('|')})`);
    }
  }

  private async requireActiveMenu(
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<MenuRow> {
    const row = await db.menu.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Menu not found');
    }
    return row;
  }

  private async collectDescendantIds(
    rootId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Set<string>> {
    const all = await db.menu.findMany({
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
    while (stack.length > 0) {
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
