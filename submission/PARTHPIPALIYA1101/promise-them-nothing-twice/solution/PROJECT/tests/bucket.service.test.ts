import { describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';

describe('BucketRedisService Unit Tests', () => {
  const createMockRedis = () => {
    const store = new Map<string, Record<string, string>>();
    const mockEval = vi.fn().mockImplementation((script: string, numkeys: number, key: string, argRpm: string, argBurst: string, argNow: string) => {
      const rpmLimit = parseFloat(argRpm);
      const burstLimit = parseFloat(argBurst);
      const nowMs = parseInt(argNow, 10);
      const burstWindowMs = 900000;

      let bucket = store.get(key);
      let tokens = bucket ? parseFloat(bucket.tokens ?? '0') : rpmLimit;
      let burstTokens = bucket ? parseFloat(bucket.burstTokens ?? '0') : 0;
      let lastRefill = bucket ? parseInt(bucket.lastRefill ?? '0', 10) : nowMs;

      if (bucket) {
        const elapsedMs = nowMs - lastRefill;
        if (elapsedMs > 0) {
          if (elapsedMs >= burstWindowMs) {
            burstTokens = 0;
          }
          const refill = (elapsedMs / 60000.0) * rpmLimit;
          const totalBase = tokens + refill;
          if (totalBase > rpmLimit) {
            const overflow = totalBase - rpmLimit;
            burstTokens = Math.min(burstLimit, burstTokens + overflow);
            tokens = rpmLimit;
          } else {
            tokens = totalBase;
          }
          lastRefill = nowMs;
        }
      }

      let allowed = 0;
      let source = 'NONE';
      if (tokens >= 1.0) {
        tokens -= 1.0;
        allowed = 1;
        source = 'BASE';
      } else if (burstTokens >= 1.0) {
        burstTokens -= 1.0;
        allowed = 1;
        source = 'BURST';
      }

      store.set(key, {
        tokens: tokens.toString(),
        burstTokens: burstTokens.toString(),
        lastRefill: lastRefill.toString(),
      });

      return [allowed, source, tokens.toString(), burstTokens.toString()];
    });

    const mockHmget = vi.fn().mockImplementation((key: string) => {
      const b = store.get(key);
      if (!b) return [null, null, null];
      return [b.tokens, b.burstTokens, b.lastRefill];
    });

    const mockHmset = vi.fn().mockImplementation((key: string, data: Record<string, string>) => {
      store.set(key, data);
      return 'OK';
    });

    const mockExpire = vi.fn().mockResolvedValue(1);

    return {
      store,
      eval: mockEval,
      hmget: mockHmget,
      hmset: mockHmset,
      expire: mockExpire,
    } as unknown as Redis;
  };

  it('should initialize a fresh bucket with full base tokens and 0 burst tokens', async () => {
    const mockRedis = createMockRedis();
    const bucketService = new BucketRedisService(undefined, mockRedis);

    const result = await bucketService.consumeToken('cust-100', 100, 100, 1000000);

    expect(result.allowed).toBe(true);
    expect(result.source).toBe('BASE');
    expect(result.tokensRemaining).toBe(99);
    expect(result.burstRemaining).toBe(0);
  });

  it('should consume burst tokens when base tokens are exhausted', async () => {
    const mockRedis = createMockRedis();
    const bucketService = new BucketRedisService(undefined, mockRedis);

    // Initial consume consumes 1 base token -> 99 left
    await bucketService.consumeToken('cust-200', 1, 10, 1000);
    // Consume 2nd -> base = 0
    await bucketService.consumeToken('cust-200', 1, 10, 1000);

    // Now base = 0. Wait 120 seconds -> 2 base tokens refilled (limit = 1). Overflow = 1 -> goes to burst!
    const resultAfterRefill = await bucketService.consumeToken('cust-200', 1, 10, 1000 + 120000);
    expect(resultAfterRefill.allowed).toBe(true);
    expect(resultAfterRefill.source).toBe('BASE'); // Base token consumed

    // Consume base again
    const resultBurst = await bucketService.consumeToken('cust-200', 1, 10, 1000 + 120000);
    expect(resultBurst.allowed).toBe(true);
    expect(resultBurst.source).toBe('BURST'); // Burst token consumed!
  });

  it('should reset accumulated burst tokens after 15 minutes of inactivity', async () => {
    const mockRedis = createMockRedis();
    const bucketService = new BucketRedisService(undefined, mockRedis);

    const now = 1000000;
    // Pre-populate bucket with empty base (0) and accumulated burst tokens (50)
    await bucketService.saveBucket('cust-300', {
      tokens: 0,
      burstTokens: 50,
      lastRefill: now,
    });

    // Simulate 16 minutes later (960,000 ms) with 0 RPM limit so no base refill occurs
    const fifteenMinLater = now + 960000;
    const result = await bucketService.consumeToken('cust-300', 0, 100, fifteenMinLater);

    // Accumulated burst tokens (50) reset to 0 after 15 min window, request rejected
    expect(result.allowed).toBe(false);
    expect(result.tokensRemaining).toBe(0);
    expect(result.burstRemaining).toBe(0);
  });
});
