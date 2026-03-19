import { z } from 'zod';

const RestrictionTypeSchema = z.enum(['allergy', 'intolerance', 'clinical', 'preference']);

const PatientRestrictionSchema = z.object({
  type: RestrictionTypeSchema,
  description: z.string().min(2).max(200),
});

const ActivityLevelSchema = z.enum([
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);

export const CreatePatientSchema = z.object({
  name:              z.string().min(2).max(150),
  birthDate:         z.string().date(),   // ISO "YYYY-MM-DD", parsed to Date in use-case
  sex:               z.enum(['M', 'F']),
  heightCm:          z.number().int().min(50).max(250),
  activityLevel:     ActivityLevelSchema,
  restrictions:      z.array(PatientRestrictionSchema).default([]),
  culturalPreferences: z.string().max(300).optional(),
  routineNotes:      z.string().max(500).optional(),
  dislikedFoods:     z.array(z.string().max(100)).max(50).default([]),
});

export const UpdatePatientSchema = CreatePatientSchema.partial().omit({ birthDate: true }).extend({
  birthDate: z.string().date().optional(),
});

export const AddConsultationSchema = z.object({
  date:           z.string().datetime().optional(),   // defaults to now in use-case
  weightKg:       z.number().min(20).max(300),
  bodyFatPct:     z.number().min(1).max(70).optional(),
  muscleMassKg:   z.number().min(5).max(150).optional(),
  notes:          z.string().max(1000).optional(),
});

export type CreatePatientInput    = z.infer<typeof CreatePatientSchema>;
export type UpdatePatientInput    = z.infer<typeof UpdatePatientSchema>;
export type AddConsultationInput  = z.infer<typeof AddConsultationSchema>;
