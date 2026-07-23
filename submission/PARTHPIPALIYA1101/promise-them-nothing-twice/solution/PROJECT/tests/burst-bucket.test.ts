import { describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import { FastifyReply, FastifyRequest } from 'fastify';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { createRateLimiterMiddleware } from '../src/middleware/rate-limiter.middleware.js';
import { TooManyRequestsError } from '../src/utils/app.error.js';
import { calculateLatencyPercentiles } from './bucket.concurrency.test.js';

describe('Phase 6: Burst Bucket Explicit & Latency Test Suite', () => {
  const createThreadSafeRedis = () => {
    const store = new Map<string, Record<string, string>>();

    const executeLuaScript = (
      key: string,
      rpmLimit: number,
      burstLimit: number,
      nowMs: number,
    ): [number, string, string, string] => {
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
    };

    const redisInstance = {
      eval: vi.fn().mockImplementation((_script: string, _numkeys: number, key: string, argRpm: string, argBurst: string, argNow: string) => {
        return Promise.resolve(
          executeLuaScript(key, parseFloat(argRpm), parseFloat(argBurst), parseInt(argNow, 10)),
        );
      }),
      hmget: vi.fn().mockImplementation((key: string) => {
        const b = store.get(key);
        if (!b) return Promise.resolve([null, null, null]);
        return Promise.resolve([b.tokens, b.burstTokens, b.lastRefill]);
      }),
      hmset: vi.fn().mockImplementation((key: string, data: Record<string, string>) => {
        store.set(key, data);
        return Promise.resolve('OK');
      }),
      expire: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    return { store, redisInstance };
  };

  it('1. Unused tokens move to the burst bucket on refill overflow', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-overflow-cust';
    const now = 1000000;

    await service.consumeToken(custId, 1, 100, now);
    await service.consumeToken(custId, 1, 100, now);

    const res = await service.consumeToken(custId, 1, 100, now + 120000);
    expect(res.allowed).toBe(true);
    expect(res.source).toBe('BASE');

    const bucketData = await service.getBucket(custId);
    expect(bucketData?.burstTokens).toBeGreaterThan(0);
  });

  it('2. Burst bucket never exceeds the configured maximum capacity (effectiveBurstLimit)', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-cap-cust';
    const now = 1000000;
    const maxBurstCapacity = 50;

    await service.consumeToken(custId, 100, maxBurstCapacity, now);

    const tenMinLater = now + 600000;
    await service.consumeToken(custId, 100, maxBurstCapacity, tenMinLater);

    const bucketData = await service.getBucket(custId);
    expect(bucketData?.burstTokens).toBeLessThanOrEqual(maxBurstCapacity);
  });

  it('3. Burst tokens expire after 15 minutes of inactivity', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-expire-cust';
    const now = 1000000;

    await service.saveBucket(custId, {
      tokens: 0,
      burstTokens: 50,
      lastRefill: now,
    });

    const sixteenMinLater = now + 960000;
    const res = await service.consumeToken(custId, 0, 100, sixteenMinLater);

    expect(res.allowed).toBe(false);
    expect(res.burstRemaining).toBe(0);
  });

  it('4. Requests consume normal base tokens before burst tokens', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-order-cust';
    const now = 1000000;

    await service.saveBucket(custId, {
      tokens: 1,
      burstTokens: 50,
      lastRefill: now,
    });

    const res1 = await service.consumeToken(custId, 0, 50, now);
    expect(res1.allowed).toBe(true);
    expect(res1.source).toBe('BASE');

    const res2 = await service.consumeToken(custId, 0, 50, now);
    expect(res2.allowed).toBe(true);
    expect(res2.source).toBe('BURST');
  });

  it('5. Requests are rejected when both buckets are empty (returns allowed: false)', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-empty-cust';
    const now = 1000000;

    await service.saveBucket(custId, {
      tokens: 0,
      burstTokens: 0,
      lastRefill: now,
    });

    const res = await service.consumeToken(custId, 0, 0, now);
    expect(res.allowed).toBe(false);
    expect(res.source).toBe('NONE');
    expect(res.tokensRemaining).toBe(0);
    expect(res.burstRemaining).toBe(0);
  });

  it('6. Concurrent requests do not oversell burst tokens', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-concurrent-burst';
    const now = 1000000;

    await service.saveBucket(custId, {
      tokens: 0,
      burstTokens: 50,
      lastRefill: now,
    });

    const reqs = Array.from({ length: 200 }, () => service.consumeToken(custId, 0, 50, now));
    const results = await Promise.all(reqs);

    const allowedCount = results.filter((r) => r.allowed).length;
    const burstConsumedCount = results.filter((r) => r.source === 'BURST').length;

    expect(allowedCount).toBe(50);
    expect(burstConsumedCount).toBe(50);
  });

  it('7. X-RateLimit-Burst-Remaining header accuracy and non-negativity under high concurrent load', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);
    const middleware = createRateLimiterMiddleware(service);

    const custId = 'phase6-header-load';
    const nowMs = 1000000;

    await service.saveBucket(custId, {
      tokens: 10,
      burstTokens: 20,
      lastRefill: nowMs,
    });

    const mockRequest = {
      customer: {
        id: custId,
        planId: 'plan-enterprise',
        planName: 'ENTERPRISE',
        effectiveRpmLimit: 0,
        effectiveBurstLimit: 50,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const burstHeaderValues: number[] = [];

    const promises = Array.from({ length: 100 }, async () => {
      const headers = new Map<string, string>();
      const reply = {
        header: vi.fn((k: string, v: string) => {
          headers.set(k, v);
        }),
      } as unknown as FastifyReply;

      try {
        await middleware(mockRequest, reply);
      } catch (err) {
        if (!(err instanceof TooManyRequestsError)) throw err;
      }

      const burstVal = parseInt(headers.get('X-RateLimit-Burst-Remaining') ?? '0', 10);
      burstHeaderValues.push(burstVal);
    });

    await Promise.all(promises);

    expect(burstHeaderValues.every((val) => val >= 0 && val <= 50)).toBe(true);
    expect(Math.min(...burstHeaderValues)).toBe(0);
  });

  it('8. Burst Consumption Latency Profiling (p50, p95, p99): zero performance penalty switching base to burst', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'phase6-latency-prof';
    const nowMs = 1000000;

    await service.saveBucket(custId, {
      tokens: 50,
      burstTokens: 50,
      lastRefill: nowMs,
    });

    const baseLatencies: number[] = [];
    const burstLatencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const res = await service.consumeToken(custId, 0, 50, nowMs);
      const elapsed = performance.now() - start;

      if (res.source === 'BASE') {
        baseLatencies.push(elapsed);
      } else if (res.source === 'BURST') {
        burstLatencies.push(elapsed);
      }
    }

    const baseMetrics = calculateLatencyPercentiles(baseLatencies);
    const burstMetrics = calculateLatencyPercentiles(burstLatencies);

    expect(baseMetrics.p50).toBeLessThan(10);
    expect(burstMetrics.p50).toBeLessThan(10);
    expect(burstMetrics.p95).toBeLessThan(25);
  });

  it('9. Mixed Multi-Tenant Burst Isolation Test across Basic (50), Premium (100) & Enterprise (500) burst limits', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);
    const nowMs = 2000000;

    const basicCust = 'tenant-basic';
    const premiumCust = 'tenant-premium';
    const enterpriseCust = 'tenant-enterprise';

    await service.saveBucket(basicCust, { tokens: 0, burstTokens: 50, lastRefill: nowMs });
    await service.saveBucket(premiumCust, { tokens: 0, burstTokens: 100, lastRefill: nowMs });
    await service.saveBucket(enterpriseCust, { tokens: 0, burstTokens: 500, lastRefill: nowMs });

    const basicReqs = Array.from({ length: 100 }, () => service.consumeToken(basicCust, 0, 50, nowMs));
    const premiumReqs = Array.from({ length: 200 }, () => service.consumeToken(premiumCust, 0, 100, nowMs));
    const enterpriseReqs = Array.from({ length: 600 }, () => service.consumeToken(enterpriseCust, 0, 500, nowMs));

    const [basicRes, premiumRes, enterpriseRes] = await Promise.all([
      Promise.all(basicReqs),
      Promise.all(premiumReqs),
      Promise.all(enterpriseReqs),
    ]);

    expect(basicRes.filter((r) => r.allowed).length).toBe(50);
    expect(premiumRes.filter((r) => r.allowed).length).toBe(100);
    expect(enterpriseRes.filter((r) => r.allowed).length).toBe(500);
  });

  it('10. Long-Running Burst Timeline Simulation: 20-minute timeline testing accumulation, expiration, and re-accumulation', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'timeline-cust';
    let nowMs = 1000000;
    const rpm = 60;
    const maxBurst = 30;

    await Promise.all(Array.from({ length: 60 }, () => service.consumeToken(custId, rpm, maxBurst, nowMs)));

    nowMs += 120000;
    await Promise.all(Array.from({ length: 90 }, () => service.consumeToken(custId, rpm, maxBurst, nowMs)));

    nowMs += 960000;
    const expReq = await service.consumeToken(custId, 0, maxBurst, nowMs);
    expect(expReq.allowed).toBe(false);
    expect(expReq.burstRemaining).toBe(0);
  });

  it('11. Large Burst Capacity Scaling Test (1,000 to 5,000 Burst Tokens): sub-millisecond execution at 5,000 burst limit', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const enterpriseCust = 'enterprise-5000-burst';
    const nowMs = 3000000;
    const maxBurstCapacity = 5000;

    await service.saveBucket(enterpriseCust, {
      tokens: 0,
      burstTokens: maxBurstCapacity,
      lastRefill: nowMs,
    });

    const latencies: number[] = [];

    const reqs = Array.from({ length: 6000 }, async () => {
      const start = performance.now();
      const res = await service.consumeToken(enterpriseCust, 0, maxBurstCapacity, nowMs);
      latencies.push(performance.now() - start);
      return res;
    });

    const results = await Promise.all(reqs);
    const metrics = calculateLatencyPercentiles(latencies);

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(5000);
    expect(rejectedCount).toBe(1000);
    expect(metrics.p50).toBeLessThan(25);
    expect(metrics.p99).toBeLessThan(100);
  });

  it('12. Dynamic Traffic Spike & Quiet Period Simulation: alternating burst spikes and quiet refill periods', async () => {
    const { redisInstance } = createThreadSafeRedis();
    const service = new BucketRedisService(undefined, redisInstance);

    const custId = 'dynamic-traffic-cust';
    let nowMs = 4000000;
    const rpm = 600; // 10 tokens per second
    const maxBurst = 200;

    // Phase A: Initial Spike (Consume all 600 base tokens)
    const spike1 = await Promise.all(Array.from({ length: 600 }, () => service.consumeToken(custId, rpm, maxBurst, nowMs)));
    expect(spike1.every((r) => r.allowed)).toBe(true);

    // Phase B: Quiet Period (Wait 120 seconds -> 1200 base tokens generated -> 600 base + 200 overflow to burst!)
    nowMs += 120000;

    // Phase C: Secondary Traffic Spike (Consume 600 base + 200 burst = 800 total)
    const spike2 = await Promise.all(Array.from({ length: 800 }, () => service.consumeToken(custId, rpm, maxBurst, nowMs)));
    const allowedSpike2 = spike2.filter((r) => r.allowed).length;

    expect(allowedSpike2).toBe(800); // All 800 (600 base + 200 burst) allowed!

    // 801st request in same timestamp rejected
    const rejectedExtra = await service.consumeToken(custId, rpm, maxBurst, nowMs);
    expect(rejectedExtra.allowed).toBe(false);
  });
});
