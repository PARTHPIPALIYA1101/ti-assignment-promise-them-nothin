import { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerService } from '../services/customer.service.js';
import {
  createCustomerSchema,
  customerPaginationQuerySchema,
  updateCustomerSchema,
} from '../models/customer.model.js';
import { ResponseUtil } from '../utils/response.util.js';

export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  public create = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const validatedDto = createCustomerSchema.parse(request.body);
    const customer = await this.customerService.createCustomer(validatedDto);
    reply.status(201).send(ResponseUtil.success(customer, 'Customer created successfully'));
  };

  public getAll = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { page, limit } = customerPaginationQuerySchema.parse(request.query);
    const result = await this.customerService.getAllCustomers(page, limit);
    reply.status(200).send(ResponseUtil.success(result));
  };

  public getById = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    const customer = await this.customerService.getCustomerById(id);
    reply.status(200).send(ResponseUtil.success(customer));
  };

  public update = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    const validatedDto = updateCustomerSchema.parse(request.body);
    const customer = await this.customerService.updateCustomer(id, validatedDto);
    reply.status(200).send(ResponseUtil.success(customer, 'Customer updated successfully'));
  };

  public delete = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { id } = request.params;
    await this.customerService.deleteCustomer(id);
    reply.status(200).send(ResponseUtil.success(null, 'Customer deleted successfully'));
  };
}
