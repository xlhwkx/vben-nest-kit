import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
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
import { getRequestContext } from '../../common/request-context';
import { MetricsService } from '../../observability/metrics.service';
import type { Prisma } from '../../generated/prisma/client';
import { readPermissionCodes } from '../../common/authorization/permission-codes';

const REFRESH_COOKIE = 'jwt';

function parseTtlToSeconds(ttl: string, fallback: number): number {
  const m = /^(\d+)([smhd])$/i.exec(ttl.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const UNIT_SECONDS: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
  };
  const mult = UNIT_SECONDS[unit] ?? 86_400;
  return n * mult;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  private cookieOptions() {
    const secure = this.config.get<boolean>('COOKIE_SECURE') ?? false;
    const sameSite =
      (this.config.get<string>('COOKIE_SAME_SITE') as 'lax' | 'strict' | 'none') ?? 'lax';
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
      this.config.get<number>('AUTH_FAIL_USER_MAX') ?? this.config.get<number>('AUTH_FAIL_MAX') ?? 5
    );
  }

  private failIpMax(): number {
    return (
      this.config.get<number>('AUTH_FAIL_IP_MAX') ?? this.config.get<number>('AUTH_FAIL_MAX') ?? 5
    );
  }

  /** Redis keys: auth:fail:user:{username} / auth:fail:ip:{ip} */
  private userFailKey(username: string): string {
    return `auth:fail:user:${username.trim().toLowerCase()}`;
  }

  private ipFailKey(ip: string): string {
    return `auth:fail:ip:${ip}`;
  }

  private async readFailCount(key: string): Promise<number> {
    return this.redis.readCounterWithTtlStrict(key, this.failWindowSec());
  }

  private throwLockUnavailable(cause: unknown): never {
    const requestId = getRequestContext()?.requestId;
    this.logger.warn(
      JSON.stringify({
        msg: 'auth.lock_unavailable',
        code: 'AUTH_LOCK_UNAVAILABLE',
        requestId: requestId ?? null,
        err: String(cause),
      }),
    );
    this.metrics.incLoginFailClosed();
    this.audit.record({
      action: 'auth.lock_unavailable',
      module: 'auth',
      status: 503,
      detail: { reason: 'redis_unavailable' },
    });
    throw new ServiceUnavailableException({
      message: 'Login lock unavailable',
      error: 'Service Unavailable',
    });
  }

  /**
   * Reject with HTTP 429 when username or IP failure count >= threshold.
   * Redis down → fail-closed HTTP 503 (same posture as login throttler).
   */
  private async assertNotLocked(username: string, ip: string | undefined): Promise<void> {
    let userCount: number;
    let ipCount: number;
    try {
      userCount = await this.readFailCount(this.userFailKey(username));
      ipCount = ip ? await this.readFailCount(this.ipFailKey(ip)) : 0;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.throwLockUnavailable(error);
    }
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
      this.metrics.incLoginLocked();
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

  private async recordLoginFailure(username: string, ip: string | undefined): Promise<void> {
    const window = this.failWindowSec();
    try {
      await this.redis.incrWithTtlStrict(this.userFailKey(username), window);
      if (ip) {
        await this.redis.incrWithTtlStrict(this.ipFailKey(ip), window);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.throwLockUnavailable(error);
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
    tx: Prisma.TransactionClient,
    user: { id: string; tokenVersion: number },
    familyId: string = randomUUID(),
  ): Promise<{ token: string; jti: string }> {
    const jti = randomUUID().replaceAll('-', '');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const expiresInSec = parseTtlToSeconds(refreshTtl, 7 * 86_400);
    const token = await this.jwt.signAsync(
      { sub: user.id, jti, tv: user.tokenVersion },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: expiresInSec,
      },
    );
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenVersion: user.tokenVersion,
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

    const ok = !!user && user.status === 1 && (await argon2.verify(user.passwordHash, password));

    if (!ok || !user) {
      await this.recordLoginFailure(username, ip);
      // Re-check after increment so the attempt that crosses the threshold
      // is already locked for subsequent tries (and this response stays 403).
      this.metrics.incLoginFailed();
      this.audit.record({
        action: 'auth.login_failed',
        module: 'auth',
        username,
        status: 403,
        detail: { reason: 'invalid_credentials' },
      });
      throw new ForbiddenException('Username or password is incorrect.');
    }

    await this.clearLoginFailures(username);

    // Serialize issuance with password/status changes, which update this same user row.
    const { accessToken, refreshToken } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findFirst({
        where: { id: user.id, deletedAt: null, status: 1 },
      });
      if (
        !current ||
        current.tokenVersion !== user.tokenVersion ||
        current.passwordHash !== user.passwordHash
      ) {
        throw new ForbiddenException('Credentials changed. Please log in again.');
      }
      const accessToken = await this.signAccess(current);
      const { token } = await this.issueRefresh(tx, current);
      await this.audit.recordInTransaction(tx, {
        action: 'auth.login',
        module: 'auth',
        userId: user.id,
        username: user.username,
        status: 200,
        detail: { userId: user.id },
      });
      return { accessToken, refreshToken: token };
    });
    this.setRefreshCookie(res, refreshToken);

    this.metrics.incLoginSuccess();

    const roles = user.roles.filter((r) => r.role.status === 1).map((r) => r.role.code);
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
    expectedUserId?: string,
  ): Promise<string> {
    if (!refreshCookie) {
      throw new ForbiddenException('Forbidden');
    }

    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshCookie, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(payload.sub) ||
        typeof payload.jti !== 'string'
      ) {
        throw new Error('Invalid refresh claims');
      }
    } catch {
      throw new ForbiddenException('Forbidden');
    }

    if (expectedUserId && payload.sub !== expectedUserId) {
      throw new ForbiddenException('Session identity changed. Please log in again.');
    }

    // A delayed failure must never clear a newer cookie set by another request/tab.
    // Only explicit logout clears the shared cookie; token validation remains strict.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${payload.sub}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id: payload.sub, deletedAt: null, status: 1 },
      });
      if (!user) throw new ForbiddenException('Forbidden');
      const stored = await tx.refreshToken.findUnique({
        where: { jti: payload.jti },
        select: { familyId: true },
      });
      if (!stored) throw new ForbiddenException('Forbidden');
      const now = new Date();
      const consumed = await tx.refreshToken.updateMany({
        where: {
          jti: payload.jti,
          userId: user.id,
          tokenHash: sha256(refreshCookie),
          tokenVersion: user.tokenVersion,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) throw new ForbiddenException('Forbidden');
      const accessToken = await this.signAccess(user);
      const { token } = await this.issueRefresh(tx, user, stored.familyId);
      await this.audit.recordInTransaction(tx, {
        action: 'auth.refresh',
        module: 'auth',
        userId: user.id,
        username: user.username,
        status: 200,
      });
      return { accessToken, token };
    });
    this.setRefreshCookie(res, result.token);
    return result.accessToken;
  }

  async logout(
    refreshCookie: string | undefined,
    res: Response,
    expectedUserId?: string,
  ): Promise<string> {
    let logoutUserId: string | undefined;
    let logoutUsername: string | undefined;
    if (refreshCookie) {
      let payload: { jti: string; sub: string } | undefined;
      try {
        const verified = await this.jwt.verifyAsync<{
          jti: string;
          sub: string;
        }>(refreshCookie, {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        });
        if (
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(verified.sub) &&
          typeof verified.jti === 'string'
        )
          payload = verified;
      } catch {
        // An invalid/expired cookie is already unusable. Storage errors below must propagate.
      }
      if (payload) {
        if (expectedUserId && payload.sub !== expectedUserId) {
          throw new ForbiddenException('Session identity changed. Please log in again.');
        }
        const claims = payload;
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${claims.sub}::uuid FOR UPDATE`;
          const stored = await tx.refreshToken.findUnique({
            where: { jti: claims.jti },
          });
          if (!stored || stored.userId !== claims.sub || stored.tokenHash !== sha256(refreshCookie))
            return;
          await tx.refreshToken.updateMany({
            where: {
              familyId: stored.familyId,
              userId: claims.sub,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
          logoutUserId = stored.userId;
          const user = await tx.user.findUnique({
            where: { id: stored.userId },
            select: { username: true },
          });
          logoutUsername = user?.username;
          await this.audit.recordInTransaction(tx, {
            action: 'auth.logout',
            module: 'auth',
            userId: logoutUserId,
            username: logoutUsername,
            status: 200,
          });
        });
      }
    }
    if (!logoutUserId)
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
    return readPermissionCodes(this.prisma, userId);
  }
}
