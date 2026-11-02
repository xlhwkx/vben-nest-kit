import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getInfo(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 1 },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw new UnauthorizedException("Unauthorized");
    }
    return {
      id: user.id,
      userId: user.id,
      username: user.username,
      realName: user.realName,
      roles: user.roles.map((r) => r.role.code),
      homePath: user.homePath ?? "/dashboard/workspace",
      avatar: user.avatar ?? "",
      desc: "",
    };
  }
}
