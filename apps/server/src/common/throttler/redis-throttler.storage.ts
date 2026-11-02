import { Injectable, Logger } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { RedisService } from "../../redis/redis.service";

/**
 * Redis-backed ThrottlerStorage (fixed window + optional block).
 * Script adapted from @nest-lab/throttler-storage-redis.
 * On Redis errors: fail-open (allow request) so transient outages
 * do not 500 the whole API; ready probes already surface Redis down.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly scriptSrc: string;

  constructor(private readonly redis: RedisService) {
    this.scriptSrc = `
      local hitKey = KEYS[1]
      local blockKey = KEYS[2]
      local ttl = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local blockDuration = tonumber(ARGV[4])

      local totalHits = redis.call('INCR', hitKey)
      local timeToExpire = redis.call('PTTL', hitKey)

      if timeToExpire <= 0 then
        redis.call('PEXPIRE', hitKey, ttl)
        timeToExpire = ttl
      end

      local isBlocked = redis.call('GET', blockKey)
      local timeToBlockExpire = 0

      if isBlocked then
        timeToBlockExpire = redis.call('PTTL', blockKey)
      elseif totalHits > limit then
        redis.call('SET', blockKey, 1, 'PX', blockDuration)
        isBlocked = '1'
        timeToBlockExpire = blockDuration
      end

      if isBlocked and timeToBlockExpire <= 0 then
        redis.call('DEL', blockKey)
        redis.call('SET', hitKey, 1, 'PX', ttl)
        totalHits = 1
        timeToExpire = ttl
        isBlocked = false
      end

      return { totalHits, timeToExpire, isBlocked and 1 or 0, timeToBlockExpire }
    `
      .replace(/^\s+/gm, "")
      .trim();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `qz:throttle:{${key}:${throttlerName}}:hits`;
    const blockKey = `qz:throttle:{${key}:${throttlerName}}:blocked`;
    try {
      const client = this.redis.getClient();
      const results = (await client.eval(
        this.scriptSrc,
        2,
        hitKey,
        blockKey,
        throttlerName,
        ttl,
        limit,
        blockDuration,
      )) as unknown[];

      if (!Array.isArray(results) || results.length < 4) {
        throw new TypeError(`Unexpected throttle eval result: ${String(results)}`);
      }

      const totalHits = Number(results[0]);
      const timeToExpireMs = Number(results[1]);
      const isBlocked = Number(results[2]) === 1;
      const timeToBlockExpireMs = Number(results[3]);

      return {
        totalHits,
        timeToExpire: Math.ceil(timeToExpireMs / 1000),
        isBlocked,
        timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
      };
    } catch (err) {
      this.logger.warn(
        `Throttle storage failed (fail-open): ${String(err)}`,
      );
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
