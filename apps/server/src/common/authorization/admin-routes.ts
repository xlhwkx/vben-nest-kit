import type { Prisma } from '../../generated/prisma/client';

/** The supported Qingzhan frontend lives in playground/src/views/system. */
export const ADMIN_ROUTES = [
  {
    name: 'SystemUser',
    path: 'user',
    component: '/system/user/list',
    code: 'System:User:List',
    title: 'system.user.title',
    icon: 'mdi:user',
  },
  {
    name: 'SystemRole',
    path: 'role',
    component: '/system/role/list',
    code: 'System:Role:List',
    title: 'system.role.title',
    icon: 'mdi:account-group',
  },
  {
    name: 'SystemMenu',
    path: 'menu',
    component: '/system/menu/list',
    code: 'System:Menu:List',
    title: 'system.menu.title',
    icon: 'mdi:menu',
  },
  {
    name: 'SystemDept',
    path: 'dept',
    component: '/system/dept/list',
    code: 'System:Dept:List',
    title: 'system.dept.title',
    icon: 'charm:organisation',
  },
  {
    name: 'SystemDict',
    path: 'dict',
    component: '/system/dict/list',
    code: 'System:Dict:List',
    title: 'system.dict.title',
    icon: 'mdi:book-cog-outline',
  },
  {
    name: 'SystemDictData',
    path: 'dict/data/:code',
    component: '/system/dict/data',
    code: 'System:Dict:List',
    title: 'system.dict.dataTitle',
    icon: 'mdi:book-cog-outline',
  },
] as const;

/**
 * Provision only for an explicitly selected administrator role. Existing menu
 * definitions and grants are never overwritten. Conflicting topology fails closed.
 */
export async function provisionAdminRoutes(
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  // Match management API path uniqueness, including pre-existing custom names.
  const reservedPaths = ['/system', ...ADMIN_ROUTES.map((route) => route.path)];
  const reservedNames: string[] = ['System', ...ADMIN_ROUTES.map((route) => route.name)];
  const conflicting = await tx.menu.findFirst({
    where: {
      deletedAt: null,
      type: { not: 'button' },
      path: { in: reservedPaths },
      name: { notIn: reservedNames },
    },
  });
  if (conflicting)
    throw new Error('Existing custom menu uses a reserved admin path; review it manually');
  let root = await tx.menu.findUnique({ where: { name: 'System' } });
  if (!root)
    root = await tx.menu.create({
      data: {
        name: 'System',
        path: '/system',
        type: 'catalog',
        component: 'BasicLayout',
        redirect: '/system/user',
        sortOrder: 9997,
        meta: {
          title: 'system.title',
          icon: 'ion:settings-outline',
          order: 9997,
        },
      },
    });
  if (
    root.deletedAt ||
    root.status !== 1 ||
    root.parentId ||
    root.authCode ||
    root.path !== '/system' ||
    root.type !== 'catalog' ||
    root.component !== 'BasicLayout' ||
    root.redirect !== '/system/user'
  ) {
    throw new Error(
      'Existing System menu conflicts with the admin route catalog; review it manually',
    );
  }
  await tx.roleMenu.upsert({
    where: { roleId_menuId: { roleId, menuId: root.id } },
    update: {},
    create: { roleId, menuId: root.id },
  });
  for (const [sortOrder, route] of ADMIN_ROUTES.entries()) {
    let menu = await tx.menu.findUnique({ where: { name: route.name } });
    if (!menu)
      menu = await tx.menu.create({
        data: {
          name: route.name,
          parentId: root.id,
          path: route.path,
          type: 'menu',
          component: route.component,
          authCode: route.code,
          sortOrder,
          meta: {
            title: route.title,
            icon: route.icon,
            ...(route.name === 'SystemDictData'
              ? { hideInMenu: true, activePath: '/system/dict' }
              : {}),
          },
        },
      });
    if (
      menu.deletedAt ||
      menu.status !== 1 ||
      menu.parentId !== root.id ||
      menu.path !== route.path ||
      menu.component !== route.component ||
      menu.authCode !== route.code ||
      menu.type !== 'menu'
    ) {
      throw new Error(
        `Existing ${route.name} menu conflicts with the admin route catalog; review it manually`,
      );
    }
    await tx.roleMenu.upsert({
      where: { roleId_menuId: { roleId, menuId: menu.id } },
      update: {},
      create: { roleId, menuId: menu.id },
    });
  }
}
