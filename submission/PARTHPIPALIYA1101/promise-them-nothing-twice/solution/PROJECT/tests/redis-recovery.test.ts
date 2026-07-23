import { describe, expect, it, vi } from 'vitest';
import { RedisRecoveryManager } from '../src/health/redis-recovery.manager.js';
import { RedisHealthMonitor } from '../src/health/redis-health.monitor.js';
import { FallbackRateLimiterService } from '../src/services/fallback-rate-limiter.service.js';
import { DatabaseRateLimiterService } from '../src/services/database-rate-limiter.service.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';
import { RedisService } from '../src/redis/redis.service.js';

describe('Phase 12: Dedicated Redis Recovery Manager & Synchronization Test Suite', () => {
  const createMockBackupRepo = (initialBackups: Record<string, any> = {}) => {
    const backupDb = new Map<string, any>();
    for (const [id, data] of Object.entries(initialBackups)) {
      backupDb.set(id, { customerId: id, tokens: data.tokens, burstTokens: data.burstTokens, lastRefill: new Date(data.lastRefill) });
    }

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

  const createMockBucketService = (failOnCustId?: string) => {
    const store = new Map<string, any>();

    return {
      store,
      getBucket: vi.fn().mockImplementation((id: string) => Promise.resolve(store.get(id) ?? null)),
      saveBucket: vi.fn().mockImplementation((id: string, data: any) => {
        if (failOnCustId && id === failOnCustId) {
          return Promise.reject(new Error('Partial Recovery Redis Error on Customer'));
        }
        store.set(id, data);
        return Promise.resolve();
      }),
      consumeToken: vi.fn().mockImplementation((id: string, rpm: number) => {
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

  it('1. RedisRecoveryManager detects recovery, loads backups from PostgreSQL, and restores to Redis', async () => {
    const mockBackupRepo = createMockBackupRepo({
      'rec-cust-1': { tokens: 75, burstTokens: 25, lastRefill: 1000000 },
      'rec-cust-2': { tokens: 90, burstTokens: 10, lastRefill: 1000000 },
    });
    const mockBucketService = createMockBucketService();

    const recoveryManager = new RedisRecoveryManager(mockBucketService, mockBackupRepo);

    const result = await recoveryManager.recoverRedisData();

    expect(result.syncedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.verified).toBe(true);

    const b1 = await mockBucketService.getBucket('rec-cust-1');
    const b2 = await mockBucketService.getBucket('rec-cust-2');

    expect(b1?.tokens).toBe(75);
    expect(b2?.tokens).toBe(90);
  });

  it('2. Data Synchronization Verification verifies PostgreSQL ↔ Redis parity', async () => {
    const mockBackupRepo = createMockBackupRepo({
      'sync-verif-1': { tokens: 88, burstTokens: 12, lastRefill: 2000000 },
    });
    const mockBucketService = createMockBucketService();

    const recoveryManager = new RedisRecoveryManager(mockBucketService, mockBackupRepo);

    // Before recovery: Redis is empty -> verify fails
    const verifiedBefore = await recoveryManager.verifySynchronization();
    expect(verifiedBefore).toBe(false);

    // Recover data into Redis
    await recoveryManager.recoverRedisData();

    // After recovery: verify passes
    const verifiedAfter = await recoveryManager.verifySynchronization();
    expect(verifiedAfter).toBe(true);
  });

  it('3. Automatic switch back to REDIS Mode when recovery & synchronization succeed', async () => {
    let isRedisHealthy = false;
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: isRedisHealthy ? 'up' : 'down' })),
    } as unknown as RedisService;

    const mockBackupRepo = createMockBackupRepo({
      'switch-cust-1': { tokens: 60, burstTokens: 20, lastRefill: 1000000 },
    });
    const mockBucketService = createMockBucketService();

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    await healthMonitor.transitionToDatabaseMode();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    // Simulate Redis coming back online
    isRedisHealthy = true;
    const healthy = await healthMonitor.checkHealth();

    expect(healthy).toBe(true);
    expect(healthMonitor.getMode()).toBe('REDIS');
  });

  it('4. Partial Recovery Failure Handling: error on Customer A continues restoring Customer B and defers mode switch', async () => {
    let isRedisHealthy = false;
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: isRedisHealthy ? 'up' : 'down' })),
    } as unknown as RedisService;

    const mockBackupRepo = createMockBackupRepo({
      'fail-cust-A': { tokens: 50, burstTokens: 0, lastRefill: 1000000 }, // Will fail on Redis write
      'healthy-cust-B': { tokens: 80, burstTokens: 0, lastRefill: 1000000 },
    });

    // Mock bucket service fails specifically on fail-cust-A
    const mockBucketService = createMockBucketService('fail-cust-A');

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    await healthMonitor.transitionToDatabaseMode();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    // Trigger recovery
    isRedisHealthy = true;
    await healthMonitor.checkHealth();

    // Mode switch back to REDIS is DEFERRED because Customer A failed restoration!
    expect(healthMonitor.getMode()).toBe('DATABASE');

    // But Customer B WAS restored successfully!
    const healthyB = await mockBucketService.getBucket('healthy-cust-B');
    expect(healthyB?.tokens).toBe(80);
  });

  it('5. Zero Request Loss Under Concurrent Recovery Traffic (100+ concurrent requests mid-flight)', async () => {
    let isRedisHealthy = false;
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: isRedisHealthy ? 'up' : 'down' })),
    } as unknown as RedisService;

    const mockBackupRepo = createMockBackupRepo({
      'concurrent-rec-cust': { tokens: 100, burstTokens: 50, lastRefill: 1000000 },
    });
    const mockBucketService = createMockBucketService();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);
    const fallbackService = new FallbackRateLimiterService(mockBucketService, dbRateLimiter, healthMonitor);

    await healthMonitor.transitionToDatabaseMode();

    // Fire 100 concurrent requests while recovery is triggered in parallel
    const reqs = Array.from({ length: 100 }, () => fallbackService.consumeToken('concurrent-rec-cust', 100, 50));

    isRedisHealthy = true;
    const recoveryTask = healthMonitor.checkHealth();

    const results = await Promise.all([...reqs, recoveryTask]);
    const rateLimiterResults = results.slice(0, 100) as any[];

    // All 100 requests served without loss or error
    expect(rateLimiterResults.length).toBe(100);
    expect(rateLimiterResults.every((r) => r.allowed !== undefined)).toBe(true);
    expect(healthMonitor.getMode()).toBe('REDIS');
  });

  it('6. Multiple consecutive outage/recovery cycles recover cleanly every time', async () => {
    let isRedisHealthy = true;
    const mockRedisService = {
      checkHealth: vi.fn().mockImplementation(() => Promise.resolve({ status: isRedisHealthy ? 'up' : 'down' })),
    } as unknown as RedisService;

    const mockBackupRepo = createMockBackupRepo({
      'multi-cycle-cust': { tokens: 95, burstTokens: 5, lastRefill: 1000000 },
    });
    const mockBucketService = createMockBucketService();

    const healthMonitor = new RedisHealthMonitor(mockRedisService, mockBucketService, mockBackupRepo, 5000);

    // Cycle 1
    isRedisHealthy = false;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    isRedisHealthy = true;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('REDIS');

    // Cycle 2
    isRedisHealthy = false;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('DATABASE');

    isRedisHealthy = true;
    await healthMonitor.checkHealth();
    expect(healthMonitor.getMode()).toBe('REDIS');
  });
});
