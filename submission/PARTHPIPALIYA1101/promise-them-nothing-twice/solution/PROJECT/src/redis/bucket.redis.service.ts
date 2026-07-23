import Redis from 'ioredis';
import { RedisService } from './redis.service.js';
import { ConsumeResult, TokenBucketData } from './bucket.types.js';
import { logger } from '../config/logger.config.js';

// Single Source of Truth Atomic Lua Script
// KEYS[1]: Redis Hash key (customer:{id}:bucket)
// ARGV[1]: Effective RPM Limit
// ARGV[2]: Effective Burst Capacity Ceiling
// ARGV[3]: Current timestamp in milliseconds (nowMs)
// ARGV[4]: Key TTL in seconds (86400 = 24h)
const ATOMIC_TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rpmLimit = tonumber(ARGV[1])
local burstLimit = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local burstWindowMs = 900000 -- 15 minutes in milliseconds

local bucket = redis.call('HMGET', key, 'tokens', 'burstTokens', 'lastRefill')
local tokens = tonumber(bucket[1])
local burstTokens = tonumber(bucket[2])
local lastRefill = tonumber(bucket[3])

if not tokens or not burstTokens or not lastRefill then
  tokens = rpmLimit
  burstTokens = 0
  lastRefill = nowMs
else
  local elapsedMs = nowMs - lastRefill
  if elapsedMs > 0 then
    -- 15-minute sliding window expiration: if idle for >= 15 minutes, reset burst tokens
    if elapsedMs >= burstWindowMs then
      burstTokens = 0
    end

    -- Refill base tokens: (elapsedMs / 60000) * rpmLimit
    local refill = (elapsedMs / 60000.0) * rpmLimit
    local totalBase = tokens + refill

    if totalBase > rpmLimit then
      local overflow = totalBase - rpmLimit
      -- Transfer unused base capacity to burst tokens, capped at burstLimit ceiling
      burstTokens = math.min(burstLimit, burstTokens + overflow)
      tokens = rpmLimit
    else
      tokens = totalBase
    end
    lastRefill = nowMs
  end
end

-- Attempt to consume 1 token
local allowed = 0
local source = "NONE"

if tokens >= 1.0 then
  tokens = tokens - 1.0
  allowed = 1
  source = "BASE"
elseif burstTokens >= 1.0 then
  burstTokens = burstTokens - 1.0
  allowed = 1
  source = "BURST"
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'burstTokens', tostring(burstTokens), 'lastRefill', tostring(lastRefill))
redis.call('EXPIRE', key, ttlSeconds)

return { allowed, source, tostring(tokens), tostring(burstTokens) }
`;

export class BucketRedisService {
  private readonly redisClient: Redis;

  constructor(redisService?: RedisService, customClient?: Redis) {
    if (customClient) {
      this.redisClient = customClient;
    } else {
      const service = redisService ?? RedisService.getInstance();
      this.redisClient = service.getClient();
    }
  }

  public getBucketKey(customerId: string): string {
    return `customer:${customerId}:bucket`;
  }

  public async getBucket(customerId: string): Promise<TokenBucketData | null> {
    const key = this.getBucketKey(customerId);
    const data = await this.redisClient.hmget(key, 'tokens', 'burstTokens', 'lastRefill');

    if (!data[0] || !data[1] || !data[2]) {
      return null;
    }

    return {
      tokens: parseFloat(data[0]),
      burstTokens: parseFloat(data[1]),
      lastRefill: parseInt(data[2], 10),
    };
  }

  public async saveBucket(
    customerId: string,
    bucket: TokenBucketData,
    ttlSeconds = 86400,
  ): Promise<void> {
    const key = this.getBucketKey(customerId);
    await this.redisClient.hmset(key, {
      tokens: bucket.tokens.toString(),
      burstTokens: bucket.burstTokens.toString(),
      lastRefill: bucket.lastRefill.toString(),
    });
    await this.redisClient.expire(key, ttlSeconds);
  }

  /**
   * Atomic token consumption via Redis Lua script (Single Source of Truth)
   */
  public async consumeToken(
    customerId: string,
    effectiveRpm: number,
    effectiveBurst: number,
    nowMs: number = Date.now(),
    ttlSeconds = 86400,
  ): Promise<ConsumeResult> {
    const key = this.getBucketKey(customerId);

    try {
      const evalResult = (await this.redisClient.eval(
        ATOMIC_TOKEN_BUCKET_LUA,
        1,
        key,
        effectiveRpm.toString(),
        effectiveBurst.toString(),
        nowMs.toString(),
        ttlSeconds.toString(),
      )) as [number, string, string, string];

      const allowed = evalResult[0] === 1;
      const source = evalResult[1] as 'BASE' | 'BURST' | 'NONE';
      const tokensRemaining = parseFloat(evalResult[2]);
      const burstRemaining = parseFloat(evalResult[3]);

      let retryAfterMs: number | undefined;
      if (!allowed && effectiveRpm > 0) {
        // Estimate milliseconds required until 1 token is refilled: (1 / RPM) * 60,000 ms
        retryAfterMs = Math.ceil((1.0 / effectiveRpm) * 60000);
      }

      return {
        allowed,
        source,
        tokensRemaining,
        burstRemaining,
        ...(retryAfterMs !== undefined && { retryAfterMs }),
      };
    } catch (error) {
      logger.error({ error, customerId }, 'Redis atomic token evaluation failed');
      throw error;
    }
  }
}
