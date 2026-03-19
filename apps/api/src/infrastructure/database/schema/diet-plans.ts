import { pgTable, uuid, text, timestamp, integer, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { patients, consultations } from './patients';

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper',
]);

export const dietPlans = pgTable('diet_plans', {
  id:             uuid('id').primaryKey().defaultRandom(),
  patientId:      uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  consultationId: uuid('consultation_id').references(() => consultations.id),
  startDate:      timestamp('start_date').notNull(),
  endDate:        timestamp('end_date').notNull(),
  objectives:     text('objectives').notNull(),
  // macro targets
  targetKcal:      integer('target_kcal').notNull(),
  targetProteinG:  integer('target_protein_g').notNull(),
  targetCarbsG:    integer('target_carbs_g').notNull(),
  targetFatG:      integer('target_fat_g').notNull(),
  targetProteinPct: integer('target_protein_pct').notNull(),
  targetCarbsPct:  integer('target_carbs_pct').notNull(),
  targetFatPct:    integer('target_fat_pct').notNull(),
  // daily totals (from AI output)
  totalDailyKcal:     integer('total_daily_kcal').notNull(),
  totalDailyProteinG: numeric('total_daily_protein_g', { precision: 6, scale: 1 }).notNull(),
  totalDailyCarbsG:   numeric('total_daily_carbs_g',   { precision: 6, scale: 1 }).notNull(),
  totalDailyFatG:     numeric('total_daily_fat_g',     { precision: 6, scale: 1 }).notNull(),
  // AI metadata
  aiModel:            text('ai_model'),
  aiPromptTokens:     integer('ai_prompt_tokens'),
  aiCompletionTokens: integer('ai_completion_tokens'),
  aiFoodSources:      text('ai_food_sources').array(),
  aiGeneratedAt:      timestamp('ai_generated_at'),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
});

export const dietMeals = pgTable('diet_meals', {
  id:               uuid('id').primaryKey().defaultRandom(),
  dietPlanId:       uuid('diet_plan_id').notNull().references(() => dietPlans.id, { onDelete: 'cascade' }),
  mealType:         mealTypeEnum('meal_type').notNull(),
  scheduledTime:    text('scheduled_time'),   // e.g. "07:30"
  totalKcal:        integer('total_kcal').notNull(),
  totalProteinG:    numeric('total_protein_g', { precision: 6, scale: 1 }).notNull(),
  totalCarbsG:      numeric('total_carbs_g',   { precision: 6, scale: 1 }).notNull(),
  totalFatG:        numeric('total_fat_g',     { precision: 6, scale: 1 }).notNull(),
  nutritionistNote: text('nutritionist_note'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
});

export const dietMealItems = pgTable('diet_meal_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  dietMealId: uuid('diet_meal_id').notNull().references(() => dietMeals.id, { onDelete: 'cascade' }),
  foodId:     uuid('food_id').notNull(),  // sem FK cascade — remoção de alimento é rara e controlada
  quantityG:  numeric('quantity_g', { precision: 6, scale: 1 }).notNull(),
  kcal:       integer('kcal').notNull(),
  proteinG:   numeric('protein_g', { precision: 5, scale: 1 }).notNull(),
  carbsG:     numeric('carbs_g',   { precision: 5, scale: 1 }).notNull(),
  fatG:       numeric('fat_g',     { precision: 5, scale: 1 }).notNull(),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
});
