import { describe, expect, it, vi } from 'vitest';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createCustomerLookupMiddleware } from '../src/middleware/customer.middleware.js';
import { CustomerRepository, RateLimitContextData } from '../src/repositories/customer.repository.js';
import { InternalServerError, NotFoundError, UnauthorizedError } from '../src/utils/app.error.js';

describe('CustomerLookupMiddleware', () => {
  const createMockRepo = (mockReturn: RateLimitContextData | null, throwError?: Error): CustomerRepository => {
    const findRateLimitFn = throwError
      ? vi.fn().mockRejectedValue(throwError)
      : vi.fn().mockResolvedValue(mockReturn);

    return {
      findRateLimitContextById: findRateLimitFn,
      findById: vi.fn(),
    } as unknown as CustomerRepository;
  };

  const createMockRequest = (headers: Record<string, string | string[] | undefined>): FastifyRequest => {
    return {
      headers,
    } as FastifyRequest;
  };

  const mockReply = {} as FastifyReply;

  it('should throw UnauthorizedError (401) when X-Customer-ID header is missing', async () => {
    const mockRepo = createMockRepo(null);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({});

    await expect(middleware(req, mockReply)).rejects.toThrow(UnauthorizedError);
    await expect(middleware(req, mockReply)).rejects.toThrow('Missing required X-Customer-ID header');
  });

  it('should throw UnauthorizedError (401) when X-Customer-ID format is not a valid UUID', async () => {
    const mockRepo = createMockRepo(null);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({ 'x-customer-id': 'invalid-uuid-1234' });

    await expect(middleware(req, mockReply)).rejects.toThrow(UnauthorizedError);
    await expect(middleware(req, mockReply)).rejects.toThrow('Invalid X-Customer-ID format. Must be a valid UUID');
    expect(mockRepo.findRateLimitContextById).not.toHaveBeenCalled();
    expect(mockRepo.findById).not.toHaveBeenCalled();
  });

  it('should throw NotFoundError (404) when customer ID is valid UUID but not found in database', async () => {
    const validUuid = '11111111-2222-3333-8888-999999999999';
    const mockRepo = createMockRepo(null);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({ 'x-customer-id': validUuid });

    await expect(middleware(req, mockReply)).rejects.toThrow(NotFoundError);
    // Explicitly verify that findRateLimitContextById is called and NOT full findById
    expect(mockRepo.findRateLimitContextById).toHaveBeenCalledWith(validUuid);
    expect(mockRepo.findById).not.toHaveBeenCalled();
  });

  it('should throw InternalServerError (500) when database repository throws an exception', async () => {
    const validUuid = '44444444-5555-6666-cccc-dddddddddddd';
    const dbError = new Error('PostgreSQL Connection Failed');
    const mockRepo = createMockRepo(null, dbError);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({ 'x-customer-id': validUuid });

    await expect(middleware(req, mockReply)).rejects.toThrow(InternalServerError);
    await expect(middleware(req, mockReply)).rejects.toThrow('Database unavailable during customer lookup');
    expect(mockRepo.findRateLimitContextById).toHaveBeenCalledWith(validUuid);
    expect(mockRepo.findById).not.toHaveBeenCalled();
  });

  it('should attach default plan limits when customer has no custom overrides using findRateLimitContextById', async () => {
    const validUuid = '22222222-3333-4444-9999-000000000000';
    const mockCustomerData: RateLimitContextData = {
      id: validUuid,
      customRpmLimit: null,
      customBurstLimit: null,
      queueEnabled: true,
      plan: {
        id: 'plan-basic-1',
        name: 'BASIC',
        rpmLimit: 100,
        burstLimit: 100,
      },
    };

    const mockRepo = createMockRepo(mockCustomerData);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({ 'x-customer-id': validUuid });

    await middleware(req, mockReply);

    // Verify optimized findRateLimitContextById query was used instead of full findById
    expect(mockRepo.findRateLimitContextById).toHaveBeenCalledWith(validUuid);
    expect(mockRepo.findById).not.toHaveBeenCalled();

    expect(req.customer).toEqual({
      id: validUuid,
      planId: 'plan-basic-1',
      planName: 'BASIC',
      effectiveRpmLimit: 100,
      effectiveBurstLimit: 100,
      queueEnabled: true,
    });
  });

  it('should attach custom override limits when Enterprise customer has custom limits', async () => {
    const validUuid = '33333333-4444-5555-aaaa-bbbbbbbbbbbb';
    const mockCustomerData: RateLimitContextData = {
      id: validUuid,
      customRpmLimit: 1200,
      customBurstLimit: 1500,
      queueEnabled: false,
      plan: {
        id: 'plan-enterprise-1',
        name: 'ENTERPRISE',
        rpmLimit: 1000,
        burstLimit: 1000,
      },
    };

    const mockRepo = createMockRepo(mockCustomerData);
    const middleware = createCustomerLookupMiddleware(mockRepo);
    const req = createMockRequest({ 'x-customer-id': validUuid });

    await middleware(req, mockReply);

    expect(mockRepo.findRateLimitContextById).toHaveBeenCalledWith(validUuid);
    expect(mockRepo.findById).not.toHaveBeenCalled();

    expect(req.customer).toEqual({
      id: validUuid,
      planId: 'plan-enterprise-1',
      planName: 'ENTERPRISE',
      effectiveRpmLimit: 1200,
      effectiveBurstLimit: 1500,
      queueEnabled: false,
    });
  });
});
