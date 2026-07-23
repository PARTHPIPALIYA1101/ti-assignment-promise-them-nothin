import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { HealthController } from './health.controller.js';

export function healthRoutes(healthController: HealthController): FastifyPluginAsync {
  return async (fastify: FastifyInstance): Promise<void> => {
    fastify.get('/health', healthController.getHealth);
    fastify.get('/api/v1/health', healthController.getHealth);
  };
}
