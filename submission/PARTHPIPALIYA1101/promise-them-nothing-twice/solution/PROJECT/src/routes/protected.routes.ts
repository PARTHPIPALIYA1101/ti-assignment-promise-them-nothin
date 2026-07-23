import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createCustomerLookupMiddleware } from '../middleware/customer.middleware.js';
import { createRateLimiterMiddleware } from '../middleware/rate-limiter.middleware.js';
import { CustomerRepository } from '../repositories/customer.repository.js';
import { FallbackRateLimiterService } from '../services/fallback-rate-limiter.service.js';
import { RequestLoggerService } from '../services/request-logger.service.js';
import { ResponseUtil } from '../utils/response.util.js';

export function protectedRoutes(
  customerRepository: CustomerRepository,
  fallbackRateLimiterService: FallbackRateLimiterService,
  requestLoggerService?: RequestLoggerService,
): FastifyPluginAsync {
  const customerLookup = createCustomerLookupMiddleware(customerRepository);
  const rateLimiter = createRateLimiterMiddleware(
    fallbackRateLimiterService,
    undefined,
    requestLoggerService,
  );

  return async (fastify: FastifyInstance): Promise<void> => {
    fastify.get(
      '/api/v1/protected/ping',
      { preHandler: [customerLookup, rateLimiter] },
      async (request, reply) => {
        reply.status(200).send(
          ResponseUtil.success(
            {
              message: 'Access granted. X-Customer-ID verified & rate limit evaluated.',
              customerContext: request.customer,
            },
            'Protected endpoint test successful',
          ),
        );
      },
    );
  };
}
