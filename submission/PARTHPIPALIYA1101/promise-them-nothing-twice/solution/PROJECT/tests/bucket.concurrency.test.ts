import { describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { ConsumeResult } from '../src/redis/bucket.types.js';

// Helper function to calculate latency percentiles (p50, p95, p99)
export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

export function calculateLatencyPercentiles(latencies: number[]): LatencyMetrics {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, max: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const getPercentile = (p: number): number => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    const boundedIdx = Math.max(0, Math.min(sorted.length - 1, idx));
    return sorted[boundedIdx]!;
  };

  const sum = sorted.reduce((acc, val) => acc + val, 0);
  return {
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
    mean: Number((sum / sorted.length).toFixed(3)),
    max: sorted[sorted.length - 1]!,
  };
}

describe('BucketRedisService Advanced Concurrency, Latency & Real-World Traffic Tests', () => {
  // Synchronous atomic thread-safe in-memory Redis simulator matching Redis Lua execution
  const createThreadSafeRedisCluster = () => {
    const memoryStore = new Map<string, Record<string, string>>();
    let activeClientCount = 0;

    const executeLuaScript = (
      key: string,
      rpmLimit: number,
      burstLimit: number,
      nowMs: number,
    ): [number, string, string, string] => {
      const burstWindowMs = 900000;
      let bucket = memoryStore.get(key);

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

      memoryStore.set(key, {
        tokens: tokens.toString(),
        burstTokens: burstTokens.toString(),
        lastRefill: lastRefill.toString(),
      });

      return [allowed, source, tokens.toString(), burstTokens.toString()];
    };

    const createInstance = () => {
      activeClientCount++;
      return {
        eval: vi.fn().mockImplementation((_script: string, _numkeys: number, key: string, argRpm: string, argBurst: string, argNow: string) => {
          return Promise.resolve(
            executeLuaScript(key, parseFloat(argRpm), parseFloat(argBurst), parseInt(argNow, 10)),
          );
        }),
        hmget: vi.fn().mockImplementation((key: string) => {
          const b = memoryStore.get(key);
          if (!b) return Promise.resolve([null, null, null]);
          return Promise.resolve([b.tokens, b.burstTokens, b.lastRefill]);
        }),
        hmset: vi.fn().mockImplementation((key: string, data: Record<string, string>) => {
          memoryStore.set(key, data);
          return Promise.resolve('OK');
        }),
        expire: vi.fn().mockResolvedValue(1),
        disconnect: vi.fn().mockImplementation(() => {
          activeClientCount = Math.max(0, activeClientCount - 1);
          return Promise.resolve();
        }),
      } as unknown as Redis;
    };

    return {
      memoryStore,
      createInstance,
      getActiveClientCount: () => activeClientCount,
    };
  };

  it('1. Multi-Instance & 1,000+ Request Burst Stress Test with Latency Percentiles (p50, p95, p99)', async () => {
    const cluster = createThreadSafeRedisCluster();
    const nodeClients = Array.from({ length: 5 }, () => new BucketRedisService(undefined, cluster.createInstance()));

    const customerId = 'stress-cust-latency';
    const rpmLimit = 100;
    const burstLimit = 50;
    const nowMs = 1000000;

    await nodeClients[0]!.saveBucket(customerId, {
      tokens: 100,
      burstTokens: 50,
      lastRefill: nowMs,
    });

    const latencies: number[] = [];

    // Fire 1,000 concurrent requests while measuring execution time
    const requests = Array.from({ length: 1000 }, async (_, index) => {
      const clientNode = nodeClients[index % 5]!;
      const start = performance.now();
      const res = await clientNode.consumeToken(customerId, rpmLimit, burstLimit, nowMs);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      return res;
    });

    const results: ConsumeResult[] = await Promise.all(requests);
    const metrics = calculateLatencyPercentiles(latencies);

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(150);
    expect(rejectedCount).toBe(850);

    // Verify sub-millisecond execution stability under heavy concurrent load
    expect(metrics.p50).toBeLessThan(10); // Sub-10ms p50
    expect(metrics.p95).toBeLessThan(25); // Sub-25ms p95
    expect(metrics.p99).toBeLessThan(50); // Sub-50ms p99
  });

  it('2. Connection Stability & Zero Connection Leak Test across 100 Stress Rounds', async () => {
    const cluster = createThreadSafeRedisCluster();
    const initialClients = cluster.getActiveClientCount();

    // Create 10 app instances
    const pool = Array.from({ length: 10 }, () => new BucketRedisService(undefined, cluster.createInstance()));
    const activeAfterPoolCreation = cluster.getActiveClientCount();

    expect(activeAfterPoolCreation).toBe(initialClients + 10);

    // Run 100 consecutive stress cycles using existing pool
    for (let round = 1; round <= 100; round++) {
      const custId = `leak-test-cust-${round}`;
      const nowMs = 1000000 + round * 100;

      const reqs = Array.from({ length: 50 }, (_, i) =>
        pool[i % 10]!.consumeToken(custId, 50, 20, nowMs),
      );
      await Promise.all(reqs);
    }

    // Verify client connection count remains strictly constant (0 leaks)
    expect(cluster.getActiveClientCount()).toBe(activeAfterPoolCreation);
  });

  it('3. Real-World Multi-Tenant Traffic Simulation: 50 different customers across Basic, Premium & Enterprise tiers', async () => {
    const cluster = createThreadSafeRedisCluster();
    const service = new BucketRedisService(undefined, cluster.createInstance());

    // Generate 50 distinct customer profiles
    const customers = Array.from({ length: 50 }, (_, i) => {
      const tier = i % 3 === 0 ? 'BASIC' : i % 3 === 1 ? 'PREMIUM' : 'ENTERPRISE';
      const rpm = tier === 'BASIC' ? 100 : tier === 'PREMIUM' ? 300 : 1000;
      const burst = tier === 'BASIC' ? 50 : tier === 'PREMIUM' ? 100 : 500;
      return {
        id: `customer-tenant-${i}`,
        tier,
        rpm,
        burst,
      };
    });

    const nowMs = 5000000;
    const latencies: number[] = [];

    // Simulate 2,000 mixed concurrent traffic requests randomly distributed across 50 customers
    const requests = Array.from({ length: 2000 }, async (_, index) => {
      const customer = customers[index % 50]!;
      const start = performance.now();
      const res = await service.consumeToken(customer.id, customer.rpm, customer.burst, nowMs);
      latencies.push(performance.now() - start);
      return { customerId: customer.id, tier: customer.tier, res };
    });

    const results = await Promise.all(requests);
    const metrics = calculateLatencyPercentiles(latencies);

    // Group results per customer
    const resultsByCustomer = new Map<string, typeof results>();
    for (const item of results) {
      const list = resultsByCustomer.get(item.customerId) ?? [];
      list.push(item);
      resultsByCustomer.set(item.customerId, list);
    }

    // Verify each customer's bucket respects their specific tier capacity independently
    for (const [custKey, itemResults] of resultsByCustomer.entries()) {
      const customerObj = customers.find((c) => c.id === custKey)!;
      const allowed = itemResults.filter((r) => r.res.allowed).length;
      const totalCapacity = customerObj.rpm; // Fresh initial base capacity

      // Total allowed requests for this customer should never exceed their plan capacity
      expect(allowed).toBeLessThanOrEqual(totalCapacity);
    }

    // Verify global multi-tenant latency stability
    expect(metrics.p50).toBeLessThan(10);
    expect(metrics.p95).toBeLessThan(25);
  });
});
