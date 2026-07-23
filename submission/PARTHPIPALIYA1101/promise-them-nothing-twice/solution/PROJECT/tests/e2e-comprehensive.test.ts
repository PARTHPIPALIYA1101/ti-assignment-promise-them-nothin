import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createCustomerLookupMiddleware } from '../src/middleware/customer.middleware.js';
import { CustomerRepository } from '../src/repositories/customer.repository.js';
import { RedisRecoveryManager } from '../src/health/redis-recovery.manager.js';
import { BackupRepository } from '../src/repositories/backup.repository.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { NotFoundError, UnauthorizedError } from '../src/utils/app.error.js';

describe('Phase 14: Comprehensive End-to-End & Validation Test Suite', () => {
  const uuidBasic = '10000000-0000-4000-a000-000000000100';
  const uuidPremium = '30000000-0000-4000-a000-000000000300';
  const uuidEnterprise = '90000000-0000-4000-a000-000000000900';

  const createMockCustomerRepo = () => {
    const customers = new Map<string, any>([
      [
        uuidBasic,
        {
          id: uuidBasic,
          name: 'Basic Customer',
          customRpmLimit: null,
          customBurstLimit: null,
          queueEnabled: true,
          plan: { id: 'p1', name: 'BASIC', rpmLimit: 100, burstLimit: 50 },
        },
      ],
      [
        uuidPremium,
        {
          id: uuidPremium,
          name: 'Premium Customer',
          customRpmLimit: null,
          customBurstLimit: null,
          queueEnabled: true,
          plan: { id: 'p2', name: 'PREMIUM', rpmLimit: 300, burstLimit: 100 },
        },
      ],
      [
        uuidEnterprise,
        {
          id: uuidEnterprise,
          name: 'Enterprise VIP',
          customRpmLimit: 1000,
          customBurstLimit: 500,
          queueEnabled: true,
          plan: { id: 'p3', name: 'ENTERPRISE', rpmLimit: 500, burstLimit: 250 },
        },
      ],
    ]);

    return {
      customers,
      findRateLimitContextById: vi.fn().mockImplementation((id: string) => {
        if (id === 'db-error-uuid') return Promise.reject(new Error('PostgreSQL Database Failure'));
        return Promise.resolve(customers.get(id) ?? null);
      }),
    } as unknown as CustomerRepository;
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

  const createMockRedisBucketService = () => {
    const store = new Map<string, any>();
    return {
      store,
      getBucket: vi.fn().mockImplementation((id: string) => Promise.resolve(store.get(id) ?? null)),
      saveBucket: vi.fn().mockImplementation((id: string, data: any) => {
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

  // Section 1: Validation Tests
  describe('Validation Tests', () => {
    it('1. Missing X-Customer-ID header throws UnauthorizedError (401)', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: {} } as FastifyRequest;

      await expect(middleware(req, {} as FastifyReply)).rejects.toThrow(UnauthorizedError);
    });

    it('2. Invalid non-UUID format header throws UnauthorizedError (401)', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: { 'x-customer-id': 'invalid-not-a-uuid' } } as FastifyRequest;

      await expect(middleware(req, {} as FastifyReply)).rejects.toThrow(UnauthorizedError);
    });

    it('3. Non-existent customer UUID throws NotFoundError (404)', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: { 'x-customer-id': '00000000-0000-0000-0000-000000000000' } } as FastifyRequest;

      await expect(middleware(req, {} as FastifyReply)).rejects.toThrow(NotFoundError);
    });
  });

  // Section 2: Plan Tier & Custom Limit Overrides
  describe('Functional Tests: Plan Tiers & Custom Overrides', () => {
    it('1. 100 RPM Basic customer evaluates effective limit of 100 RPM', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: { 'x-customer-id': uuidBasic } } as FastifyRequest;

      await middleware(req, {} as FastifyReply);

      expect(req.customer?.effectiveRpmLimit).toBe(100);
      expect(req.customer?.effectiveBurstLimit).toBe(50);
    });

    it('2. 300 RPM Premium customer evaluates effective limit of 300 RPM', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: { 'x-customer-id': uuidPremium } } as FastifyRequest;

      await middleware(req, {} as FastifyReply);

      expect(req.customer?.effectiveRpmLimit).toBe(300);
      expect(req.customer?.effectiveBurstLimit).toBe(100);
    });

    it('3. Enterprise customer with custom limits overrides default plan RPM and burst ceilings', async () => {
      const mockRepo = createMockCustomerRepo();
      const middleware = createCustomerLookupMiddleware(mockRepo);
      const req = { headers: { 'x-customer-id': uuidEnterprise } } as FastifyRequest;

      await middleware(req, {} as FastifyReply);

      expect(req.customer?.effectiveRpmLimit).toBe(1000);
      expect(req.customer?.effectiveBurstLimit).toBe(500);
    });
  });

  // Section 3: End-to-End System Performance & Failover Benchmarks
  describe('Performance & Failover Benchmarks', () => {
    it('1. Recovery Manager syncs database backups to Redis in sub-500ms', async () => {
      const mockBackupRepo = createMockBackupRepo();
      for (let i = 0; i < 100; i++) {
        await mockBackupRepo.upsertBackup(`e2e-cust-${i}`, 50, 25, new Date());
      }
      const mockBucketService = createMockRedisBucketService();
      const recoveryManager = new RedisRecoveryManager(mockBucketService, mockBackupRepo);

      const start = performance.now();
      const result = await recoveryManager.recoverRedisData();
      const elapsed = performance.now() - start;

      expect(result.syncedCount).toBe(100);
      expect(result.verified).toBe(true);
      expect(elapsed).toBeLessThan(500);
    });
  });
});
