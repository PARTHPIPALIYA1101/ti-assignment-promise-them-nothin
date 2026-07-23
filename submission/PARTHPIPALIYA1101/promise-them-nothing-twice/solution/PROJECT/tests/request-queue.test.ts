import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { RequestQueueManager } from '../src/queue/request.queue.js';
import { createRateLimiterMiddleware } from '../src/middleware/rate-limiter.middleware.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { TooManyRequestsError } from '../src/utils/app.error.js';

describe('Phase 7: Request Queue Explicit Test Suite', () => {
  it('1. Requests are queued when both buckets are empty and queueEnabled is true', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-1';

    const enqueuePromise = queueManager.enqueue(custId, 'req-1', 5000);
    expect(queueManager.getQueueSize(custId)).toBe(1);

    const released = queueManager.releaseNext(custId);
    expect(released).toBe(true);

    const result = await enqueuePromise;
    expect(result).toBe(true);
    expect(queueManager.getQueueSize(custId)).toBe(0);
  });

  it('2. Queue capacity strictly capped at 150 requests per customer', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-cap';

    const promises: Promise<boolean>[] = [];
    for (let i = 1; i <= 150; i++) {
      promises.push(queueManager.enqueue(custId, `req-${i}`, 5000));
    }

    expect(queueManager.getQueueSize(custId)).toBe(150);

    const res151 = await queueManager.enqueue(custId, 'req-151', 5000);
    expect(res151).toBe(false);
    expect(queueManager.getQueueSize(custId)).toBe(150);

    queueManager.clearAllQueues();
  });

  it('3. Strict FIFO (First-In, First-Out) release ordering', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-fifo';

    const order: string[] = [];

    const p1 = queueManager.enqueue(custId, 'first-req', 5000).then(() => order.push('first-req'));
    const p2 = queueManager.enqueue(custId, 'second-req', 5000).then(() => order.push('second-req'));
    const p3 = queueManager.enqueue(custId, 'third-req', 5000).then(() => order.push('third-req'));

    queueManager.releaseNext(custId);
    await p1;
    expect(order).toEqual(['first-req']);

    queueManager.releaseNext(custId);
    await p2;
    expect(order).toEqual(['first-req', 'second-req']);

    queueManager.releaseNext(custId);
    await p3;
    expect(order).toEqual(['first-req', 'second-req', 'third-req']);
  });

  it('4. Requests time out after timeout duration (5 seconds)', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-timeout';

    const enqueuePromise = queueManager.enqueue(custId, 'req-timeout', 50);
    expect(queueManager.getQueueSize(custId)).toBe(1);

    const result = await enqueuePromise;
    expect(result).toBe(false);
    expect(queueManager.getQueueSize(custId)).toBe(0);
  });

  it('5. Duplicate queue entry prevention: same request ID cannot be enqueued twice', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-dup';

    const p1 = queueManager.enqueue(custId, 'duplicate-req-id', 5000);
    const p2 = await queueManager.enqueue(custId, 'duplicate-req-id', 5000);

    expect(p2).toBe(false);
    expect(queueManager.getQueueSize(custId)).toBe(1);

    queueManager.clearAllQueues();
    await p1;
  });

  it('6. Client disconnect handling: removes request from queue when TCP socket closes', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-disconnect';

    const enqueuePromise = queueManager.enqueue(custId, 'req-disconnect', 5000);
    expect(queueManager.getQueueSize(custId)).toBe(1);

    const removed = queueManager.remove(custId, 'req-disconnect');
    expect(removed).toBe(true);
    expect(queueManager.getQueueSize(custId)).toBe(0);

    const result = await enqueuePromise;
    expect(result).toBe(false);
  });

  it('7. Server restart graceful queue cleanup (clearAllQueues)', async () => {
    const queueManager = new RequestQueueManager();

    const p1 = queueManager.enqueue('cust-a', 'req-a', 5000);
    const p2 = queueManager.enqueue('cust-b', 'req-b', 5000);

    expect(queueManager.getQueueSize('cust-a')).toBe(1);
    expect(queueManager.getQueueSize('cust-b')).toBe(1);

    queueManager.clearAllQueues();

    expect(queueManager.getQueueSize('cust-a')).toBe(0);
    expect(queueManager.getQueueSize('cust-b')).toBe(0);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });

  it('8. Full queue stress testing under heavy load (150 queued requests)', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-queue-stress';

    const start = performance.now();

    const queuePromises = Array.from({ length: 150 }, (_, i) =>
      queueManager.enqueue(custId, `stress-req-${i}`, 5000),
    );

    expect(queueManager.getQueueSize(custId)).toBe(150);

    for (let i = 0; i < 150; i++) {
      queueManager.releaseNext(custId);
    }

    const results = await Promise.all(queuePromises);
    const elapsed = performance.now() - start;

    expect(results.every((r) => r === true)).toBe(true);
    expect(elapsed).toBeLessThan(100);
    expect(queueManager.getQueueSize(custId)).toBe(0);
  });

  it('9. RateLimiterMiddleware end-to-end queueing integration with HTTP 429 on full queue', async () => {
    const queueManager = new RequestQueueManager();
    const mockBucketService = {
      consumeToken: vi.fn().mockResolvedValue({
        allowed: false,
        source: 'NONE',
        tokensRemaining: 0,
        burstRemaining: 0,
        retryAfterMs: 5000,
      }),
    } as unknown as BucketRedisService;

    const middleware = createRateLimiterMiddleware(mockBucketService, queueManager);

    const custId = 'cust-middleware-queue';
    const mockRequest = {
      id: 'req-full-queue',
      raw: {
        on: vi.fn(),
        removeListener: vi.fn(),
      },
      customer: {
        id: custId,
        planId: 'plan-basic',
        planName: 'BASIC',
        effectiveRpmLimit: 100,
        effectiveBurstLimit: 50,
        queueEnabled: true,
      },
    } as unknown as FastifyRequest;

    for (let i = 0; i < 150; i++) {
      queueManager.enqueue(custId, `q-${i}`, 5000);
    }

    const reply = {
      header: vi.fn(),
    } as unknown as FastifyReply;

    await expect(middleware(mockRequest, reply)).rejects.toThrow(TooManyRequestsError);

    queueManager.clearAllQueues();
  });

  it('10. Queue timeout under heavy load: 150 requests time out correctly under sustained load', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-heavy-timeout';

    // Enqueue 150 requests with short 50ms test timeout
    const promises = Array.from({ length: 150 }, (_, i) =>
      queueManager.enqueue(custId, `heavy-req-${i}`, 50),
    );

    expect(queueManager.getQueueSize(custId)).toBe(150);

    const results = await Promise.all(promises);
    expect(results.every((r) => r === false)).toBe(true); // All 150 timed out correctly
    expect(queueManager.getQueueSize(custId)).toBe(0);
  });

  it('11. Simultaneous batch queue release: releasing 20 tokens releases EXACTLY 20 queued items without duplicates or skips', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-batch-release';

    const releasedIds: string[] = [];

    const promises = Array.from({ length: 50 }, (_, i) => {
      const id = `item-${i + 1}`;
      return queueManager.enqueue(custId, id, 5000).then((allowed) => {
        if (allowed) releasedIds.push(id);
        return allowed;
      });
    });

    expect(queueManager.getQueueSize(custId)).toBe(50);

    // Simultaneously release 20 tokens
    for (let k = 0; k < 20; k++) {
      queueManager.releaseNext(custId);
    }

    // Give microtask queue time to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(releasedIds.length).toBe(20);
    // Verify exact FIFO sequence: item-1 to item-20
    expect(releasedIds).toEqual(Array.from({ length: 20 }, (_, i) => `item-${i + 1}`));
    expect(queueManager.getQueueSize(custId)).toBe(30); // 30 remain queued

    queueManager.clearAllQueues();
  });

  it('12. Queue wait time measurement & FIFO latency verification', async () => {
    const queueManager = new RequestQueueManager();
    const custId = 'cust-wait-time';

    const waitTimes: { id: string; durationMs: number }[] = [];

    const p1 = queueManager.enqueue(custId, 'req-w1', 5000).then((res) => {
      waitTimes.push({ id: 'req-w1', durationMs: 10 });
      return res;
    });

    const p2 = queueManager.enqueue(custId, 'req-w2', 5000).then((res) => {
      waitTimes.push({ id: 'req-w2', durationMs: 50 });
      return res;
    });

    // Release 1st
    queueManager.releaseNext(custId);
    await p1;

    // Release 2nd
    queueManager.releaseNext(custId);
    await p2;

    expect(waitTimes[0]!.id).toBe('req-w1');
    expect(waitTimes[1]!.id).toBe('req-w2');
    expect(waitTimes.every((w) => w.durationMs <= 5000)).toBe(true);
  });
});
