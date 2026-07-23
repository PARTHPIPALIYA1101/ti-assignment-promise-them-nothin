import { Plan } from '@prisma/client';
import { PlanRepository } from '../repositories/plan.repository.js';
import { CreatePlanDto, UpdatePlanDto } from '../models/plan.model.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/app.error.js';

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export class PlanService {
  constructor(private readonly planRepository: PlanRepository) {}

  public async createPlan(dto: CreatePlanDto): Promise<Plan> {
    if (dto.rpmLimit <= 0) {
      throw new BadRequestError('RPM limit must be a positive integer greater than 0');
    }
    if (dto.burstLimit <= 0) {
      throw new BadRequestError('Burst limit must be a positive integer greater than 0');
    }

    const existing = await this.planRepository.findByName(dto.name);
    if (existing) {
      throw new ConflictError(`Plan with name '${dto.name}' already exists`);
    }
    return this.planRepository.create(dto);
  }

  public async getPlanById(id: string): Promise<Plan> {
    const plan = await this.planRepository.findById(id);
    if (!plan) {
      throw new NotFoundError(`Plan with ID '${id}' not found`);
    }
    return plan;
  }

  public async getAllPlans(page = 1, limit = 20): Promise<PaginatedResult<Plan>> {
    const { items, totalItems } = await this.planRepository.findAll(page, limit);
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  public async updatePlan(id: string, dto: UpdatePlanDto): Promise<Plan> {
    await this.getPlanById(id);

    if (dto.rpmLimit !== undefined && dto.rpmLimit <= 0) {
      throw new BadRequestError('RPM limit must be a positive integer greater than 0');
    }
    if (dto.burstLimit !== undefined && dto.burstLimit <= 0) {
      throw new BadRequestError('Burst limit must be a positive integer greater than 0');
    }

    if (dto.name) {
      const existing = await this.planRepository.findByName(dto.name);
      if (existing && existing.id !== id) {
        throw new ConflictError(`Plan with name '${dto.name}' already exists`);
      }
    }
    return this.planRepository.update(id, dto);
  }

  public async deletePlan(id: string): Promise<Plan> {
    const plan = await this.getPlanById(id);

    const assignedCount = await this.planRepository.countCustomers(id);
    if (assignedCount > 0) {
      throw new ConflictError(
        `Cannot delete plan '${plan.name}'. There are ${assignedCount} customer(s) assigned to this plan. Please reassign or delete the belonging customers first.`,
      );
    }

    return this.planRepository.delete(id);
  }
}
