import { describe, expect, it, vi } from 'vitest';
import { RedisHealthMonitor } from '../src/health/redis-health.monitor.js';
import { FallbackRateLimiterService } from '../src/services/fallback-rate-limiter.service.js';
import { DatabaseRateLimiterService } from '../src/services/database-rate-limiter.service.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Phase 10: Redis Health Monitor & Database Mode Fallback Test Suite', () => {
  const createMockRedisService = (status: 'up' | 'down') => {
    return {
      checkHealth: vi.fn().mockResolvedValue({ status }),
    } as unknown as RedisService;
  };

  const createMockBucketRedisService = (throwError = false) => {
    const store = new Map<string, any>();
    return {
      store,
      getBucket: vi.fn().mockImplementation((id: string) => Promise.resolve(store.get(id) ?? null)),
      saveBucket: vi.fn().mockImplementation((id: string, data: any) => {
        store.set(id, data);
        return Promise.resolve();
      }),
      consumeToken: vi.fn().mockImplementation((id: string, rpm: number) => {
        if (throwError) return Promise.reject(new Error('Redis Connection Failure'));
        let b = store.get(id);
        let tokens = b ? b.tokens : rpm;
        let allowed = false;
        if (tokens >= 1) {
          tokens -= 1;
          allowed = true;
        }
        store.set(id, { tokens, burstTokens: 0, lastRefill: Date.now() });
        return Promise.resolve({
          allowed,
          source: allowed ? 'BASE' : 'NONE',
          tokensRemaining: tokens,
          burstRemaining: 0,
        });
      }),
    } as unknown as BucketRedisService & { store: Map<string, any> };
  };

  const createMockBackupRepo = () => {
    const db = new Map<string, any>();
    return {
      db,
      upsertBackup: vi.fn().mockImplementation((customerId: string, tokens: number, burstTokens: number, lastRefill: Date) => {
        const rec = { customerId, tokens, burstTokens, lastRefill, updatedAt: new Date() };
        db.set(customerId, rec);
        return Promise.resolve(rec);
      }),
      findByCustomerId: vi.fn().mockImplementation((id: string) => Promise.resolve(db.get(id) ?? null)),
      findAllBackups: vi.fn().mockImplementation(() => Promise.resolve(Array.from(db.values()))),
    } as unknown as BackupRepository & { db: Map<string, any> };
  };

  it('1. Redis ping succeeds during normal operation (REDIS mode)', async () => {
    const mockRedisService = createMockRedisService('up');
    const healthMonitor = new RedisHealthMonitor(mockRedisService, undefined, undefined, 5000);

    expect(healthMonitor.getMode()).toBe('REDIS');

    const healthy = await healthMonitor.checkHealth();
    expect(healthy).toBe(true);
    expect(healthMonitor.getMode()).toBe('REDIS');
  });

  it('2. Outage detected within health check interval (5s) -> switches mode to DATABASE', async () => {
    const mockRedisService = createMockRedisService('down');
    const healthMonitor = new RedisHealthMonitor(mockRedisService, undefined, undefined, 5000);

    expect(healthMonitor.getMode()).toBe('REDIS');

    const healthy = await healthMonitor.checkHealth();
    expect(healthy).toBe(false);
    expect(healthMonitor.getMode()).toBe('DATABASE');
  });

  it('3. FallbackRateLimiterService continues rate limiting in Database Mode on Redis failure', async () => {
    const custId = 'cust-fallback-1';
    const mockRedisService = createMockRedisService('down');
    const mockBucketService = createMockBucketRedisService(true);
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    const fallbackService = new FallbackRateLimiterService(mockBucketService, dbRateLimiter, healthMonitor);

    const res1 = await fallbackService.consumeToken(custId, 100, 50);
    expect(res1.allowed).toBe(true);
    expect(healthMonitor.getMode()).toBe('DATABASE');

    const res2 = await fallbackService.consumeToken(custId, 100, 50);
    expect(res2.allowed).toBe(true);
    expect(mockBackupRepo.upsertBackup).toHaveBeenLastCalledWith(
      custId,
      expect.any(Number),
      0,
      expect.any(Date),
    );
  });

  it('4. Automatic Recovery Sync: when Redis recovers, PostgreSQL backups sync back to Redis and mode returns to REDIS', async () => {
    let redisStatus: 'up' | 'down' = 'down';
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: redisStatus })),
    } as unknown as RedisService;

    const mockBucketService = createMockBucketRedisService(false);
    const mockBackupRepo = createMockBackupRepo();

    await mockBackupRepo.upsertBackup('cust-sync-1', 45, 15, new Date(1000000));
    await mockBackupRepo.upsertBackup('cust-sync-2', 80, 20, new Date(1000000));

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    await healthMonitor.transitionToDatabaseMode();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    redisStatus = 'up';
    const healthy = await healthMonitor.checkHealth();

    expect(healthy).toBe(true);
    expect(healthMonitor.getMode()).toBe('REDIS');

    const synced1 = await mockBucketService.getBucket('cust-sync-1');
    const synced2 = await mockBucketService.getBucket('cust-sync-2');

    expect(synced1?.tokens).toBe(45);
    expect(synced2?.tokens).toBe(80);
  });

  it('5. Multiple disconnect/reconnect cycles transition modes cleanly without errors', async () => {
    let redisStatus: 'up' | 'down' = 'up';
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: redisStatus })),
    } as unknown as RedisService;

    const mockBucketService = createMockBucketRedisService(false);
    const mockBackupRepo = createMockBackupRepo();

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);

    redisStatus = 'down';
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    redisStatus = 'up';
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('REDIS');

    redisStatus = 'down';
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    redisStatus = 'up';
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('REDIS');
  });

  it('6. Atomic Failover Transition Lock under 100+ concurrent requests: zero request loss or split-brain', async () => {
    const custId = 'cust-atomic-failover';
    const mockRedisService = createMockRedisService('down');
    const mockBucketService = createMockBucketRedisService(true);
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    const fallbackService = new FallbackRateLimiterService(mockBucketService, dbRateLimiter, healthMonitor);

    const reqs = Array.from({ length: 100 }, () =>
      fallbackService.consumeToken(custId, 100, 50),
    );

    const results = await Promise.all(reqs);

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(100);
    expect(healthMonitor.getMode()).toBe('DATABASE');
  });
});
