import { FastifyReply, FastifyRequest } from 'fastify';
import { PlanService } from '../services/plan.service.js';
import {
  createPlanSchema,
  planPaginationQuerySchema,
  updatePlanSchema,
} from '../models/plan.model.js';
import { ResponseUtil } from '../utils/response.util.js';

export class PlanController {
  constructor(private readonly planService: PlanService) {}

  public create = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const validatedDto = createPlanSchema.parse(request.body);
    const plan = await this.planService.createPlan(validatedDto);
    reply.status(201).send(ResponseUtil.success(plan, 'Plan created successfully'));
  };

  public getAll = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { page, limit } = planPaginationQuerySchema.parse(request.query);
    const result = await this.planService.getAllPlans(page, limit);
    reply.status(200).send(ResponseUtil.success(result));
  };

  public getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    const plan = await this.planService.getPlanById(id);
    reply.status(200).send(ResponseUtil.success(plan));
  };

  public update = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    const validatedDto = updatePlanSchema.parse(request.body);
    const plan = await this.planService.updatePlan(id, validatedDto);
    reply.status(200).send(ResponseUtil.success(plan, 'Plan updated successfully'));
  };

  public delete = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    const plan = await this.planService.deletePlan(id);
    reply.status(200).send(ResponseUtil.success(plan, 'Plan deleted successfully'));
  };
}
