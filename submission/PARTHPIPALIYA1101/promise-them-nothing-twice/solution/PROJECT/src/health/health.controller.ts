import { FastifyReply, FastifyRequest } from 'fastify';
import { HealthService } from './health.service.js';
import { ResponseUtil } from '../utils/response.util.js';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  public getHealth = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const healthResult = await this.healthService.getHealth();

    if (healthResult.status === 'healthy') {
      reply.status(200).send(ResponseUtil.success(healthResult, 'Service is healthy'));
    } else {
      reply
        .status(503)
        .send(
          ResponseUtil.error('Service is degraded or unhealthy', 'SERVICE_UNHEALTHY', healthResult),
        );
    }
  };
}
