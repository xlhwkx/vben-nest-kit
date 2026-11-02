import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { REQUIRE_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import type { AuthUser } from "../decorators/current-user.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";

const CODES_CACHE_TTL = 60;

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user?.userId) {
      throw new UnauthorizedException("Unauthorized");
    }

    const codes = await this.loadCodes(user.userId);
    const ok = required.every((code) => codes.includes(code));
    if (!ok) {
      throw new ForbiddenException("Forbidden");
    }
    return true;
  }

  private async loadCodes(userId: string): Promise<string[]> {
    const cacheKey = `perm:codes:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as string[];
      } catch {
        // fall through
      }
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: {
        role: {
          users: { some: { userId } },
          status: 1,
        },
      },
      include: { permission: true },
    });
    const codes = Array.from(
      new Set(rows.map((r) => r.permission.code)),
    ).sort();
    await this.redis.set(cacheKey, JSON.stringify(codes), CODES_CACHE_TTL);
    return codes;
  }
}
