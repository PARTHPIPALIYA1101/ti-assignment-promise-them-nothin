import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { RequestLoggerService } from '../src/services/request-logger.service.js';
import { CreateQueueLogData, QueueLogRepository } from '../src/repositories/queue-log.repository.js';
import { createRateLimiterMiddleware } from '../src/middleware/rate-limiter.middleware.js';
import { TooManyRequestsError } from '../src/utils/app.error.js';

describe('Phase 13: Request Audit Logging Test Suite', () => {
  const createMockLogRepo = (throwError = false) => {
    const logsDb: CreateQueueLogData[] = [];

    const mockCreateLog = vi.fn().mockImplementation((data: CreateQueueLogData) => {
      if (throwError) return Promise.reject(new Error('PostgreSQL Database Write Error'));
      logsDb.push(data);
      return Promise.resolve({ id: `log-${logsDb.length}`, ...data, createdAt: new Date() });
    });

    const mockFindLogs = vi.fn().mockImplementation((customerId: string) => {
      return Promise.resolve(logsDb.filter((l) => l.customerId === customerId));
    });

    return {
      logsDb,
      createLog: mockCreateLog,
      findLogsByCustomerId: mockFindLogs,
    } as unknown as QueueLogRepository & { logsDb: CreateQueueLogData[] };
  };

  it('1. Log accepted requests with all audit fields (customerId, plan, tokensRemaining, burstRemaining, queueWaitMs, status)', async () => {
    const mockLogRepo = createMockLogRepo();
    const loggerService = new RequestLoggerService(mockLogRepo);

    loggerService.logRequest({
      customerId: 'cust-log-1',
      plan: 'ENTERPRISE',
      tokensRemaining: 99,
      burstRemaining: 50,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'ACCEPTED',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockLogRepo.createLog).toHaveBeenCalledWith({
      customerId: 'cust-log-1',
      plan: 'ENTERPRISE',
      tokensRemaining: 99,
      burstRemaining: 50,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'ACCEPTED',
    });
  });

  it('2. Log rejected requests when rate limit is exceeded', async () => {
    const mockLogRepo = createMockLogRepo();
    const loggerService = new RequestLoggerService(mockLogRepo);

    loggerService.logRequest({
      customerId: 'cust-log-rejected',
      plan: 'BASIC',
      tokensRemaining: 0,
      burstRemaining: 0,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'REJECTED',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockLogRepo.createLog).toHaveBeenCalledWith({
      customerId: 'cust-log-rejected',
      plan: 'BASIC',
      tokensRemaining: 0,
      burstRemaining: 0,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'REJECTED',
    });
  });

  it('3. RateLimiterMiddleware logs accepted request via RequestLoggerService', async () => {
    const mockLogRepo = createMockLogRepo();
    const loggerService = new RequestLoggerService(mockLogRepo);

    const mockLimiterEngine = {
      consumeToken: vi.fn().mockResolvedValue({
        allowed: true,
        source: 'BASE',
        tokensRemaining: 85,
        burstRemaining: 20,
      }),
    };

    const middleware = createRateLimiterMiddleware(mockLimiterEngine, undefined, loggerService);

    const mockReq = {
      customer: {
        id: 'cust-middleware-log',
        planName: 'PREMIUM',
        effectiveRpmLimit: 100,
        effectiveBurstLimit: 50,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const replyHeaders = new Map<string, string>();
    const mockReply = {
      header: vi.fn((k, v) => replyHeaders.set(k, v)),
    } as unknown as FastifyReply;

    await middleware(mockReq, mockReply);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockLogRepo.createLog).toHaveBeenCalledWith({
      customerId: 'cust-middleware-log',
      plan: 'PREMIUM',
      tokensRemaining: 85,
      burstRemaining: 20,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'ACCEPTED',
    });
  });

  it('4. RateLimiterMiddleware logs rejected request with queueWaitMs duration', async () => {
    const mockLogRepo = createMockLogRepo();
    const loggerService = new RequestLoggerService(mockLogRepo);

    const mockLimiterEngine = {
      consumeToken: vi.fn().mockResolvedValue({
        allowed: false,
        source: 'NONE',
        tokensRemaining: 0,
        burstRemaining: 0,
        retryAfterMs: 2000,
      }),
    };

    const middleware = createRateLimiterMiddleware(mockLimiterEngine, undefined, loggerService);

    const mockReq = {
      customer: {
        id: 'cust-middleware-reject',
        planName: 'BASIC',
        effectiveRpmLimit: 60,
        effectiveBurstLimit: 0,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const replyHeaders = new Map<string, string>();
    const mockReply = {
      header: vi.fn((k, v) => replyHeaders.set(k, v)),
    } as unknown as FastifyReply;

    await expect(middleware(mockReq, mockReply)).rejects.toThrow(TooManyRequestsError);

    await new Promise((r) => setTimeout(r, 10));

    expect(mockLogRepo.createLog).toHaveBeenCalledWith({
      customerId: 'cust-middleware-reject',
      plan: 'BASIC',
      tokensRemaining: 0,
      burstRemaining: 0,
      waitTimeMs: 0,
      queueWaitMs: 0,
      status: 'REJECTED',
    });
  });

  it('5. Logging Failure Resilience: database log write errors are caught safely without crashing HTTP middleware', async () => {
    const mockFailingRepo = createMockLogRepo(true);
    const loggerService = new RequestLoggerService(mockFailingRepo);

    const mockLimiterEngine = {
      consumeToken: vi.fn().mockResolvedValue({
        allowed: true,
        source: 'BASE',
        tokensRemaining: 50,
        burstRemaining: 0,
      }),
    };

    const middleware = createRateLimiterMiddleware(mockLimiterEngine, undefined, loggerService);

    const mockReq = {
      customer: {
        id: 'cust-db-error-logging',
        planName: 'BASIC',
        effectiveRpmLimit: 100,
        effectiveBurstLimit: 0,
        queueEnabled: false,
      },
    } as FastifyRequest;

    const mockReply = { header: vi.fn() } as unknown as FastifyReply;

    await expect(middleware(mockReq, mockReply)).resolves.not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
    expect(mockFailingRepo.createLog).toHaveBeenCalled();
  });

  it('6. High-Volume Concurrent Logging Benchmark: 1,000 logs processed asynchronously in sub-100ms', async () => {
    const mockLogRepo = createMockLogRepo();
    const loggerService = new RequestLoggerService(mockLogRepo);

    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      loggerService.logRequest({
        customerId: `high-volume-${i % 10}`,
        plan: 'ENTERPRISE',
        tokensRemaining: 100 - (i % 50),
        burstRemaining: 50,
        waitTimeMs: 0,
        queueWaitMs: 0,
        status: 'ACCEPTED',
      });
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);

    await new Promise((r) => setTimeout(r, 20));
    expect(mockLogRepo.logsDb.length).toBe(1000);
  });
});
