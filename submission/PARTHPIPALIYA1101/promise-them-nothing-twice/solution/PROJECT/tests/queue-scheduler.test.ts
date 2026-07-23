import { describe, expect, it, vi } from 'vitest';
import { QueueScheduler } from '../src/scheduler/queue.scheduler.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { CustomerRepository } from '../src/repositories/customer.repository.js';
import { RequestQueueManager } from '../src/queue/request.queue.js';

describe('Phase 8: Queue Scheduler Explicit Test Suite', () => {
  const createMockRepo = (mockContextMap: Record<string, any>): CustomerRepository => {
    return {
      findRateLimitContextById: vi.fn().mockImplementation((id: string) => {
        const ctx = mockContextMap[id];
        if (!ctx) return Promise.resolve(null);
        if (ctx.shouldThrow) return Promise.reject(new Error('DB error for customer'));
        return Promise.resolve({
          id,
          customRpmLimit: ctx.customRpmLimit ?? null,
          customBurstLimit: ctx.customBurstLimit ?? null,
          queueEnabled: true,
          plan: {
            id: 'p1',
            name: ctx.planName ?? 'BASIC',
            rpmLimit: ctx.rpmLimit ?? 100,
            burstLimit: ctx.burstLimit ?? 50,
          },
        });
      }),
    } as unknown as CustomerRepository;
  };

  const createMockBucketService = (allowedCustomerIdSet: Set<string>): BucketRedisService => {
    return {
      consumeToken: vi.fn().mockImplementation((customerId: string) => {
        const allowed = allowedCustomerIdSet.has(customerId);
        return Promise.resolve({
          allowed,
          source: allowed ? 'BASE' : 'NONE',
          tokensRemaining: allowed ? 10 : 0,
          burstRemaining: 0,
        });
      }),
    } as unknown as BucketRedisService;
  };

  it('1. Scheduler processes active queues and releases queued requests when tokens become available', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'sched-cust-1';

    const p1 = queueManager.enqueue(custId, 'r1', 5000);
    const p2 = queueManager.enqueue(custId, 'r2', 5000);

    expect(queueManager.getQueueSize(custId)).toBe(2);

    const mockRepo = createMockRepo({ [custId]: { rpmLimit: 100 } });
    const mockBucket = createMockBucketService(new Set([custId]));

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    const releasedCount = await scheduler.processQueues();
    expect(releasedCount).toBe(2);
    expect(queueManager.getQueueSize(custId)).toBe(0);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
  });

  it('2. Scheduler skips empty queues cleanly', async () => {
    const queueManager = new RequestQueueManager();
    const mockRepo = createMockRepo({});
    const mockBucket = createMockBucketService(new Set());

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    const releasedCount = await scheduler.processQueues();
    expect(releasedCount).toBe(0);
    expect(mockRepo.findRateLimitContextById).not.toHaveBeenCalled();
  });

  it('3. Multiple customer queues are processed independently', async () => {
    const queueManager = new RequestQueueManager();
    const custA = 'sched-cust-A';
    const custB = 'sched-cust-B';

    const pA = queueManager.enqueue(custA, 'req-a1', 5000);
    const pB = queueManager.enqueue(custB, 'req-b1', 5000);

    // Only Customer A has tokens available
    const mockRepo = createMockRepo({
      [custA]: { rpmLimit: 100 },
      [custB]: { rpmLimit: 100 },
    });
    const mockBucket = createMockBucketService(new Set([custA]));

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    const releasedCount = await scheduler.processQueues();
    expect(releasedCount).toBe(1);
    expect(queueManager.getQueueSize(custA)).toBe(0);
    expect(queueManager.getQueueSize(custB)).toBe(1); // Customer B stays queued

    const resA = await pA;
    expect(resA).toBe(true);

    queueManager.clearAllQueues();
    await pB;
  });

  it('4. Re-entrancy Lock (Overlap Prevention): skips tick if previous tick is still processing', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'sched-cust-lock';

    queueManager.enqueue(custId, 'req-lock', 5000);

    // Create a slow repo call that delays processing
    let resolveSlowCall: (v: any) => void;
    const slowRepo = {
      findRateLimitContextById: vi.fn().mockImplementation(() => {
        return new Promise((r) => {
          resolveSlowCall = r;
        });
      }),
    } as unknown as CustomerRepository;

    const mockBucket = createMockBucketService(new Set([custId]));
    const scheduler = new QueueScheduler(mockBucket, slowRepo, queueManager, 100);

    // Start 1st tick (will pause on slowRepo call)
    const tick1 = scheduler.processQueues();

    // Fire 2nd tick immediately while 1st tick is still running
    const tick2Released = await scheduler.processQueues();
    expect(tick2Released).toBe(0); // Skipped due to re-entrancy lock!

    // Resolve 1st tick
    resolveSlowCall!({
      id: custId,
      customRpmLimit: null,
      customBurstLimit: null,
      plan: { id: 'p1', name: 'BASIC', rpmLimit: 100, burstLimit: 50 },
    });

    await tick1;
    queueManager.clearAllQueues();
  });

  it('5. Per-Customer Fault Tolerance: error on Customer A does not stop Customer B from processing', async () => {
    const queueManager = new RequestQueueManager();
    const custFailing = 'cust-failing';
    const custHealthy = 'cust-healthy';

    const pFail = queueManager.enqueue(custFailing, 'req-fail', 5000);
    const pHealth = queueManager.enqueue(custHealthy, 'req-health', 5000);

    const mockRepo = createMockRepo({
      [custFailing]: { shouldThrow: true },
      [custHealthy]: { rpmLimit: 100 },
    });
    const mockBucket = createMockBucketService(new Set([custHealthy]));

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    const released = await scheduler.processQueues();
    expect(released).toBe(1); // Healthy customer released despite Customer A error!

    expect(queueManager.getQueueSize(custHealthy)).toBe(0);
    expect(await pHealth).toBe(true);

    queueManager.clearAllQueues();
    await pFail;
  });

  it('6. Idempotent start() worker protection: calling start() multiple times does not create duplicate workers', () => {
    const queueManager = new RequestQueueManager();
    const mockRepo = createMockRepo({});
    const mockBucket = createMockBucketService(new Set());

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    expect(scheduler.isRunning()).toBe(false);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    // Call start() a 2nd time -> Ignored cleanly
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('7. Clean stop() shutdown: clears interval timer and resets state', () => {
    const queueManager = new RequestQueueManager();
    const mockRepo = createMockRepo({});
    const mockBucket = createMockBucketService(new Set());

    const scheduler = new QueueScheduler(mockBucket, mockRepo, queueManager, 100);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);

    // Repeated stop() calls are safe
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});
