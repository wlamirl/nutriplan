import { pgTable, uuid, text, timestamp, numeric, pgEnum, date } from 'drizzle-orm/pg-core';
import { nutritionists } from './users';

export const sexEnum = pgEnum('sex', ['M', 'F']);

export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary', 'light', 'moderate', 'active', 'very_active',
]);

export const restrictionTypeEnum = pgEnum('restriction_type', [
  'allergy', 'intolerance', 'clinical', 'preference',
]);

export const patients = pgTable('patients', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  nutritionistId:      uuid('nutritionist_id').notNull().references(() => nutritionists.id, { onDelete: 'cascade' }),
  name:                text('name').notNull(),
  birthDate:           date('birth_date').notNull(),
  sex:                 sexEnum('sex').notNull(),
  heightCm:            numeric('height_cm', { precision: 5, scale: 1 }).notNull(),
  activityLevel:       activityLevelEnum('activity_level').notNull(),
  culturalPreferences: text('cultural_preferences'),
  routineNotes:        text('routine_notes'),
  dislikedFoods:       text('disliked_foods').array().notNull().default([]),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
});

export const patientRestrictions = pgTable('patient_restrictions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  patientId:   uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  type:        restrictionTypeEnum('type').notNull(),
  description: text('description').notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

export const consultations = pgTable('consultations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  patientId:    uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  date:         timestamp('date').defaultNow().notNull(),
  weightKg:     numeric('weight_kg', { precision: 5, scale: 2 }).notNull(),
  bodyFatPct:   numeric('body_fat_pct', { precision: 4, scale: 1 }),
  muscleMassKg: numeric('muscle_mass_kg', { precision: 5, scale: 2 }),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
});
