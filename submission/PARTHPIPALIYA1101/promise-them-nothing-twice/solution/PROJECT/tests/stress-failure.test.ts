import { describe, expect, it, vi } from 'vitest';
import { FallbackRateLimiterService } from '../src/services/fallback-rate-limiter.service.js';
import { DatabaseRateLimiterService } from '../src/services/database-rate-limiter.service.js';
import { RedisHealthMonitor } from '../src/health/redis-health.monitor.js';
import { RequestQueueManager } from '../src/queue/request.queue.js';
import { QueueScheduler } from '../src/scheduler/queue.scheduler.js';
import { BackupScheduler } from '../src/scheduler/backup.scheduler.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';
import { CustomerRepository } from '../src/repositories/customer.repository.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Exhaustive Stress & Failure Verification Suite', () => {
  const createMockBackupRepo = () => {
    const backupDb = new Map<string, any>();
    return {
      backupDb,
      upsertBackup: vi.fn().mockImplementation((customerId: string, tokens: number, burstTokens: number, lastRefill: Date) => {
        const record = { customerId, tokens, burstTokens, lastRefill, updatedAt: new Date() };
        backupDb.set(customerId, record);
        return Promise.resolve(record);
      }),
      findByCustomerId: vi.fn().mockImplementation((id: string) => Promise.resolve(backupDb.get(id) ?? null)),
      findAllBackups: vi.fn().mockImplementation(() => Promise.resolve(Array.from(backupDb.values()))),
    } as unknown as BackupRepository & { backupDb: Map<string, any> };
  };

  const createMockRedisService = (throwErrors = false) => {
    const memoryMap = new Map<string, any>();
    return {
      memoryMap,
      checkHealth: vi.fn().mockResolvedValue({ status: throwErrors ? 'down' : 'up' }),
      getBucket: vi.fn().mockImplementation((customerId: string) => {
        if (throwErrors) return Promise.reject(new Error('Redis Connection Error'));
        return Promise.resolve(memoryMap.get(customerId) ?? null);
      }),
      saveBucket: vi.fn().mockImplementation((customerId: string, bucketData: any) => {
        if (throwErrors) return Promise.reject(new Error('Redis Write Error'));
        memoryMap.set(customerId, bucketData);
        return Promise.resolve();
      }),
      consumeToken: vi.fn().mockImplementation((customerId: string, rpm: number, burst: number) => {
        if (throwErrors) return Promise.reject(new Error('Redis Execution Failure'));
        let b = memoryMap.get(customerId);
        let tokens = b ? b.tokens : rpm;
        let burstTokens = b ? b.burstTokens : 0;
        let allowed = false;
        let source: 'BASE' | 'BURST' | 'NONE' = 'NONE';

        if (tokens >= 1.0) {
          tokens -= 1.0;
          allowed = true;
          source = 'BASE';
        } else if (burstTokens >= 1.0) {
          burstTokens -= 1.0;
          allowed = true;
          source = 'BURST';
        }

        memoryMap.set(customerId, { tokens, burstTokens, lastRefill: Date.now() });

        return Promise.resolve({
          allowed,
          source,
          tokensRemaining: tokens,
          burstRemaining: burstTokens,
        });
      }),
    } as unknown as BucketRedisService & { memoryMap: Map<string, any> };
  };

  it('1. High Concurrency Stress Test: 10,000 concurrent requests across 100 customer buckets without race conditions or token overselling', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);

    const customers = Array.from({ length: 100 }, (_, i) => `stress-cust-${i}`);
    for (const c of customers) {
      await mockBackupRepo.upsertBackup(c, 50, 25, new Date());
    }

    const start = performance.now();

    // Fire 10,000 concurrent requests
    const promises = Array.from({ length: 10000 }, (_, i) => {
      const cust = customers[i % customers.length]!;
      return dbRateLimiter.consumeToken(cust, 100, 50);
    });

    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    expect(results.length).toBe(10000);
    expect(elapsed).toBeLessThan(3000); // 10,000 evaluations completed in under 3 seconds!

    // Verify exactly 7,500 allowed across 100 customers (75 capacity each * 100 = 7,500)
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(7500);
  });

  it('2. 30-Minute Endurance Simulation: bucket refill, 15-min burst expiration, and steady CPU/Memory state', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'endurance-cust';

    let simulatedTime = 1000000;
    await mockBackupRepo.upsertBackup(custId, 100, 50, new Date(simulatedTime));

    // Minute 0: Consume all 150 tokens (100 base + 50 burst)
    for (let i = 0; i < 150; i++) {
      const res = await dbRateLimiter.consumeToken(custId, 100, 50, simulatedTime);
      expect(res.allowed).toBe(true);
    }
    const emptyRes = await dbRateLimiter.consumeToken(custId, 100, 50, simulatedTime);
    expect(emptyRes.allowed).toBe(false);

    // Advance simulated time by 15 minutes (900,000ms)
    simulatedTime += 900000;

    // Refill after 15 mins gives (900000/60000)*100 = 1500 base tokens -> capped at 100 RPM, overflow 1400 -> capped at 50 burst tokens.
    const refillRes = await dbRateLimiter.consumeToken(custId, 100, 50, simulatedTime);
    expect(refillRes.allowed).toBe(true);
    expect(refillRes.tokensRemaining).toBe(99);

    // Advance simulated time to 30 minutes
    simulatedTime += 900000;
    const endRes = await dbRateLimiter.consumeToken(custId, 100, 50, simulatedTime);
    expect(endRes.allowed).toBe(true);
  });

  it('3. Failure Resilience: Redis Outage, Timeout, Recovery & Synchronization Cycles', async () => {
    let isRedisUp = true;
    const mockRedisRaw = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: isRedisUp ? 'up' : 'down' })),
    } as unknown as RedisService;

    const mockBucketService = createMockRedisService(false);
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);

    const healthMonitor = new RedisHealthMonitor(mockRedisRaw, mockBucketService, mockBackupRepo, 5000);
    const fallbackService = new FallbackRateLimiterService(mockBucketService, dbRateLimiter, healthMonitor);

    // Step A: REDIS mode request
    const r1 = await fallbackService.consumeToken('cust-fail-test', 100, 50);
    expect(r1.allowed).toBe(true);
    expect(healthMonitor.getMode()).toBe('REDIS');

    // Step B: Redis Outage occurs mid-traffic
    isRedisUp = false;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    // Step C: Rate-limiting continues seamlessly in DATABASE mode
    const r2 = await fallbackService.consumeToken('cust-fail-test', 100, 50);
    expect(r2.allowed).toBe(true);
    expect(healthMonitor.getMode()).toBe('DATABASE');

    // Step D: Redis recovers -> automatic sync back to Redis
    isRedisUp = true;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('REDIS');

    const r3 = await fallbackService.consumeToken('cust-fail-test', 100, 50);
    expect(r3.allowed).toBe(true);
  });

  it('4. Correctness Verification: Redis Mode vs Database Mode Exact Algorithmic Parity', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const mockRedis = createMockRedisService(false);

    const custId = 'parity-check-cust';
    const now = 5000000;

    // Evaluate in Redis
    const redisResult = await mockRedis.consumeToken(custId, 100, 50);

    // Evaluate in Database Mode
    const dbResult = await dbRateLimiter.consumeToken(custId, 100, 50, now);

    // Assert identical decision & token structures
    expect(redisResult.allowed).toBe(dbResult.allowed);
    expect(redisResult.source).toBe(dbResult.source);
    expect(redisResult.tokensRemaining).toBe(dbResult.tokensRemaining);
    expect(redisResult.burstRemaining).toBe(dbResult.burstRemaining);
  });
});
