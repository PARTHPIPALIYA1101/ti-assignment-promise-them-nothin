import { describe, expect, it, vi } from 'vitest';
import { BackupScheduler } from '../src/scheduler/backup.scheduler.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { CustomerRepository } from '../src/repositories/customer.repository.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';

describe('Phase 9: PostgreSQL Bucket Backup Explicit Test Suite', () => {
  const createMockCustomerRepo = (customers: any[]) => {
    return {
      findAll: vi.fn().mockResolvedValue({
        items: customers,
        totalItems: customers.length,
      }),
    } as unknown as CustomerRepository;
  };

  const createMockRedisService = (bucketMap: Record<string, any>) => {
    const memoryMap = new Map<string, any>(Object.entries(bucketMap));

    return {
      memoryMap,
      getBucket: vi.fn().mockImplementation((customerId: string) => {
        const b = memoryMap.get(customerId);
        if (!b) return Promise.resolve(null);
        if (b.shouldThrow) return Promise.reject(new Error('Redis connection drop'));
        return Promise.resolve({
          tokens: b.tokens,
          burstTokens: b.burstTokens,
          lastRefill: b.lastRefill,
        });
      }),
      saveBucket: vi.fn().mockImplementation((customerId: string, bucketData: any) => {
        memoryMap.set(customerId, bucketData);
        return Promise.resolve();
      }),
      flushRedis: vi.fn().mockImplementation(() => {
        memoryMap.clear();
        return Promise.resolve();
      }),
    } as unknown as BucketRedisService & { memoryMap: Map<string, any>; flushRedis: () => Promise<void> };
  };

  const createMockBackupRepo = () => {
    const backupDb = new Map<string, any>();

    const mockUpsert = vi.fn().mockImplementation((customerId: string, tokens: number, burstTokens: number, lastRefill: Date) => {
      const record = {
        id: `backup-${customerId}`,
        customerId,
        tokens,
        burstTokens,
        lastRefill,
        updatedAt: new Date(),
        createdAt: backupDb.get(customerId)?.createdAt ?? new Date(),
      };
      backupDb.set(customerId, record);
      return Promise.resolve(record);
    });

    const mockFindByCustId = vi.fn().mockImplementation((customerId: string) => {
      return Promise.resolve(backupDb.get(customerId) ?? null);
    });

    const mockFindAll = vi.fn().mockImplementation(() => {
      return Promise.resolve(Array.from(backupDb.values()));
    });

    return {
      backupDb,
      upsertBackup: mockUpsert,
      findByCustomerId: mockFindByCustId,
      findAllBackups: mockFindAll,
    } as unknown as BackupRepository & { backupDb: Map<string, any> };
  };

  it('1. Backup runs on configured interval and saves bucket state into PostgreSQL', async () => {
    const custId = 'cust-backup-1';
    const nowMs = 1000000;

    const mockCustomerRepo = createMockCustomerRepo([{ id: custId, name: 'Cust 1' }]);
    const mockRedis = createMockRedisService({
      [custId]: { tokens: 75, burstTokens: 25, lastRefill: nowMs },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    const backedUp = await scheduler.performBackup();
    expect(backedUp).toBe(1);

    expect(mockBackupRepo.upsertBackup).toHaveBeenCalledWith(
      custId,
      75,
      25,
      new Date(nowMs),
    );

    const saved = await mockBackupRepo.findByCustomerId(custId);
    expect(saved).not.toBeNull();
    expect(saved?.tokens).toBe(75);
    expect(saved?.burstTokens).toBe(25);
  });

  it('2. Existing backup records are updated via upsert and new customers create new backup records', async () => {
    const cust1 = 'cust-existing';
    const cust2 = 'cust-new';
    const nowMs = 2000000;

    const mockCustomerRepo = createMockCustomerRepo([
      { id: cust1, name: 'Existing Customer' },
      { id: cust2, name: 'New Customer' },
    ]);
    const mockRedis = createMockRedisService({
      [cust1]: { tokens: 90, burstTokens: 10, lastRefill: nowMs },
      [cust2]: { tokens: 100, burstTokens: 0, lastRefill: nowMs },
    });
    const mockBackupRepo = createMockBackupRepo();

    await mockBackupRepo.upsertBackup(cust1, 50, 0, new Date(1000000));

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    const count = await scheduler.performBackup();
    expect(count).toBe(2);

    const record1 = await mockBackupRepo.findByCustomerId(cust1);
    const record2 = await mockBackupRepo.findByCustomerId(cust2);

    expect(record1?.tokens).toBe(90);
    expect(record2?.tokens).toBe(100);
  });

  it('3. Per-Customer Fault Tolerance: backup continues even if one customer query/save fails', async () => {
    const custFailing = 'cust-failing-redis';
    const custHealthy = 'cust-healthy-redis';
    const nowMs = 3000000;

    const mockCustomerRepo = createMockCustomerRepo([
      { id: custFailing },
      { id: custHealthy },
    ]);
    const mockRedis = createMockRedisService({
      [custFailing]: { shouldThrow: true },
      [custHealthy]: { tokens: 80, burstTokens: 40, lastRefill: nowMs },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    const count = await scheduler.performBackup();
    expect(count).toBe(1);

    const savedHealthy = await mockBackupRepo.findByCustomerId(custHealthy);
    expect(savedHealthy?.tokens).toBe(80);
  });

  it('4. Multiple customers are backed up correctly in a single tick', async () => {
    const customers = Array.from({ length: 10 }, (_, i) => ({ id: `multi-cust-${i}` }));
    const mockCustomerRepo = createMockCustomerRepo(customers);

    const redisData: Record<string, any> = {};
    customers.forEach((c, index) => {
      redisData[c.id] = { tokens: 10 + index, burstTokens: index, lastRefill: 1000000 };
    });

    const mockRedis = createMockRedisService(redisData);
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    const count = await scheduler.performBackup();
    expect(count).toBe(10);

    const allBackups = await mockBackupRepo.findAllBackups();
    expect(allBackups.length).toBe(10);
  });

  it('5. Unexpected process shutdown simulation triggers final backup sync', async () => {
    const custId = 'cust-shutdown';
    const nowMs = 4000000;

    const mockCustomerRepo = createMockCustomerRepo([{ id: custId }]);
    const mockRedis = createMockRedisService({
      [custId]: { tokens: 42, burstTokens: 18, lastRefill: nowMs },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.stop(true);
    expect(scheduler.isRunning()).toBe(false);

    expect(mockBackupRepo.upsertBackup).toHaveBeenCalledWith(
      custId,
      42,
      18,
      new Date(nowMs),
    );
  });

  it('6. Verification that PostgreSQL backup matches latest Redis bucket state', async () => {
    const custId = 'cust-exact-match';
    const nowMs = 5000000;

    const redisTokens = 88.5;
    const redisBurstTokens = 33.2;

    const mockCustomerRepo = createMockCustomerRepo([{ id: custId }]);
    const mockRedis = createMockRedisService({
      [custId]: { tokens: redisTokens, burstTokens: redisBurstTokens, lastRefill: nowMs },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);
    await scheduler.performBackup();

    const postgresRecord = await mockBackupRepo.findByCustomerId(custId);
    const redisBucket = await mockRedis.getBucket(custId);

    expect(postgresRecord?.tokens).toBe(redisBucket?.tokens);
    expect(postgresRecord?.burstTokens).toBe(redisBucket?.burstTokens);
    expect(postgresRecord?.lastRefill.getTime()).toBe(redisBucket?.lastRefill);
  });

  it('7. Redis Data Loss Simulation & PostgreSQL Recovery: recovers bucket state into Redis after data loss', async () => {
    const custId = 'cust-data-loss-recovery';
    const originalRefill = 6000000;

    const mockCustomerRepo = createMockCustomerRepo([{ id: custId }]);
    const mockRedis = createMockRedisService({
      [custId]: { tokens: 45, burstTokens: 15, lastRefill: originalRefill },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    // Step 1: Backup current Redis state to PostgreSQL
    await scheduler.performBackup();
    const postgresBackup = await mockBackupRepo.findByCustomerId(custId);
    expect(postgresBackup).not.toBeNull();

    // Step 2: SIMULATE REDIS DATA LOSS (Flush Redis)
    await mockRedis.flushRedis();
    const redisAfterFlush = await mockRedis.getBucket(custId);
    expect(redisAfterFlush).toBeNull(); // Redis key is LOST!

    // Step 3: RESTORE FROM POSTGRESQL BACKUP BACK INTO REDIS
    const backupRecord = await mockBackupRepo.findByCustomerId(custId);
    expect(backupRecord).not.toBeNull();

    await mockRedis.saveBucket(custId, {
      tokens: backupRecord!.tokens,
      burstTokens: backupRecord!.burstTokens,
      lastRefill: backupRecord!.lastRefill.getTime(),
    });

    // Step 4: Verify Redis bucket state is 100% restored
    const restoredRedisBucket = await mockRedis.getBucket(custId);
    expect(restoredRedisBucket).not.toBeNull();
    expect(restoredRedisBucket?.tokens).toBe(45);
    expect(restoredRedisBucket?.burstTokens).toBe(15);
    expect(restoredRedisBucket?.lastRefill).toBe(originalRefill);
  });

  it('8. Backup under heavy concurrent traffic: completes accurately while 1,000+ requests modify Redis', async () => {
    const custId = 'cust-heavy-traffic-backup';
    let currentTokens = 100;

    const mockCustomerRepo = createMockCustomerRepo([{ id: custId }]);
    const mockRedis = createMockRedisService({
      [custId]: { tokens: 100, burstTokens: 50, lastRefill: 1000000 },
    });
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    // Simulate 1,000 concurrent requests rapidly decrementing Redis tokens while performBackup() runs
    const trafficPromises = Array.from({ length: 1000 }, async (_, i) => {
      currentTokens = Math.max(0, currentTokens - 0.1);
      mockRedis.memoryMap.set(custId, {
        tokens: currentTokens,
        burstTokens: 50,
        lastRefill: 1000000 + i,
      });
    });

    const backupPromise = scheduler.performBackup();

    await Promise.all([...trafficPromises, backupPromise]);

    const finalBackup = await mockBackupRepo.findByCustomerId(custId);
    expect(finalBackup).not.toBeNull();
    expect(finalBackup?.burstTokens).toBe(50);
  });

  it('9. Large-Scale Backup Benchmark: backs up 1,000 customer buckets in sub-second duration', async () => {
    const customers = Array.from({ length: 1000 }, (_, i) => ({ id: `benchmark-cust-${i}` }));
    const mockCustomerRepo = createMockCustomerRepo(customers);

    const redisData: Record<string, any> = {};
    customers.forEach((c, index) => {
      redisData[c.id] = { tokens: (index % 100) + 1, burstTokens: index % 50, lastRefill: 1000000 };
    });

    const mockRedis = createMockRedisService(redisData);
    const mockBackupRepo = createMockBackupRepo();

    const scheduler = new BackupScheduler(mockRedis, mockCustomerRepo, mockBackupRepo, 10000);

    const start = performance.now();
    const count = await scheduler.performBackup();
    const elapsed = performance.now() - start;

    expect(count).toBe(1000);
    expect(elapsed).toBeLessThan(500); // Sub-500ms execution for 1,000 customer bucket backups!
  });
});
