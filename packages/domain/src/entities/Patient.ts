export type Sex = 'M' | 'F';

export type ActivityLevel =
  | 'sedentary'      // 1.2  — desk job, no exercise
  | 'light'          // 1.375 — light exercise 1-3x/week
  | 'moderate'       // 1.55  — moderate exercise 3-5x/week
  | 'active'         // 1.725 — hard exercise 6-7x/week
  | 'very_active';   // 1.9   — physical job + daily training

export type RestrictionType =
  | 'allergy'
  | 'intolerance'
  | 'clinical'       // e.g. diabetes, hypertension, CKD
  | 'preference';    // e.g. vegetarian, vegan, no red meat

export interface PatientRestriction {
  id: string;
  type: RestrictionType;
  description: string;       // e.g. "Lactose intolerance", "Peanut allergy"
}

export interface Consultation {
  id: string;
  date: Date;
  weightKg: number;
  bodyFatPct?: number;
  muscleMassKg?: number;
  notes?: string;
}

export interface Patient {
  id: string;
  name: string;
  birthDate: Date;
  sex: Sex;
  heightCm: number;
  activityLevel: ActivityLevel;
  restrictions: PatientRestriction[];
  lastConsultation?: Consultation;
  // Preferences and routine
  culturalPreferences?: string;      // e.g. "Brazilian cuisine"
  routineNotes?: string;             // e.g. "trains at 6am, late dinner"
  dislikedFoods?: string[];          // food names to avoid
}

/**
 * Mifflin-St Jeor BMR calculation
 */
export function calculateBMR(patient: Patient, weightKg: number): number {
  const age = Math.floor(
    (Date.now() - patient.birthDate.getTime()) / (365.25 * 24 * 3600 * 1000)
  );
  const h = patient.heightCm;
  const w = weightKg;

  if (patient.sex === 'M') {
    return 10 * w + 6.25 * h - 5 * age + 5;
  } else {
    return 10 * w + 6.25 * h - 5 * age - 161;
  }
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
};

export function calculateTDEE(patient: Patient, weightKg: number): number {
  const bmr = calculateBMR(patient, weightKg);
  return Math.round(bmr * ACTIVITY_MULTIPLIERS[patient.activityLevel]);
}
