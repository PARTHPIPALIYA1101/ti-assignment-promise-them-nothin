import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createRateLimiterMiddleware } from '../src/middleware/rate-limiter.middleware.js';
import { BucketRedisService } from '../src/redis/bucket.redis.service.js';
import { TooManyRequestsError, UnauthorizedError } from '../src/utils/app.error.js';

describe('RateLimiterMiddleware', () => {
  const createMockBucketService = (
    allowed: boolean,
    remaining = 99,
    burstRemaining = 50,
    retryMs?: number,
  ): BucketRedisService => {
    return {
      consumeToken: vi.fn().mockResolvedValue({
        allowed,
        source: allowed ? 'BASE' : 'NONE',
        tokensRemaining: remaining,
        burstRemaining,
        retryAfterMs: retryMs ?? 1000,
      }),
    } as unknown as BucketRedisService;
  };

  const createMockReply = () => {
    const headers = new Map<string, string>();
    return {
      headers,
      header: vi.fn((key: string, value: string) => {
        headers.set(key, value);
      }),
    } as unknown as FastifyReply & { headers: Map<string, string> };
  };

  it('should throw UnauthorizedError when request.customer is missing', async () => {
    const mockBucketService = createMockBucketService(true);
    const middleware = createRateLimiterMiddleware(mockBucketService);

    const req = {} as FastifyRequest;
    const reply = createMockReply();

    await expect(middleware(req, reply)).rejects.toThrow(UnauthorizedError);
  });

  it('should allow request and set X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Burst-Remaining headers when allowed', async () => {
    const mockBucketService = createMockBucketService(true, 95, 40);
    const middleware = createRateLimiterMiddleware(mockBucketService);

    const req = {
      customer: {
        id: 'cust-uuid-1',
        planId: 'plan-1',
        planName: 'BASIC',
        effectiveRpmLimit: 100,
        effectiveBurstLimit: 100,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const reply = createMockReply();

    await middleware(req, reply);

    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '95');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Burst-Remaining', '40');
  });

  it('should reject request with TooManyRequestsError (429) and set Retry-After header when rate limit is exceeded', async () => {
    const mockBucketService = createMockBucketService(false, 0, 0, 2500);
    const middleware = createRateLimiterMiddleware(mockBucketService);

    const req = {
      customer: {
        id: 'cust-uuid-exceeded',
        planId: 'plan-1',
        planName: 'BASIC',
        effectiveRpmLimit: 100,
        effectiveBurstLimit: 100,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const reply = createMockReply();

    await expect(middleware(req, reply)).rejects.toThrow(TooManyRequestsError);
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
    expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Burst-Remaining', '0');
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '3');
  });
});
