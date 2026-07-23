import { CustomerRepository, CustomerWithPlan } from '../repositories/customer.repository.js';
import { PlanRepository } from '../repositories/plan.repository.js';
import { CreateCustomerDto, UpdateCustomerDto } from '../models/customer.model.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/app.error.js';
import { PaginatedResult } from './plan.service.js';

export class CustomerService {
  constructor(
    private readonly customerRepository: CustomerRepository,
    private readonly planRepository: PlanRepository,
  ) {}

  public async createCustomer(dto: CreateCustomerDto): Promise<CustomerWithPlan> {
    if (dto.customRpmLimit !== undefined && dto.customRpmLimit <= 0) {
      throw new BadRequestError('Custom RPM limit must be a positive integer greater than 0');
    }
    if (dto.customBurstLimit !== undefined && dto.customBurstLimit <= 0) {
      throw new BadRequestError('Custom Burst limit must be a positive integer greater than 0');
    }

    const plan = await this.planRepository.findById(dto.planId);
    if (!plan) {
      throw new BadRequestError(`Invalid planId: Plan with ID '${dto.planId}' does not exist`);
    }

    if (plan.name !== 'ENTERPRISE') {
      if (dto.customRpmLimit !== undefined || dto.customBurstLimit !== undefined) {
        throw new BadRequestError(
          `Custom limit overrides are only allowed for ENTERPRISE plan tier. Selected plan is '${plan.name}'`,
        );
      }
    }

    const existingEmail = await this.customerRepository.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictError(`A customer with email '${dto.email}' already exists`);
    }

    return this.customerRepository.create(dto);
  }

  public async getCustomerById(id: string): Promise<CustomerWithPlan> {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundError(`Customer with ID '${id}' not found`);
    }
    return customer;
  }

  public async getAllCustomers(page = 1, limit = 20): Promise<PaginatedResult<CustomerWithPlan>> {
    const { items, totalItems } = await this.customerRepository.findAll(page, limit);
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

  public async updateCustomer(id: string, dto: UpdateCustomerDto): Promise<CustomerWithPlan> {
    const currentCustomer = await this.getCustomerById(id);

    if (dto.customRpmLimit !== undefined && dto.customRpmLimit <= 0) {
      throw new BadRequestError('Custom RPM limit must be a positive integer greater than 0');
    }
    if (dto.customBurstLimit !== undefined && dto.customBurstLimit <= 0) {
      throw new BadRequestError('Custom Burst limit must be a positive integer greater than 0');
    }

    let targetPlan = currentCustomer.plan;
    if (dto.planId) {
      const plan = await this.planRepository.findById(dto.planId);
      if (!plan) {
        throw new BadRequestError(`Invalid planId: Plan with ID '${dto.planId}' does not exist`);
      }
      targetPlan = plan;
    }

    if (targetPlan.name !== 'ENTERPRISE') {
      if (dto.customRpmLimit !== undefined || dto.customBurstLimit !== undefined) {
        throw new BadRequestError(
          `Custom limit overrides are only allowed for ENTERPRISE plan tier. Plan is '${targetPlan.name}'`,
        );
      }
    }

    if (dto.email) {
      const existingEmail = await this.customerRepository.findByEmail(dto.email);
      if (existingEmail && existingEmail.id !== id) {
        throw new ConflictError(`A customer with email '${dto.email}' already exists`);
      }
    }

    return this.customerRepository.update(id, dto);
  }

  public async deleteCustomer(id: string): Promise<void> {
    await this.getCustomerById(id);
    await this.customerRepository.delete(id);
  }
}
