import { FastifyReply, FastifyRequest } from 'fastify';
import { RequestQueueManager } from '../queue/request.queue.js';
import { RequestLoggerService } from '../services/request-logger.service.js';
import { TooManyRequestsError, UnauthorizedError } from '../utils/app.error.js';
import { ConsumeResult } from '../redis/bucket.types.js';

export interface RateLimiterEngine {
  consumeToken: (
    customerId: string,
    effectiveRpm: number,
    effectiveBurst: number,
  ) => Promise<ConsumeResult>;
}

export function createRateLimiterMiddleware(
  rateLimiterService: RateLimiterEngine,
  requestQueueManager: RequestQueueManager = RequestQueueManager.getInstance(),
  requestLoggerService?: RequestLoggerService,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const customer = request.customer;

    if (!customer) {
      throw new UnauthorizedError('Missing customer context for rate limiting');
    }

    const requestStartTime = Date.now();
    let queueWaitMs = 0;

    let result = await rateLimiterService.consumeToken(
      customer.id,
      customer.effectiveRpmLimit,
      customer.effectiveBurstLimit,
    );

    // If rate limit exceeded and customer has queue enabled -> Attempt enqueuing request
    if (!result.allowed && customer.queueEnabled) {
      const reqId = request.id || `req-${Math.random().toString(36).substring(2, 9)}`;

      const disconnectHandler = (): void => {
        requestQueueManager.remove(customer.id, reqId);
      };
      if (request.raw && typeof request.raw.on === 'function') {
        request.raw.on('close', disconnectHandler);
      }

      const releasedWithToken = await requestQueueManager.enqueue(customer.id, reqId, 5000);

      if (request.raw && typeof request.raw.removeListener === 'function') {
        request.raw.removeListener('close', disconnectHandler);
      }

      queueWaitMs = Date.now() - requestStartTime;

      if (releasedWithToken) {
        result = await rateLimiterService.consumeToken(
          customer.id,
          customer.effectiveRpmLimit,
          customer.effectiveBurstLimit,
        );
      }
    }

    const remainingTokens = Math.max(0, Math.floor(result.tokensRemaining));
    const remainingBurstTokens = Math.max(0, Math.floor(result.burstRemaining));

    reply.header('X-RateLimit-Limit', customer.effectiveRpmLimit.toString());
    reply.header('X-RateLimit-Remaining', remainingTokens.toString());
    reply.header('X-RateLimit-Burst-Remaining', remainingBurstTokens.toString());

    // Asynchronous Request Logging Audit (Non-Blocking)
    if (requestLoggerService) {
      requestLoggerService.logRequest({
        customerId: customer.id,
        plan: customer.planName,
        tokensRemaining: remainingTokens,
        burstRemaining: remainingBurstTokens,
        waitTimeMs: queueWaitMs,
        queueWaitMs,
        status: result.allowed ? 'ACCEPTED' : 'REJECTED',
      });
    }

    if (!result.allowed) {
      const retrySeconds = Math.ceil((result.retryAfterMs ?? 1000) / 1000.0);
      reply.header('Retry-After', retrySeconds.toString());
      throw new TooManyRequestsError(
        `Rate limit exceeded. Maximum ${customer.effectiveRpmLimit} RPM allowed for ${customer.planName} tier.`,
        {
          effectiveRpmLimit: customer.effectiveRpmLimit,
          retryAfterSeconds: retrySeconds,
        },
      );
    }
  };
}
