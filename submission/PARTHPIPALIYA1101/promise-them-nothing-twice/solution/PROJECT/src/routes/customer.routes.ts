import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { CustomerController } from '../controllers/customer.controller.js';

export function customerRoutes(customerController: CustomerController): FastifyPluginAsync {
  return async (fastify: FastifyInstance): Promise<void> => {
    fastify.post('/api/v1/customers', customerController.create);
    fastify.get('/api/v1/customers', customerController.getAll);
    fastify.get('/api/v1/customers/:id', customerController.getById);
    fastify.put('/api/v1/customers/:id', customerController.update);
    fastify.delete('/api/v1/customers/:id', customerController.delete);
  };
}
