import { Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, UpdatePlanDto } from '../models/plan.model.js';

export interface PaginatedPlans {
  items: Plan[];
  totalItems: number;
}

export class PlanRepository {
  constructor(private readonly prismaService: PrismaService) {}

  public async create(data: CreatePlanDto): Promise<Plan> {
    return this.prismaService.client.plan.create({ data });
  }

  public async findById(id: string): Promise<Plan | null> {
    return this.prismaService.client.plan.findUnique({
      where: { id },
    });
  }

  public async findByName(name: string): Promise<Plan | null> {
    return this.prismaService.client.plan.findUnique({
      where: { name: name.toUpperCase() },
    });
  }

  public async findAll(page = 1, limit = 20): Promise<PaginatedPlans> {
    const skip = (page - 1) * limit;
    const [items, totalItems] = await this.prismaService.client.$transaction([
      this.prismaService.client.plan.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.client.plan.count(),
    ]);

    return { items, totalItems };
  }

  public async countCustomers(planId: string): Promise<number> {
    return this.prismaService.client.customer.count({
      where: { planId },
    });
  }

  public async update(id: string, data: UpdatePlanDto): Promise<Plan> {
    const updateData: Prisma.PlanUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.rpmLimit !== undefined) updateData.rpmLimit = data.rpmLimit;
    if (data.burstLimit !== undefined) updateData.burstLimit = data.burstLimit;

    return this.prismaService.client.plan.update({
      where: { id },
      data: updateData,
    });
  }

  public async delete(id: string): Promise<Plan> {
    return this.prismaService.client.plan.delete({
      where: { id },
    });
  }
}
