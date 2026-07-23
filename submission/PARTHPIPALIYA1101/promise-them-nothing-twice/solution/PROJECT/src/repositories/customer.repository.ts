import { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { CreateCustomerDto, UpdateCustomerDto } from '../models/customer.model.js';

export type CustomerWithPlan = Prisma.CustomerGetPayload<{ include: { plan: true } }>;

export interface RateLimitContextData {
  id: string;
  customRpmLimit: number | null;
  customBurstLimit: number | null;
  queueEnabled: boolean;
  plan: {
    id: string;
    name: string;
    rpmLimit: number;
    burstLimit: number;
  };
}

export interface PaginatedCustomers {
  items: CustomerWithPlan[];
  totalItems: number;
}

export class CustomerRepository {
  constructor(private readonly prismaService: PrismaService) {}

  public async create(dto: CreateCustomerDto): Promise<CustomerWithPlan> {
    const createData: Prisma.CustomerCreateInput = {
      name: dto.name,
      email: dto.email,
      plan: { connect: { id: dto.planId } },
    };
    if (dto.customRpmLimit !== undefined) createData.customRpmLimit = dto.customRpmLimit;
    if (dto.customBurstLimit !== undefined) createData.customBurstLimit = dto.customBurstLimit;
    if (dto.queueEnabled !== undefined) createData.queueEnabled = dto.queueEnabled;

    return this.prismaService.client.customer.create({
      data: createData,
      include: { plan: true },
    });
  }

  public async findById(id: string): Promise<CustomerWithPlan | null> {
    return this.prismaService.client.customer.findUnique({
      where: { id },
      include: { plan: true },
    });
  }

  public async findRateLimitContextById(id: string): Promise<RateLimitContextData | null> {
    return this.prismaService.client.customer.findUnique({
      where: { id },
      select: {
        id: true,
        customRpmLimit: true,
        customBurstLimit: true,
        queueEnabled: true,
        plan: {
          select: {
            id: true,
            name: true,
            rpmLimit: true,
            burstLimit: true,
          },
        },
      },
    });
  }

  public async findByEmail(email: string): Promise<CustomerWithPlan | null> {
    return this.prismaService.client.customer.findUnique({
      where: { email },
      include: { plan: true },
    });
  }

  public async findAll(page = 1, limit = 20): Promise<PaginatedCustomers> {
    const skip = (page - 1) * limit;
    const [items, totalItems] = await this.prismaService.client.$transaction([
      this.prismaService.client.customer.findMany({
        include: { plan: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.client.customer.count(),
    ]);

    return { items, totalItems };
  }

  public async update(id: string, dto: UpdateCustomerDto): Promise<CustomerWithPlan> {
    const updateData: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.planId !== undefined) updateData.plan = { connect: { id: dto.planId } };
    if (dto.customRpmLimit !== undefined) updateData.customRpmLimit = dto.customRpmLimit;
    if (dto.customBurstLimit !== undefined) updateData.customBurstLimit = dto.customBurstLimit;
    if (dto.queueEnabled !== undefined) updateData.queueEnabled = dto.queueEnabled;

    return this.prismaService.client.customer.update({
      where: { id },
      data: updateData,
      include: { plan: true },
    });
  }

  public async delete(id: string): Promise<Customer> {
    return this.prismaService.client.customer.delete({
      where: { id },
    });
  }
}
