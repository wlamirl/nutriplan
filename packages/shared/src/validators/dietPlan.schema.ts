import { z } from 'zod';

const MealTypeSchema = z.enum([
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'supper',
]);

const MacroSplitSchema = z.object({
  proteinPct: z.number().min(10).max(60),
  carbsPct:   z.number().min(10).max(70),
  fatPct:     z.number().min(10).max(50),
}).refine(
  (s) => Math.abs(s.proteinPct + s.carbsPct + s.fatPct - 100) <= 1,
  { message: 'macroSplit deve somar 100%' }
);

export const GenerateDietPlanSchema = z.object({
  patientId:        z.string().uuid(),
  consultationId:   z.string().uuid().optional(),
  objectives:       z.string().min(5).max(500),
  customKcalTarget: z.number().int().min(800).max(5000).optional(),
  macroSplit:       MacroSplitSchema.optional(),
  durationDays:     z.number().int().min(7).max(90).default(30),
  mealTypes:        z.array(MealTypeSchema).min(1).optional(),
  extraContext:     z.string().max(1000).optional(),
});

export type GenerateDietPlanInput = z.infer<typeof GenerateDietPlanSchema>;
