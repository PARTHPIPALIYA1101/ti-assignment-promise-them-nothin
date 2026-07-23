import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { PlanController } from '../controllers/plan.controller.js';

export function planRoutes(planController: PlanController): FastifyPluginAsync {
  return async (fastify: FastifyInstance): Promise<void> => {
    fastify.post('/api/v1/plans', planController.create);
    fastify.get('/api/v1/plans', planController.getAll);
    fastify.get('/api/v1/plans/:id', planController.getById);
    fastify.put('/api/v1/plans/:id', planController.update);
    fastify.delete('/api/v1/plans/:id', planController.delete);
  };
}
