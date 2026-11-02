import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/** Minimal backend menus for accessMode=backend (P0). Full Menu CRUD = next slice. */
const DASHBOARD = {
  meta: { order: -1, title: "page.dashboard.title" },
  name: "Dashboard",
  path: "/dashboard",
  redirect: "/dashboard/analytics",
  children: [
    {
      name: "Analytics",
      path: "analytics",
      component: "/dashboard/analytics/index",
      meta: { affixTab: true, title: "page.dashboard.analytics" },
    },
    {
      name: "Workspace",
      path: "workspace",
      component: "/dashboard/workspace/index",
      meta: { title: "page.dashboard.workspace" },
    },
  ],
};

function demosForRole(role: string) {
  const map: Record<string, object> = {
    super: {
      component: "/demos/access/super-visible",
      meta: {
        icon: "mdi:button-cursor",
        title: "demos.access.superVisible",
      },
      name: "AccessSuperVisibleDemo",
      path: "super-visible",
    },
    admin: {
      component: "/demos/access/admin-visible",
      meta: {
        icon: "mdi:button-cursor",
        title: "demos.access.adminVisible",
      },
      name: "AccessAdminVisibleDemo",
      path: "admin-visible",
    },
    user: {
      component: "/demos/access/user-visible",
      meta: {
        icon: "mdi:button-cursor",
        title: "demos.access.userVisible",
      },
      name: "AccessUserVisibleDemo",
      path: "user-visible",
    },
  };
  const child = map[role];
  if (!child) return null;
  return {
    meta: { icon: "ic:baseline-view-in-ar", order: 1000, title: "demos.title" },
    name: "Demos",
    path: "/demos",
    redirect: `/demos/access/${role}-visible`,
    children: [
      {
        meta: { title: "demos.access.frontend.title" },
        name: "AccessDemos",
        path: "access",
        children: [child],
      },
    ],
  };
}

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllForUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 1 },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new UnauthorizedException("Unauthorized");
    }
    const roles = user.roles.map((r) => r.role.code);
    const menus: object[] = [DASHBOARD];
    // Prefer primary demo role: super > admin > user
    const primary =
      roles.find((r) => r === "super") ??
      roles.find((r) => r === "admin") ??
      roles.find((r) => r === "user");
    if (primary) {
      const demo = demosForRole(primary);
      if (demo) menus.push(demo);
    }
    return menus;
  }
}
