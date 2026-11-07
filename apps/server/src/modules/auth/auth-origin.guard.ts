import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { httpOrigin, httpUrl } from '../../common/config/http-origin';

/** Protect browser session mutations; CORS alone only restricts response access. */
@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (origin === undefined) {
      // CLI/server clients need no Origin. A browser reporting a cross-site request does.
      if (req.headers['sec-fetch-site'] === 'cross-site') this.reject();
      return true;
    }
    const parsed = typeof origin === 'string' ? httpOrigin(origin) : undefined;
    // Origin must be a single serialized origin, never null, a list, or a URL path.
    if (!parsed || parsed !== origin) this.reject();
    const publicOrigin = httpUrl(this.config.getOrThrow<string>('APP_PUBLIC_URL'))?.origin;
    const allowed = this.config.get<string[]>('corsOrigins') ?? [];
    if (parsed !== publicOrigin && !allowed.includes(parsed)) this.reject();
    return true;
  }

  private reject(): never {
    throw new ForbiddenException('Untrusted request origin');
  }
}
