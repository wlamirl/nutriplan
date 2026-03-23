import { Patient } from '../entities/Patient';
import { Food, FoodSource } from '../entities/Food';
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

export interface UpsertFoodResult {
  food: Food;
  /** true = novo registro inserido, false = registro existente atualizado */
  created: boolean;
}

export interface IFoodRepository {
  /** Semantic similarity search using pgvector cosine distance */
  searchBySimilarity(options: FoodSearchOptions): Promise<Food[]>;
  findById(id: string): Promise<Food | null>;
  findByName(name: string): Promise<Food[]>;
  upsert(food: Food): Promise<UpsertFoodResult>;
  findAll(options?: { limit?: number; offset?: number }): Promise<Food[]>;
  findWithoutEmbeddings(limit?: number): Promise<Food[]>;
  saveEmbedding(foodId: string, embedding: number[]): Promise<void>;
  countAll(): Promise<number>;
}

// ─── ISyncLogRepository ──────────────────────────────────────────────────────

export interface SyncLogEntry {
  id: string;
  source: FoodSource;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalProcessed: number;
  totalInserted: number;
  totalUpdated: number;
  totalFailed: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
}

export interface ISyncLogRepository {
  create(source: FoodSource): Promise<SyncLogEntry>;
  update(id: string, data: Partial<Omit<SyncLogEntry, 'id' | 'source' | 'createdAt' | 'startedAt'>>): Promise<SyncLogEntry>;
  findAll(source?: FoodSource): Promise<SyncLogEntry[]>;
  findById(id: string): Promise<SyncLogEntry | null>;
}

// ─── IDietPlanRepository ─────────────────────────────────────────────────────

export interface IDietPlanRepository {
  findById(id: string): Promise<DietPlan | null>;
  findByPatientId(patientId: string): Promise<DietPlan[]>;
  save(plan: DietPlan): Promise<DietPlan>;
  update(id: string, data: Partial<DietPlan>): Promise<DietPlan>;
  delete(id: string): Promise<void>;
}
