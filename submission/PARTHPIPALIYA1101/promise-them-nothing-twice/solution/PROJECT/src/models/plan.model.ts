import { z } from 'zod';

export const createPlanSchema = z.object({
  name: z.string().min(2, 'Plan name must be at least 2 characters').toUpperCase(),
  rpmLimit: z.number().int().positive('RPM limit must be a positive integer'),
  burstLimit: z.number().int().positive('Burst limit must be a positive integer'),
});

export const updatePlanSchema = createPlanSchema.partial();

export const planPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be >= 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be >= 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
});

export type CreatePlanDto = z.infer<typeof createPlanSchema>;
export type UpdatePlanDto = z.infer<typeof updatePlanSchema>;
export type PlanPaginationQueryDto = z.infer<typeof planPaginationQuerySchema>;
