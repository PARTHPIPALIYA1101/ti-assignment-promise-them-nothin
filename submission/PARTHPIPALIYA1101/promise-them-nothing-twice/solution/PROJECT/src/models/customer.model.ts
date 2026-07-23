import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().min(2, 'Customer name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  planId: z.string().uuid('Invalid Plan ID format'),
  customRpmLimit: z.number().int().positive().optional(),
  customBurstLimit: z.number().int().positive().optional(),
  queueEnabled: z.boolean().optional().default(true),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be >= 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be >= 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
});

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
export type CustomerPaginationQueryDto = z.infer<typeof customerPaginationQuerySchema>;
