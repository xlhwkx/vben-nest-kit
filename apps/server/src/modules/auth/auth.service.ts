import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { LoginDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';

const REFRESH_COOKIE = 'jwt';
const CODES_CACHE_TTL = 60;

function parseTtlToSeconds(ttl: string, fallback: number): number {
  const m = /^(\d+)([smhd])$/i.exec(ttl.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return n * mult;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  private cookieOptions() {
    const secure = this.config.get<boolean>('COOKIE_SECURE') ?? false;
    const sameSite =
      (this.config.get<string>('COOKIE_SAME_SITE') as
        | 'lax'
        | 'strict'
        | 'none') ?? 'lax';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const maxAgeSec = parseTtlToSeconds(refreshTtl, 7 * 86_400);
    return {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: maxAgeSec * 1000,
      path: '/',
    } as const;
  }

  setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, this.cookieOptions());
  }

  clearRefreshCookie(res: Response): void {
    const opts = this.cookieOptions();
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
    });
  }

  private failWindowSec(): number {
    return this.config.get<number>('AUTH_FAIL_WINDOW_SEC') ?? 900;
  }

  private failUserMax(): number {
    return (
      this.config.get<number>('AUTH_FAIL_USER_MAX') ??
      this.config.get<number>('AUTH_FAIL_MAX') ??
      5
    );
  }

  private failIpMax(): number {
    return (
      this.config.get<number>('AUTH_FAIL_IP_MAX') ??
      this.config.get<number>('AUTH_FAIL_MAX') ??
      5
    );
  }

  /** Plan §: auth:fail:{username|ip} */
  private userFailKey(username: string): string {
    return `auth:fail:user:${username.trim().toLowerCase()}`;
  }

  private ipFailKey(ip: string): string {
    return `auth:fail:ip:${ip}`;
  }

  private async readFailCount(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Reject with HTTP 429 when username or IP failure count ≥ threshold.
   * Redis down → skip lock check (throttler login path is separately fail-closed).
   */
  private async assertNotLocked(
    username: string,
    ip: string | undefined,
  ): Promise<void> {
    const userCount = await this.readFailCount(this.userFailKey(username));
    const ipCount = ip ? await this.readFailCount(this.ipFailKey(ip)) : 0;
    if (userCount >= this.failUserMax() || ipCount >= this.failIpMax()) {
      this.audit.record({
        action: 'auth.login_locked',
        module: 'auth',
        username,
        status: 429,
        detail: {
          reason: 'fail_threshold',
          userCount,
          ipCount: ip ? ipCount : undefined,
        },
      });
      this.throwLocked();
    }
  }

  private throwLocked(): never {
    throw new HttpException(
      {
        message: 'Too many failed login attempts. Try again later.',
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async recordLoginFailure(
    username: string,
    ip: string | undefined,
  ): Promise<void> {
    const window = this.failWindowSec();
    await this.redis.incrWithTtl(this.userFailKey(username), window);
    if (ip) {
      await this.redis.incrWithTtl(this.ipFailKey(ip), window);
    }
  }

  private async clearLoginFailures(username: string): Promise<void> {
    await this.redis.del(this.userFailKey(username));
  }

  private async signAccess(user: {
    id: string;
    username: string;
    tokenVersion: number;
  }): Promise<string> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '30m';
    return this.jwt.signAsync(
      {
        sub: user.id,
        username: user.username,
        tv: user.tokenVersion,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: parseTtlToSeconds(accessTtl, 30 * 60),
      },
    );
  }

  private async issueRefresh(
    userId: string,
  ): Promise<{ token: string; jti: string }> {
    const jti = randomUUID().replaceAll('-', '');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const expiresInSec = parseTtlToSeconds(refreshTtl, 7 * 86_400);
    const token = await this.jwt.signAsync(
      { sub: userId, jti },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: expiresInSec,
      },
    );
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        jti,
        tokenHash: sha256(token),
        expiresAt,
      },
    });
    return { token, jti };
  }

  async login(dto: LoginDto, res: Response, ip?: string) {
    const username = dto.username.trim();
    const password = dto.password;

    await this.assertNotLocked(username, ip);

    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });

    const ok =
      !!user &&
      user.status === 1 &&
      (await argon2.verify(user.passwordHash, password));

    if (!ok || !user) {
      await this.recordLoginFailure(username, ip);
      // Re-check after increment so the attempt that crosses the threshold
      // is already locked for subsequent tries (and this response stays 403).
      this.audit.record({
        action: 'auth.login_failed',
        module: 'auth',
        username,
        status: 403,
        detail: { reason: 'invalid_credentials' },
      });
      this.clearRefreshCookie(res);
      throw new ForbiddenException('Username or password is incorrect.');
    }

    await this.clearLoginFailures(username);

    const accessToken = await this.signAccess(user);
    const { token: refreshToken } = await this.issueRefresh(user.id);
    this.setRefreshCookie(res, refreshToken);

    this.audit.record({
      action: 'auth.login',
      module: 'auth',
      userId: user.id,
      username: user.username,
      status: 200,
      detail: { userId: user.id },
    });

    const roles = user.roles.map((r) => r.role.code);
    return {
      id: user.id,
      userId: user.id,
      username: user.username,
      realName: user.realName,
      roles,
      homePath: user.homePath ?? '/dashboard/workspace',
      accessToken,
    };
  }

  async refresh(
    refreshCookie: string | undefined,
    res: Response,
  ): Promise<string> {
    if (!refreshCookie) {
      this.clearRefreshCookie(res);
      throw new ForbiddenException('Forbidden');
    }

    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshCookie, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      this.clearRefreshCookie(res);
      throw new ForbiddenException('Forbidden');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() < Date.now() ||
      stored.tokenHash !== sha256(refreshCookie) ||
      stored.userId !== payload.sub
    ) {
      this.clearRefreshCookie(res);
      throw new ForbiddenException('Forbidden');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, status: 1 },
    });
    if (!user) {
      this.clearRefreshCookie(res);
      throw new ForbiddenException('Forbidden');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const accessToken = await this.signAccess(user);
    const { token: newRefresh } = await this.issueRefresh(user.id);
    this.setRefreshCookie(res, newRefresh);
    return accessToken;
  }

  async logout(
    refreshCookie: string | undefined,
    res: Response,
  ): Promise<string> {
    let logoutUserId: string | undefined;
    let logoutUsername: string | undefined;
    if (refreshCookie) {
      try {
        const payload = await this.jwt.verifyAsync<{
          jti: string;
          sub?: string;
        }>(refreshCookie, {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        });
        const stored = await this.prisma.refreshToken.findUnique({
          where: { jti: payload.jti },
          select: { userId: true },
        });
        const userId = stored?.userId ?? payload.sub;
        if (userId) {
          logoutUserId = userId;
          const u = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          });
          logoutUsername = u?.username;
        }
        await this.prisma.refreshToken.updateMany({
          where: { jti: payload.jti, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch {
        // ignore invalid cookie on logout
      }
    }
    this.audit.record({
      action: 'auth.logout',
      module: 'auth',
      userId: logoutUserId ?? null,
      username: logoutUsername ?? null,
      status: 200,
    });
    this.clearRefreshCookie(res);
    return '';
  }

  async getCodes(userId: string): Promise<string[]> {
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
    const codes = [...new Set(rows.map((r) => r.permission.code))].sort();
    await this.redis.set(cacheKey, JSON.stringify(codes), CODES_CACHE_TTL);
    return codes;
  }
}
