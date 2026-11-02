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

async function main() {
  console.log("Seeding qingzhan demo users/roles/permissions…");

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

    console.log(`  ✓ ${demo.username} / ${demo.password} → role=${demo.roleCode}`);
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

