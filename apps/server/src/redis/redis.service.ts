import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private healthy = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      // Fail fast when Redis is unreachable (login throttle fail-closed).
      commandTimeout: 2000,
    });
    try {
      await this.client.ping();
      this.healthy = true;
      this.logger.log('Redis connected');
    } catch (error) {
      this.healthy = false;
      this.logger.warn(
        `Redis connect failed (auth:fail / login throttle are fail-closed until Redis recovers): ${String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
    }
  }

  /** Raw ioredis client (throttler storage / advanced ops). */
  getClient(): Redis {
    return this.client;
  }

  /** True when Redis answered a recent ping / successful command. */
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const res = await this.client.ping();
      this.healthy = res === 'PONG';
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      this.healthy = false;
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      this.healthy = false;
      // ignore cache write failures
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      this.healthy = false;
      // ignore
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch {
      this.healthy = false;
      return 0;
    }
  }

  /**
   * INCR + ensure TTL (set expire on first hit or when key has no TTL).
   * Returns null when Redis is unavailable (caller decides fail-open/closed).
   */

  /**
   * GET that propagates Redis errors (auth:fail lock fail-closed).
   * Soft get() still returns null for optional cache paths.
   */
  async getStrict(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  /**
   * INCR+TTL that throws when Redis is down (login failure accounting).
   */
  async incrWithTtlStrict(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.incrWithTtl(key, ttlSeconds);
    if (n === null) {
      throw new Error('Redis unavailable for incrWithTtl');
    }
    return n;
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      const n = await this.client.incr(key);
      if (n === 1) {
        await this.client.expire(key, ttlSeconds);
      } else {
        const ttl = await this.client.ttl(key);
        if (ttl < 0) {
          await this.client.expire(key, ttlSeconds);
        }
      }
      return n;
    } catch {
      this.healthy = false;
      return null;
    }
  }
}
