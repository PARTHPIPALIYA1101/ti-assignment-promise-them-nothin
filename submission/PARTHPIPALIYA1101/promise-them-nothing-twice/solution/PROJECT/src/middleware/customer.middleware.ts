import { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerRepository } from '../repositories/customer.repository.js';
import { InternalServerError, NotFoundError, UnauthorizedError } from '../utils/app.error.js';

// Standard RFC 4122 UUID format regex (supporting UUID v1-v7 and nil UUID)
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface EffectiveCustomerContext {
  id: string;
  planId: string;
  planName: string;
  effectiveRpmLimit: number;
  effectiveBurstLimit: number;
  queueEnabled: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    customer?: EffectiveCustomerContext;
  }
}

export function createCustomerLookupMiddleware(customerRepository: CustomerRepository) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const rawHeader = request.headers['x-customer-id'];
    const customerId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!customerId || customerId.trim() === '') {
      throw new UnauthorizedError('Missing required X-Customer-ID header');
    }

    const trimmedId = customerId.trim();

    // Validate UUID format BEFORE querying the database
    if (!UUID_REGEX.test(trimmedId)) {
      throw new UnauthorizedError('Invalid X-Customer-ID format. Must be a valid UUID');
    }

    let customer;
    try {
      // Query database selecting ONLY minimal fields needed for rate limiting
      customer = await customerRepository.findRateLimitContextById(trimmedId);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof UnauthorizedError) {
        throw error;
      }
      throw new InternalServerError('Database unavailable during customer lookup');
    }

    if (!customer) {
      throw new NotFoundError(`Customer with ID '${trimmedId}' not found`);
    }

    // Load effective limits (plan defaults vs Enterprise overrides)
    const effectiveRpmLimit = customer.customRpmLimit ?? customer.plan.rpmLimit;
    const effectiveBurstLimit = customer.customBurstLimit ?? customer.plan.burstLimit;

    request.customer = {
      id: customer.id,
      planId: customer.plan.id,
      planName: customer.plan.name,
      effectiveRpmLimit,
      effectiveBurstLimit,
      queueEnabled: customer.queueEnabled,
    };
  };
}
