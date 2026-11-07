import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// A single Redis command: no process/network interruption between count and TTL.
// SET EX creates a new counter with expiry together. Repair legacy orphan keys
// before INCR: Lua errors do not roll back writes (e.g. an EXPIRE ACL denial).
const FAILURE_COUNTER_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if raw then
    local n = tonumber(raw)
    if (raw ~= '0' and not string.match(raw, '^[1-9]%d*$')) or not n or n > 9007199254740991 then
      return redis.error_reply('Invalid failure counter')
    end
    if redis.call('TTL', KEYS[1]) < 0 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    if ARGV[2] == 'read' then return raw end
    if n >= 9007199254740991 then
      return redis.error_reply('Failure counter overflow')
    end
    return redis.call('INCR', KEYS[1])
  end
  if ARGV[2] == 'read' then return false end
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
  return 1
`;

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

  /** Required writes must distinguish storage failure from successful persistence. */
  async setStrict(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  /** Redis >= 6.2: consume a one-time value atomically, propagating failures. */
  async getDelStrict(key: string): Promise<string | null> {
    try {
      return await this.client.getdel(key);
    } catch (error) {
      this.healthy = false;
      throw error;
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
    return this.failureCounter(key, ttlSeconds, 'increment');
  }

  /** Read + repair expiry even when the count already exceeds the lock threshold. */
  async readCounterWithTtlStrict(key: string, ttlSeconds: number): Promise<number> {
    return this.failureCounter(key, ttlSeconds, 'read');
  }

  private async failureCounter(
    key: string,
    ttlSeconds: number,
    mode: 'read' | 'increment',
  ): Promise<number> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 2_147_483_647) {
      throw new Error('Counter TTL must be a positive int32 number of seconds');
    }
    try {
      const result = await this.client.eval(FAILURE_COUNTER_SCRIPT, 1, key, ttlSeconds, mode);
      const n = result === null ? 0 : Number(result);
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error('Invalid failure counter result');
      }
      return n;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      return await this.incrWithTtlStrict(key, ttlSeconds);
    } catch {
      return null;
    }
  }
}
