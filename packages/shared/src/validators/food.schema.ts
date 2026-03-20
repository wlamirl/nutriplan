import { z } from 'zod';

export const FoodSearchQuerySchema = z.object({
  q:    z.string().min(2, 'Termo de busca deve ter ao menos 2 caracteres'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const FoodSimilaritySearchSchema = z.object({
  queryText:    z.string().min(2),
  topK:         z.number().int().min(1).max(50).default(20),
  restrictions: z.object({
    excludeTags:  z.string().array().default([]),
    excludeNames: z.string().array().default([]),
  }).default({}),
});

export const TriggerSyncSchema = z.object({
  source: z.enum(['TBCA', 'USDA', 'OFF']).optional(),
});

export type FoodSearchQuery        = z.infer<typeof FoodSearchQuerySchema>;
export type FoodSimilaritySearch   = z.infer<typeof FoodSimilaritySearchSchema>;
export type TriggerSync            = z.infer<typeof TriggerSyncSchema>;
