// ─── IPasswordHasher ─────────────────────────────────────────────────────────

export interface IPasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

// ─── IEmbeddingService / IAIService ──────────────────────────────────────────

import { DietPlan, MacroTargets, MealType } from '../entities/DietPlan';
import { Food } from '../entities/Food';
import { Patient } from '../entities/Patient';

// ─── IEmbeddingService ───────────────────────────────────────────────────────

export interface IEmbeddingService {
  /** Converts a text description into a float vector for pgvector search */
  embed(text: string): Promise<number[]>;
  /** Generates and stores embeddings for all foods in the catalogue */
  embedFoodCatalogue(foods: Food[]): Promise<void>;
}

// ─── IAIService ──────────────────────────────────────────────────────────────

export interface GenerateDietPlanInput {
  patient: Patient;
  macroTargets: MacroTargets;
  candidateFoods: Food[];
  mealTypes: MealType[];
  objectives: string;
  extraContext?: string;   // free-text from nutritionist
}

export interface GenerateDietPlanOutput {
  plan: Omit<DietPlan, 'id' | 'patientId' | 'consultationId' | 'startDate' | 'endDate'>;
  rawResponse: string;
  usage: { promptTokens: number; completionTokens: number; model: string };
}

export interface IAIService {
  generateDietPlan(input: GenerateDietPlanInput): Promise<GenerateDietPlanOutput>;
}
