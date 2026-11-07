import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

type MenuParent = { id: string; parentId: string | null; type: string };

/** Buttons can be independent API grants. Routes require explicit ancestor grants. */
export function assertRouteAncestors(menus: MenuParent[], selectedIds: string[]): void {
  const byId = new Map(menus.map((menu) => [menu.id, menu]));
  const selected = new Set(selectedIds);
  for (const id of selected) {
    let current = byId.get(id);
    if (!current) throw new BadRequestException('One or more menu ids are invalid');
    if (current.type === 'button') continue;
    const seen = new Set([id]);
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || parent.type === 'button' || seen.has(parent.id)) {
        throw new BadRequestException('Menu route ancestry is invalid');
      }
      if (!selected.has(parent.id)) {
        const message = '页面菜单必须显式选择全部祖先菜单（Select all route ancestors）';
        throw new BadRequestException({ message, error: message });
      }
      seen.add(parent.id);
      current = parent;
    }
  }
}

/** A topology change must not silently invalidate already saved role routes. */
export async function assertAffectedRoleRoutes(
  db: Prisma.TransactionClient,
  menuIds: string[],
): Promise<void> {
  const affected = await db.roleMenu.findMany({
    where: { menuId: { in: menuIds } },
    select: { roleId: true },
    distinct: ['roleId'],
  });
  if (affected.length === 0) return;
  const menus = await db.menu.findMany({
    where: { deletedAt: null },
    select: { id: true, parentId: true, type: true },
  });
  const links = await db.roleMenu.findMany({
    where: {
      roleId: { in: affected.map((link) => link.roleId) },
      menu: { deletedAt: null },
    },
    select: { roleId: true, menuId: true },
  });
  const grants = new Map<string, string[]>();
  for (const link of links) {
    const ids = grants.get(link.roleId) ?? [];
    ids.push(link.menuId);
    grants.set(link.roleId, ids);
  }
  for (const ids of grants.values()) assertRouteAncestors(menus, ids);
}
