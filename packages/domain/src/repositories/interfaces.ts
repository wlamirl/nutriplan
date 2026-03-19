import { Patient } from '../entities/Patient';
import { Food } from '../entities/Food';
import { DietPlan } from '../entities/DietPlan';

// ─── IPatientRepository ──────────────────────────────────────────────────────

export interface IPatientRepository {
  findById(id: string): Promise<Patient | null>;
  findByNutritionistId(nutritionistId: string): Promise<Patient[]>;
  save(patient: Patient): Promise<Patient>;
  update(id: string, data: Partial<Patient>): Promise<Patient>;
}

// ─── IFoodRepository ─────────────────────────────────────────────────────────

export interface FoodSearchOptions {
  /** Embedding vector of the query text */
  queryEmbedding: number[];
  /** Number of results to return */
  topK?: number;
  /** Exclude foods with these tags or names (allergies/intolerances) */
  excludeTags?: string[];
  excludeNames?: string[];
  /** Only return foods whose kcal/100g is within this range */
  kcalRange?: { min?: number; max?: number };
  /** Filter by category */
  categories?: string[];
}

export interface IFoodRepository {
  /** Semantic similarity search using pgvector cosine distance */
  searchBySimilarity(options: FoodSearchOptions): Promise<Food[]>;
  findById(id: string): Promise<Food | null>;
  findByName(name: string): Promise<Food[]>;
  upsert(food: Food): Promise<Food>;
}

// ─── IDietPlanRepository ─────────────────────────────────────────────────────

export interface IDietPlanRepository {
  findById(id: string): Promise<DietPlan | null>;
  findByPatientId(patientId: string): Promise<DietPlan[]>;
  save(plan: DietPlan): Promise<DietPlan>;
  update(id: string, data: Partial<DietPlan>): Promise<DietPlan>;
}
