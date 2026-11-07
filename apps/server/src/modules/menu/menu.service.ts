import { Injectable, UnauthorizedException } from '@nestjs/common';
import { safeMenuMeta } from '../../common/validation/menu-meta';
import { PrismaService } from '../../prisma/prisma.service';

/** Route node shape for GET /menu/all (api-contract-vben.md §4.6) */
export type MenuRouteNode = {
  name: string;
  path: string;
  component?: string;
  redirect?: string;
  meta?: Record<string, unknown>;
  children?: MenuRouteNode[];
};

type MenuRow = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  component: string | null;
  redirect: string | null;
  type: string;
  meta: unknown;
  sortOrder: number;
};

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build Vben RouteRecordStringComponent[] from DB menus linked to the
   * current user's roles. Pure DB — no hardcoded tree.
   */
  async getAllForUser(userId: string): Promise<MenuRouteNode[]> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 1 },
      include: {
        roles: { where: { role: { status: 1 } }, select: { roleId: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }
    const roleIds = user.roles.map((r) => r.roleId);
    if (roleIds.length === 0) {
      return [];
    }

    const links = await this.prisma.roleMenu.findMany({
      where: { roleId: { in: roleIds } },
      select: { menuId: true },
    });
    const allowedIds = new Set(links.map((l) => l.menuId));
    if (allowedIds.size === 0) {
      return [];
    }

    const rows = await this.prisma.menu.findMany({
      where: {
        id: { in: [...allowedIds] },
        status: 1,
        deletedAt: null,
        // /menu/all is dynamic routes — buttons are access codes, not routes
        NOT: { type: 'button' },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return this.buildTree(rows);
  }

  private buildTree(rows: MenuRow[]): MenuRouteNode[] {
    const byId = new Map<string, MenuRow>();
    for (const row of rows) byId.set(row.id, row);

    const childrenMap = new Map<string | null, MenuRow[]>();
    for (const row of rows) {
      if (row.parentId && !byId.has(row.parentId)) {
        continue;
      }
      const key = row.parentId;
      const list = childrenMap.get(key) ?? [];
      list.push(row);
      childrenMap.set(key, list);
    }

    const toNode = (row: MenuRow): MenuRouteNode => {
      const kids = childrenMap.get(row.id) ?? [];
      const node: MenuRouteNode = {
        name: row.name,
        path: row.path,
        meta: safeMenuMeta(row.meta),
      };
      if (row.component) node.component = row.component;
      if (row.redirect) node.redirect = row.redirect;
      if (kids.length > 0) {
        node.children = kids.map(toNode);
      }
      return node;
    };

    const roots = childrenMap.get(null) ?? [];
    return roots.map(toNode);
  }
}
