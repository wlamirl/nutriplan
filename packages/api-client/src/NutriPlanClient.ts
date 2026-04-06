/**
 * packages/api-client/src/NutriPlanClient.ts
 *
 * Cliente HTTP tipado para consumo do API Gateway.
 * Compatível com Web (React) e Mobile (React Native / Expo).
 *
 * Uso no Web:
 *   const client = createNutriPlanClient({
 *     baseUrl: import.meta.env.VITE_API_URL,
 *     tokenStorage: localStorageTokenStorage(),
 *   });
 *
 * Uso no Mobile:
 *   import * as SecureStore from 'expo-secure-store';
 *   const client = createNutriPlanClient({
 *     baseUrl: process.env.EXPO_PUBLIC_API_URL,
 *     tokenStorage: expoSecureStoreTokenStorage(),
 *   });
 */

import type { ApiResponse, ApiErrorResponse, PaginatedResponse, PaginationQuery } from '../../shared';

// ─── Token Storage interface ──────────────────────────────────────────────────
// Abstração que permite que web e mobile forneçam sua própria implementação
// de armazenamento seguro de tokens.

export interface TokenStorage {
  get():              Promise<string | null>;
  set(token: string): Promise<void>;
  remove():           Promise<void>;
}

// ─── Implementações prontas de TokenStorage ───────────────────────────────────

/** Para uso no Web — armazena em localStorage. */
export function localStorageTokenStorage(key = 'nutriplan:token'): TokenStorage {
  return {
    get:    () => Promise.resolve(localStorage.getItem(key)),
    set:    (t) => { localStorage.setItem(key, t); return Promise.resolve(); },
    remove: () => { localStorage.removeItem(key); return Promise.resolve(); },
  };
}

/**
 * Para uso no Mobile (Expo).
 * Receba a instância SecureStore como parâmetro para não criar dependência
 * direta de 'expo-secure-store' neste pacote (que é agnóstico a plataforma).
 *
 * Exemplo:
 *   import * as SecureStore from 'expo-secure-store';
 *   expoSecureStoreTokenStorage(SecureStore)
 */
export function expoSecureStoreTokenStorage(
  store: {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
  },
  key = 'nutriplan:token',
): TokenStorage {
  return {
    get:    () => store.getItemAsync(key),
    set:    (t) => store.setItemAsync(key, t),
    remove: () => store.deleteItemAsync(key),
  };
}

// ─── Erros ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status:  number,
    public readonly code:    string | undefined,
    message:                 string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Configuração do cliente ──────────────────────────────────────────────────

export interface NutriPlanClientConfig {
  /** URL base do gateway. Ex: https://api.nutriplan.com ou http://localhost:8080 */
  baseUrl:       string;
  tokenStorage:  TokenStorage;
  /** Timeout em ms (padrão: 30 000). Operações de IA podem demorar mais. */
  timeoutMs?:    number;
}

// ─── Tipos de domínio expostos pelo cliente ───────────────────────────────────

export interface AuthTokens {
  token:     string;
  expiresIn: string;
}

export interface UserMe {
  id:    string;
  email: string;
  name:  string;
  role:  string;
}

export interface Patient {
  id:             string;
  name:           string;
  birthDate:      string;
  sex:            'M' | 'F';
  heightCm:       number;
  activityLevel:  string;
  nutritionistId: string;
  createdAt:      string;
  updatedAt:      string;
}

export interface CreatePatientInput {
  name:                string;
  birthDate:           string; // ISO 'YYYY-MM-DD'
  sex:                 'M' | 'F';
  heightCm:            number;
  activityLevel:       string;
  culturalPreferences?: string;
  routineNotes?:       string;
  dislikedFoods?:      string[];
}

export interface Consultation {
  id:             string;
  patientId:      string;
  date:           string;
  weightKg:       number;
  bodyFatPct?:    number;
  muscleMassKg?:  number;
  notes?:         string;
  createdAt:      string;
}

export interface CreateConsultationInput {
  date:           string;
  weightKg:       number;
  bodyFatPct?:    number;
  muscleMassKg?:  number;
  notes?:         string;
}

export interface DietPlan {
  id:               string;
  patientId:        string;
  status:           string;
  objectiveType:    string;
  objectives:       string;
  startDate:        string;
  endDate:          string;
  dailyKcalTarget:  number;
  isAiGenerated:    boolean;
  createdAt:        string;
}

export interface GenerateDietPlanInput {
  patientId:      string;
  consultationId?: string;
  objectives:     string;
  objectiveType:  string;
  startDate:      string;
  endDate:        string;
}

export interface Food {
  id:            string;
  namePt:        string;
  nameEn?:       string;
  category:      string;
  subcategory?:  string;
  primarySource: string;
}

export interface FoodSearchQuery extends PaginationQuery {
  q?:           string;
  category?:    string;
  source?:      'TBCA' | 'USDA' | 'OFF';
  minKcal?:     number;
  maxKcal?:     number;
}

// ─── Classe base com lógica de fetch ─────────────────────────────────────────

class BaseResource {
  constructor(protected readonly client: NutriPlanClient) {}

  protected async request<T>(
    method:  string,
    path:    string,
    body?:   unknown,
  ): Promise<T> {
    const token   = await this.client.tokenStorage.get();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout    = setTimeout(
      () => controller.abort(),
      this.client.timeoutMs ?? 30_000,
    );

    let response: Response;
    try {
      response = await fetch(`${this.client.baseUrl}${path}`, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(408, 'TIMEOUT', 'A requisição excedeu o tempo limite.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) return undefined as T;

    const json = await response.json() as T | ApiErrorResponse;

    if (!response.ok) {
      const err = json as ApiErrorResponse;
      throw new ApiError(response.status, err.code, err.error, err.details);
    }

    return json as T;
  }

  protected _get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  protected _post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  protected _put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  protected _patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  protected _delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

// ─── Resources ────────────────────────────────────────────────────────────────

class AuthResource extends BaseResource {
  async register(data: {
    name:     string;
    email:    string;
    password: string;
    crn:      string;
  }): Promise<ApiResponse<AuthTokens>> {
    return this._post('/auth/register', data);
  }

  async login(data: {
    email:    string;
    password: string;
  }): Promise<ApiResponse<AuthTokens & { user: UserMe }>> {
    const result = await this._post<ApiResponse<AuthTokens & { user: UserMe }>>('/auth/login', data);
    await this.client.tokenStorage.set(result.data.token);
    return result;
  }

  async me(): Promise<ApiResponse<UserMe>> {
    return this._get('/auth/me');
  }

  async logout(): Promise<void> {
    await this.client.tokenStorage.remove();
  }
}

class PatientsResource extends BaseResource {
  list(): Promise<ApiResponse<Patient[]>> {
    return this._get<ApiResponse<Patient[]>>('/patients');
  }

  get(id: string): Promise<ApiResponse<Patient>> {
    return this._get<ApiResponse<Patient>>(`/patients/${id}`);
  }

  create(data: CreatePatientInput): Promise<ApiResponse<Patient>> {
    return this._post<ApiResponse<Patient>>('/patients', data);
  }

  update(id: string, data: Partial<CreatePatientInput>): Promise<ApiResponse<Patient>> {
    return this._patch<ApiResponse<Patient>>(`/patients/${id}`, data);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  listConsultations(patientId: string): Promise<ApiResponse<Consultation[]>> {
    return this._get<ApiResponse<Consultation[]>>(`/patients/${patientId}/consultations`);
  }

  addConsultation(
    patientId: string,
    data: CreateConsultationInput,
  ): Promise<ApiResponse<Consultation>> {
    return this._post<ApiResponse<Consultation>>(`/patients/${patientId}/consultations`, data);
  }
}

class DietPlansResource extends BaseResource {
  list(patientId?: string): Promise<ApiResponse<DietPlan[]>> {
    const qs = patientId ? `?patientId=${patientId}` : '';
    return this._get<ApiResponse<DietPlan[]>>(`/diet-plans${qs}`);
  }

  get(id: string): Promise<ApiResponse<DietPlan>> {
    return this._get<ApiResponse<DietPlan>>(`/diet-plans/${id}`);
  }

  /**
   * Gera um plano alimentar via IA.
   * Rota sujeita a rate limiting agressivo no gateway (10 req/min).
   * Pode demorar 10–30 s — o timeout padrão já é 30 s.
   */
  generate(data: GenerateDietPlanInput): Promise<ApiResponse<DietPlan>> {
    return this._post<ApiResponse<DietPlan>>('/diet-plans', data);
  }

  updateStatus(
    id: string,
    status: 'active' | 'paused' | 'completed' | 'archived',
  ): Promise<ApiResponse<DietPlan>> {
    return this._patch<ApiResponse<DietPlan>>(`/diet-plans/${id}/status`, { status });
  }
}

class FoodsResource extends BaseResource {
  search(query: FoodSearchQuery = {}): Promise<PaginatedResponse<Food>> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._get<PaginatedResponse<Food>>(`/foods${qs}`);
  }

  get(id: string): Promise<ApiResponse<Food>> {
    return this._get<ApiResponse<Food>>(`/foods/${id}`);
  }

  /** Admin only — aciona sync manual de uma fonte */
  triggerSync(source: 'TBCA' | 'USDA' | 'OFF'): Promise<ApiResponse<{ jobId: string }>> {
    return this._post<ApiResponse<{ jobId: string }>>(`/admin/sync/${source}`);
  }
}

// ─── NutriPlanClient (ponto de entrada público) ───────────────────────────────

export class NutriPlanClient {
  readonly tokenStorage: TokenStorage;
  readonly timeoutMs:    number;
  readonly baseUrl:      string;

  readonly auth:      AuthResource;
  readonly patients:  PatientsResource;
  readonly dietPlans: DietPlansResource;
  readonly foods:     FoodsResource;

  constructor(config: NutriPlanClientConfig) {
    this.baseUrl      = config.baseUrl.replace(/\/$/, ''); // remove trailing slash
    this.tokenStorage = config.tokenStorage;
    this.timeoutMs    = config.timeoutMs ?? 30_000;

    this.auth      = new AuthResource(this);
    this.patients  = new PatientsResource(this);
    this.dietPlans = new DietPlansResource(this);
    this.foods     = new FoodsResource(this);
  }
}

/** Factory de conveniência */
export function createNutriPlanClient(config: NutriPlanClientConfig): NutriPlanClient {
  return new NutriPlanClient(config);
}
