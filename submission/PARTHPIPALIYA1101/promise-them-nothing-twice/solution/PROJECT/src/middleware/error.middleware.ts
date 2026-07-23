import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../config/logger.config.js';
import { AppError } from '../utils/app.error.js';
import { ResponseUtil } from '../utils/response.util.js';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  logger.error(
    {
      err: error,
      url: request.url,
      method: request.method,
    },
    'An error occurred during request execution',
  );

  // Custom Application Errors
  if (error instanceof AppError) {
    reply
      .status(error.statusCode)
      .send(ResponseUtil.error(error.message, error.constructor.name, error.details));
    return;
  }

  // Zod Validation Errors -> HTTP 400 Bad Request
  if (error instanceof ZodError) {
    reply
      .status(400)
      .send(ResponseUtil.error('Invalid request payload format', 'VALIDATION_ERROR', error.issues));
    return;
  }

  // Fastify Schema Validation Error
  if ('validation' in error && Array.isArray((error as FastifyError).validation)) {
    reply
      .status(400)
      .send(
        ResponseUtil.error(
          'Validation Error',
          'VALIDATION_ERROR',
          (error as FastifyError).validation,
        ),
      );
    return;
  }

  // Prisma Unique Constraint Violation (P2002) - Dynamically format field name
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = error.meta?.['target'];
      let targetField = 'unique field';
      if (Array.isArray(target) && target.length > 0) {
        targetField = target.join(', ');
      } else if (typeof target === 'string') {
        targetField = target;
      }

      let userMessage = `A record with this ${targetField} already exists`;
      if (targetField.includes('name')) {
        userMessage = 'A plan with this name already exists';
      } else if (targetField.includes('email')) {
        userMessage = 'A customer with this email address already exists';
      }

      reply.status(409).send(ResponseUtil.error(userMessage, 'DUPLICATE_ENTRY_CONFLICT'));
      return;
    }

    // Prisma Foreign Key Constraint Violation (P2003)
    if (error.code === 'P2003') {
      const fieldName = (error.meta?.['field_name'] as string) || 'foreign key';
      let message = 'Cannot complete operation due to an invalid foreign key reference';
      if (fieldName.includes('planId')) {
        message = 'Invalid planId: The specified plan does not exist';
        reply.status(400).send(ResponseUtil.error(message, 'INVALID_PLAN_REFERENCE'));
        return;
      }

      reply.status(409).send(ResponseUtil.error(message, 'FOREIGN_KEY_CONSTRAINT_CONFLICT'));
      return;
    }
  }

  // Fallback Internal Server Error
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
  reply.status(500).send(ResponseUtil.error(message, 'INTERNAL_SERVER_ERROR'));
}
