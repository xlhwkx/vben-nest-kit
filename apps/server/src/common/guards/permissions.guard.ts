import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { readPermissionCodes } from '../authorization/permission-codes';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user?.userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    const codes = await readPermissionCodes(this.prisma, user.userId);
    const ok = required.every((code) => codes.includes(code));
    if (!ok) {
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }
}
