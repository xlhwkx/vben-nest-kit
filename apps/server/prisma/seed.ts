import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

/** Demo accounts aligned with api-contract-vben.md §4.1 */
const DEMO_USERS = [
  {
    username: "vben",
    password: "123456",
    realName: "Vben",
    homePath: "/dashboard/workspace",
    roleCode: "super",
    codes: ["AC_100100", "AC_100110", "AC_100120", "AC_100010"],
  },
  {
    username: "admin",
    password: "123456",
    realName: "Admin",
    homePath: "/dashboard/workspace",
    roleCode: "admin",
    codes: ["AC_100010", "AC_100020", "AC_100030"],
  },
  {
    username: "jack",
    password: "123456",
    realName: "Jack",
    homePath: "/dashboard/analytics",
    roleCode: "user",
    codes: ["AC_1000001", "AC_1000002"],
  },
] as const;

type MenuSeed = {
  name: string;
  path: string;
  type: "catalog" | "menu" | "button" | "embedded" | "link";
  component?: string;
  redirect?: string;
  authCode?: string;
  meta?: Record<string, unknown>;
  sortOrder?: number;
  children?: MenuSeed[];
};

/** Route tree aligned with backend-mock MOCK_MENUS / createDemosMenus */
const MENU_TREE: MenuSeed[] = [
  {
    name: "Dashboard",
    path: "/dashboard",
    type: "catalog",
    redirect: "/dashboard/analytics",
    meta: { order: -1, title: "page.dashboard.title" },
    sortOrder: -1,
    children: [
      {
        name: "Analytics",
        path: "analytics",
        type: "menu",
        component: "/dashboard/analytics/index",
        meta: { affixTab: true, title: "page.dashboard.analytics" },
        sortOrder: 0,
      },
      {
        name: "Workspace",
        path: "workspace",
        type: "menu",
        component: "/dashboard/workspace/index",
        meta: { title: "page.dashboard.workspace" },
        sortOrder: 1,
      },
    ],
  },
  {
    name: "Demos",
    path: "/demos",
    type: "catalog",
    redirect: "/demos/access",
    meta: {
      icon: "ic:baseline-view-in-ar",
      keepAlive: true,
      order: 1000,
      title: "demos.title",
    },
    sortOrder: 1000,
    children: [
      {
        name: "AccessDemos",
        path: "access",
        type: "catalog",
        redirect: "/demos/access/page-control",
        meta: {
          icon: "mdi:cloud-key-outline",
          title: "demos.access.backendPermissions",
        },
        sortOrder: 0,
        children: [
          {
            name: "AccessPageControlDemo",
            path: "page-control",
            type: "menu",
            component: "/demos/access/index",
            meta: {
              icon: "mdi:page-previous-outline",
              title: "demos.access.pageAccess",
            },
            sortOrder: 0,
          },
          {
            name: "AccessButtonControlDemo",
            path: "button-control",
            type: "menu",
            component: "/demos/access/button-control",
            meta: {
              icon: "mdi:button-cursor",
              title: "demos.access.buttonControl",
            },
            sortOrder: 1,
          },
          {
            name: "AccessMenuVisible403Demo",
            path: "menu-visible-403",
            type: "menu",
            component: "/demos/access/menu-visible-403",
            meta: {
              authority: ["no-body"],
              icon: "mdi:button-cursor",
              menuVisibleWithForbidden: true,
              title: "demos.access.menuVisible403",
            },
            sortOrder: 2,
          },
          {
            name: "AccessSuperVisibleDemo",
            path: "super-visible",
            type: "menu",
            component: "/demos/access/super-visible",
            meta: {
              icon: "mdi:button-cursor",
              title: "demos.access.superVisible",
            },
            sortOrder: 3,
          },
          {
            name: "AccessAdminVisibleDemo",
            path: "admin-visible",
            type: "menu",
            component: "/demos/access/admin-visible",
            meta: {
              icon: "mdi:button-cursor",
              title: "demos.access.adminVisible",
            },
            sortOrder: 4,
          },
          {
            name: "AccessUserVisibleDemo",
            path: "user-visible",
            type: "menu",
            component: "/demos/access/user-visible",
            meta: {
              icon: "mdi:button-cursor",
              title: "demos.access.userVisible",
            },
            sortOrder: 5,
          },
        ],
      },
    ],
  },
];

/** System Menu write codes — granted to super/admin only (not user/jack) */
const MENU_WRITE_CODES = [
  "System:Menu:Create",
  "System:Menu:Update",
  "System:Menu:Delete",
] as const;

/** System Role write codes — granted to super/admin only (not user/jack) */
const ROLE_WRITE_CODES = [
  "System:Role:Create",
  "System:Role:Update",
  "System:Role:Delete",
] as const;

const SHARED_MENU_NAMES = new Set([
  "Dashboard",
  "Analytics",
  "Workspace",
  "Demos",
  "AccessDemos",
  "AccessPageControlDemo",
  "AccessButtonControlDemo",
  "AccessMenuVisible403Demo",
]);

const ROLE_EXTRA_MENUS: Record<string, string[]> = {
  super: ["AccessSuperVisibleDemo"],
  admin: ["AccessAdminVisibleDemo"],
  user: ["AccessUserVisibleDemo"],
};

async function upsertMenuTree(
  nodes: MenuSeed[],
  parentId: string | null,
  byName: Map<string, string>,
) {
  for (const node of nodes) {
    const existing = await prisma.menu.findUnique({ where: { name: node.name } });
    const data = {
      parentId,
      path: node.path,
      type: node.type,
      component: node.component ?? null,
      redirect: node.redirect ?? null,
      authCode: node.authCode ?? null,
      meta: node.meta ?? {},
      sortOrder: node.sortOrder ?? 0,
      status: 1,
      deletedAt: null,
    };
    const row = existing
      ? await prisma.menu.update({ where: { id: existing.id }, data })
      : await prisma.menu.create({ data: { name: node.name, ...data } });
    byName.set(node.name, row.id);
    if (node.children?.length) {
      await upsertMenuTree(node.children, row.id, byName);
    }
  }
}

async function main() {
  console.log("Seeding qingzhan demo users/roles/permissions/menus…");

  const roleIds = new Map<string, string>();

  for (const demo of DEMO_USERS) {
    const role = await prisma.role.upsert({
      where: { code: demo.roleCode },
      update: { name: demo.roleCode, status: 1 },
      create: {
        code: demo.roleCode,
        name: demo.roleCode,
        status: 1,
        remark: `seed role ${demo.roleCode}`,
      },
    });
    roleIds.set(demo.roleCode, role.id);

    for (const code of demo.codes) {
      const perm = await prisma.permission.upsert({
        where: { code },
        update: { name: code },
        create: { code, name: code },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }

    const passwordHash = await argon2.hash(demo.password, {
      type: argon2.argon2id,
    });

    const user = await prisma.user.upsert({
      where: { username: demo.username },
      update: {
        passwordHash,
        realName: demo.realName,
        homePath: demo.homePath,
        status: 1,
        deletedAt: null,
      },
      create: {
        username: demo.username,
        passwordHash,
        realName: demo.realName,
        homePath: demo.homePath,
        status: 1,
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: user.id, roleId: role.id },
      },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });

    console.log(`  ok ${demo.username} / ${demo.password} -> role=${demo.roleCode}`);
  }

  // Grant System Menu write permissions to super + admin only
  const menuWriteRoleCodes = ["super", "admin"] as const;
  for (const code of MENU_WRITE_CODES) {
    const perm = await prisma.permission.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
    for (const roleCode of menuWriteRoleCodes) {
      const roleId = roleIds.get(roleCode);
      if (!roleId) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId: perm.id },
        },
        update: {},
        create: { roleId, permissionId: perm.id },
      });
    }
    // Ensure user role does NOT have menu write codes
    const userRoleId = roleIds.get("user");
    if (userRoleId) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: userRoleId, permissionId: perm.id },
      });
    }
  }
  console.log(`  ok menu write perms for super/admin: ${MENU_WRITE_CODES.join(", ")}`);

  // Grant System Role write permissions to super + admin only
  const roleWriteRoleCodes = ["super", "admin"] as const;
  for (const code of ROLE_WRITE_CODES) {
    const perm = await prisma.permission.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
    for (const roleCode of roleWriteRoleCodes) {
      const roleId = roleIds.get(roleCode);
      if (!roleId) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId: perm.id },
        },
        update: {},
        create: { roleId, permissionId: perm.id },
      });
    }
    const userRoleId = roleIds.get("user");
    if (userRoleId) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: userRoleId, permissionId: perm.id },
      });
    }
  }
  console.log(`  ok role write perms for super/admin: ${ROLE_WRITE_CODES.join(", ")}`);


  const menuByName = new Map<string, string>();
  await upsertMenuTree(MENU_TREE, null, menuByName);
  console.log(`  ok menus upserted: ${menuByName.size}`);

  for (const [roleCode, roleId] of roleIds) {
    const names = new Set([
      ...SHARED_MENU_NAMES,
      ...(ROLE_EXTRA_MENUS[roleCode] ?? []),
    ]);
    for (const name of names) {
      const menuId = menuByName.get(name);
      if (!menuId) continue;
      await prisma.roleMenu.upsert({
        where: { roleId_menuId: { roleId, menuId } },
        update: {},
        create: { roleId, menuId },
      });
    }
    const allRoleLeaves = [
      "AccessSuperVisibleDemo",
      "AccessAdminVisibleDemo",
      "AccessUserVisibleDemo",
    ];
    for (const leaf of allRoleLeaves) {
      if (names.has(leaf)) continue;
      const menuId = menuByName.get(leaf);
      if (!menuId) continue;
      await prisma.roleMenu.deleteMany({ where: { roleId, menuId } });
    }
    console.log(`  ok role_menus for ${roleCode}: ${names.size} nodes`);
  }

  console.log("Seed done. Change default passwords before production.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });