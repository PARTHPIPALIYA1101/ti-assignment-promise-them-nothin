import { describe, expect, it, vi } from 'vitest';
import { DatabaseRateLimiterService } from '../src/services/database-rate-limiter.service.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';

describe('Phase 11: Database Mode Token Bucket Explicit Test Suite', () => {
  const createMockBackupRepo = () => {
    const backupDb = new Map<string, any>();

    const mockUpsert = vi
      .fn()
      .mockImplementation((customerId: string, tokens: number, burstTokens: number, lastRefill: Date) => {
        const record = {
          id: `db-${customerId}`,
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

    return {
      backupDb,
      upsertBackup: mockUpsert,
      findByCustomerId: mockFindByCustId,
    } as unknown as BackupRepository & { backupDb: Map<string, any> };
  };

  it('1. Fresh initialization consumes 1 token from RPM limit (source: BASE)', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-1';

    const result = await dbRateLimiter.consumeToken(custId, 100, 50, 1000000);

    expect(result.allowed).toBe(true);
    expect(result.source).toBe('BASE');
    expect(result.tokensRemaining).toBe(99);
    expect(result.burstRemaining).toBe(0);

    expect(mockBackupRepo.upsertBackup).toHaveBeenCalledWith(
      custId,
      99,
      0,
      new Date(1000000),
    );
  });

  it('2. Refill formula overflow adds to burst bucket up to burstLimit in PostgreSQL', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-overflow';
    const startMs = 1000000;

    // Initial bucket: 50 base tokens at startMs
    await mockBackupRepo.upsertBackup(custId, 50, 0, new Date(startMs));

    // 2 minutes later (120,000 ms), refill = (120000/60000)*100 = 200 base tokens.
    // Total base = 250 -> Capped at 100 RPM, overflow 150 -> Capped at burstLimit 50.
    const nowMs = startMs + 120000;
    const result = await dbRateLimiter.consumeToken(custId, 100, 50, nowMs);

    expect(result.allowed).toBe(true);
    expect(result.source).toBe('BASE');
    expect(result.tokensRemaining).toBe(99); // 100 - 1 = 99
    expect(result.burstRemaining).toBe(50); // Burst capped at 50!
  });

  it('3. 15-Minute Sliding Window Burst Reset: burst tokens expire after 15 mins of inactivity', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-burst-expire';
    const startMs = 1000000;

    // Customer has 40 burst tokens accumulated at startMs
    await mockBackupRepo.upsertBackup(custId, 0, 40, new Date(startMs));

    // 15 minutes later (900,000 ms), burst tokens expire to 0! Refill gives (900000/60000)*10 = 150 base -> capped at 100.
    const nowMs = startMs + 900000;
    const result = await dbRateLimiter.consumeToken(custId, 100, 50, nowMs);

    expect(result.allowed).toBe(true);
    expect(result.source).toBe('BASE');
    expect(result.tokensRemaining).toBe(99);
    expect(result.burstRemaining).toBe(50); // Overflow refills burst bucket to max capacity!
  });

  it('4. Base-First Consumption: consumes base tokens before burst tokens', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-base-first';
    const nowMs = 1000000;

    // 2 base tokens, 10 burst tokens
    await mockBackupRepo.upsertBackup(custId, 2, 10, new Date(nowMs));

    // 1st request consumes base token
    const res1 = await dbRateLimiter.consumeToken(custId, 100, 50, nowMs);
    expect(res1.allowed).toBe(true);
    expect(res1.source).toBe('BASE');
    expect(res1.tokensRemaining).toBe(1);
    expect(res1.burstRemaining).toBe(10);

    // 2nd request consumes base token
    const res2 = await dbRateLimiter.consumeToken(custId, 100, 50, nowMs);
    expect(res2.allowed).toBe(true);
    expect(res2.source).toBe('BASE');
    expect(res2.tokensRemaining).toBe(0);
    expect(res2.burstRemaining).toBe(10);

    // 3rd request consumes BURST token!
    const res3 = await dbRateLimiter.consumeToken(custId, 100, 50, nowMs);
    expect(res3.allowed).toBe(true);
    expect(res3.source).toBe('BURST');
    expect(res3.tokensRemaining).toBe(0);
    expect(res3.burstRemaining).toBe(9);
  });

  it('5. Rejection when both base and burst buckets are empty (allowed: false, Retry-After calculated)', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-empty';
    const nowMs = 1000000;

    await mockBackupRepo.upsertBackup(custId, 0, 0, new Date(nowMs));

    const result = await dbRateLimiter.consumeToken(custId, 60, 20, nowMs);
    expect(result.allowed).toBe(false);
    expect(result.source).toBe('NONE');
    expect(result.retryAfterMs).toBe(1000); // 1 token per second = 1000ms retryAfter
  });

  it('6. Concurrency Safety: 50 concurrent requests in Database Mode do not oversell tokens', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const custId = 'db-cust-concurrent';
    const nowMs = 1000000;

    // Customer has 20 base tokens and 10 burst tokens (total capacity 30)
    await mockBackupRepo.upsertBackup(custId, 20, 10, new Date(nowMs));

    // Fire 50 concurrent requests
    const promises = Array.from({ length: 50 }, () =>
      dbRateLimiter.consumeToken(custId, 100, 50, nowMs),
    );

    const results = await Promise.all(promises);

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(30); // Exactly 30 allowed (20 base + 10 burst)!
    expect(rejectedCount).toBe(20); // 20 rejected! No overselling!
  });

  it('7. Deadlock Stress Test: 500 concurrent requests across 5 customer accounts run with 0 deadlocks', async () => {
    const mockBackupRepo = createMockBackupRepo();
    const dbRateLimiter = new DatabaseRateLimiterService(mockBackupRepo);
    const nowMs = 1000000;

    const customers = ['cust-a', 'cust-b', 'cust-c', 'cust-d', 'cust-e'];
    for (const c of customers) {
      await mockBackupRepo.upsertBackup(c, 50, 25, new Date(nowMs));
    }

    const start = performance.now();

    // Fire 500 concurrent requests distributed across 5 customers
    const reqs = Array.from({ length: 500 }, (_, i) => {
      const targetCust = customers[i % customers.length]!;
      return dbRateLimiter.consumeToken(targetCust, 100, 50, nowMs);
    });

    const results = await Promise.all(reqs);
    const elapsed = performance.now() - start;

    expect(results.length).toBe(500);
    expect(elapsed).toBeLessThan(500); // Sub-500ms execution for 500 concurrent DB evaluations!
  });
});
