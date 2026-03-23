/**
 * GenerateDietPlanUseCase
 *
 * Orchestrates the full RAG pipeline:
 *   1. Load patient data + last consultation
 *   2. Calculate macro targets (TDEE-based)
 *   3. Build semantic query from patient profile
 *   4. Retrieve candidate foods via pgvector similarity search
 *   5. Apply clinical filters (allergies, intolerances, caloric limits)
 *   6. Assemble structured prompt context
 *   7. Call Claude API to generate the plan
 *   8. Validate output against macro targets
 *   9. Persist and return the plan
 *
 * Clean Architecture: this class depends ONLY on domain interfaces.
 * All concrete implementations are injected via constructor (DIP).
 */

import {
  Patient,
  PatientRestriction,
  calculateTDEE,
} from '../entities/Patient';
import { Food } from '../entities/Food';
import {
  DietPlan,
  MacroTargets,
  MealType,
} from '../entities/DietPlan';
import {
  IPatientRepository,
  IFoodRepository,
  IDietPlanRepository,
  FoodSearchOptions,
} from '../repositories/interfaces';
import {
  IAIService,
  IEmbeddingService,
} from '../services/interfaces';
import { SemanticQueryBuilder } from './SemanticQueryBuilder';
import { DomainError } from '../errors/DomainError';

// ─── Input / Output DTOs ──────────────────────────────────────────────────────

export interface GenerateDietPlanRequest {
  patientId: string;
  consultationId?: string;

  /** Override TDEE-based kcal calculation */
  customKcalTarget?: number;

  /** Override default macro split (must sum to 100) */
  macroSplit?: {
    proteinPct: number;
    carbsPct: number;
    fatPct: number;
  };

  /** Diet objective, shown to the model */
  objectives: string;

  /** Plan duration in days */
  durationDays?: number;

  /** Which meals to include */
  mealTypes?: MealType[];

  /** Free-text the nutritionist wants the model to consider */
  extraContext?: string;
}

export interface GenerateDietPlanResponse {
  plan: DietPlan;
  warnings: string[];
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class GenerateDietPlanUseCase {
  // Default macro split when not specified
  private static readonly DEFAULT_MACRO_SPLIT = {
    proteinPct: 30,
    carbsPct:   45,
    fatPct:     25,
  };

  // How many candidate foods to retrieve from pgvector
  private static readonly TOP_K_FOODS = 30;

  // Default meal schedule
  private static readonly DEFAULT_MEALS: MealType[] = [
    'breakfast',
    'morning_snack',
    'lunch',
    'afternoon_snack',
    'dinner',
  ];

  private readonly queryBuilder = new SemanticQueryBuilder();

  constructor(
    private readonly patientRepo:  IPatientRepository,
    private readonly foodRepo:     IFoodRepository,
    private readonly dietPlanRepo: IDietPlanRepository,
    private readonly aiService:    IAIService,
    private readonly embedService: IEmbeddingService,
  ) {}

  // ─── Public entry point ────────────────────────────────────────────────────

  async execute(req: GenerateDietPlanRequest): Promise<GenerateDietPlanResponse> {
    // 1. Load patient with full profile
    const patient = await this.loadPatient(req.patientId);

    // 2. Compute macro targets
    const macroTargets = this.buildMacroTargets(patient, req);

    // 3. Build semantic search query from patient profile
    const queryResult = this.queryBuilder.build({
      patient,
      macroTargets,
      objectives:  req.objectives,
      mealTypes:   req.mealTypes ?? GenerateDietPlanUseCase.DEFAULT_MEALS,
      extraContext: req.extraContext,
    });

    const semanticQuery = queryResult.fullText;

    // 4. Generate embedding vector for the query
    const queryEmbedding = await this.embedService.embed(semanticQuery);

    // 5. Retrieve candidate foods via pgvector
    const candidateFoods = await this.retrieveCandidateFoods(
      patient,
      queryEmbedding,
      macroTargets,
    );

    // 6. Validate we have enough foods
    if (candidateFoods.length < 10) {
      throw new DomainError(
        `Insufficient candidate foods after filtering (${candidateFoods.length}). ` +
        'Check patient restrictions or expand food catalogue.'
      );
    }

    // 7. Generate plan via Claude
    const mealTypes = req.mealTypes ?? GenerateDietPlanUseCase.DEFAULT_MEALS;
    const aiOutput = await this.aiService.generateDietPlan({
      patient,
      macroTargets,
      candidateFoods,
      mealTypes,
      objectives: req.objectives,
      extraContext: req.extraContext,
    });

    // 8. Validate output
    const warnings = this.validatePlan(aiOutput.plan, macroTargets);

    // 9. Build and persist the final DietPlan entity
    const now = new Date();
    const durationDays = req.durationDays ?? 30;
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + durationDays);

    const plan: DietPlan = {
      ...aiOutput.plan,
      patientId:      patient.id,
      consultationId: req.consultationId,
      startDate:      now,
      endDate,
      objectives:     req.objectives,
      macroTargets,
      aiGenerationMeta: {
        model:              aiOutput.usage.model,
        promptTokens:       aiOutput.usage.promptTokens,
        completionTokens:   aiOutput.usage.completionTokens,
        foodSourcesUsed:    [...new Set(candidateFoods.map(f => f.primarySource))],
        generatedAt:        now,
      },
    };

    const saved = await this.dietPlanRepo.save(plan);

    return { plan: saved, warnings };
  }

  // ─── Step 1: Load patient ──────────────────────────────────────────────────

  private async loadPatient(patientId: string): Promise<Patient> {
    const patient = await this.patientRepo.findById(patientId);
    if (!patient) {
      throw new DomainError(`Patient not found: ${patientId}`);
    }
    if (!patient.lastConsultation) {
      throw new DomainError(
        `Patient ${patientId} has no consultations. At least one consultation ` +
        'is required to generate a diet plan.'
      );
    }
    return patient;
  }

  // ─── Step 2: Macro targets ─────────────────────────────────────────────────

  private buildMacroTargets(
    patient: Patient,
    req: GenerateDietPlanRequest,
  ): MacroTargets {
    const weightKg = patient.lastConsultation!.weightKg;

    // TDEE = BMR × activity multiplier (Mifflin-St Jeor)
    const tdee = calculateTDEE(patient, weightKg);

    // Apply objective-based adjustment
    const kcal = req.customKcalTarget ?? this.adjustKcalForObjective(tdee, req.objectives);

    const split = req.macroSplit ?? GenerateDietPlanUseCase.DEFAULT_MACRO_SPLIT;

    // Validate macro split sums to 100
    const total = split.proteinPct + split.carbsPct + split.fatPct;
    if (Math.abs(total - 100) > 1) {
      throw new DomainError(`Macro split must sum to 100, got ${total}`);
    }

    // Convert percentages to grams
    // Protein: 4 kcal/g  |  Carbs: 4 kcal/g  |  Fat: 9 kcal/g
    return {
      kcal,
      proteinPct: split.proteinPct,
      carbsPct:   split.carbsPct,
      fatPct:     split.fatPct,
      proteinG:   Math.round((kcal * split.proteinPct / 100) / 4),
      carbsG:     Math.round((kcal * split.carbsPct   / 100) / 4),
      fatG:       Math.round((kcal * split.fatPct     / 100) / 9),
    };
  }

  private adjustKcalForObjective(tdee: number, objectives: string): number {
    const obj = objectives.toLowerCase();
    if (obj.includes('emagrecimento') || obj.includes('perda de peso') || obj.includes('weight loss')) {
      return Math.round(tdee * 0.8);    // 20% deficit
    }
    if (obj.includes('hipertrofia') || obj.includes('ganho de massa') || obj.includes('muscle gain')) {
      return Math.round(tdee * 1.1);    // 10% surplus
    }
    return tdee; // maintenance
  }

  // ─── Step 3: Semantic query ────────────────────────────────────────────────

  /**
   * Builds a rich natural-language description of what this patient needs.
   * This text is embedded into a vector and used to search foods by semantic
   * similarity in pgvector. The richer the description, the better the retrieval.
   */
  private buildSemanticQuery(
    patient: Patient,
    macros: MacroTargets,
    objectives: string,
  ): string {
    const consultation = patient.lastConsultation!;
    const age = Math.floor(
      (Date.now() - patient.birthDate.getTime()) / (365.25 * 24 * 3600 * 1000)
    );
    const bmi = (consultation.weightKg / Math.pow(patient.heightCm / 100, 2)).toFixed(1);

    const restrictions = patient.restrictions
      .map(r => r.description)
      .join(', ') || 'nenhuma';

    const lines = [
      `Paciente: ${age} anos, ${patient.sex === 'M' ? 'masculino' : 'feminino'}, ` +
      `${consultation.weightKg}kg, ${patient.heightCm}cm, IMC ${bmi}.`,

      `Objetivo: ${objectives}.`,

      `Meta calórica: ${macros.kcal} kcal/dia. ` +
      `Proteína: ${macros.proteinG}g, Carboidrato: ${macros.carbsG}g, Gordura: ${macros.fatG}g.`,

      `Nível de atividade: ${patient.activityLevel}.`,

      `Restrições alimentares: ${restrictions}.`,

      patient.culturalPreferences
        ? `Preferências culturais: ${patient.culturalPreferences}.`
        : '',

      patient.routineNotes
        ? `Rotina: ${patient.routineNotes}.`
        : '',

      consultation.bodyFatPct
        ? `Gordura corporal: ${consultation.bodyFatPct}%. ` +
          `Massa muscular: ${consultation.muscleMassKg ?? 'desconhecida'}kg.`
        : '',

      // Hints to improve food retrieval quality
      this.buildRetrievalHints(patient, objectives),
    ];

    return lines.filter(Boolean).join(' ');
  }

  private buildRetrievalHints(patient: Patient, objectives: string): string {
    const hints: string[] = [];
    const obj = objectives.toLowerCase();
    const restrictions = patient.restrictions.map(r => r.description.toLowerCase());

    if (obj.includes('hipertrofia') || obj.includes('massa')) {
      hints.push('alimentos ricos em proteína completa, frango, ovos, leguminosas, laticínios magros');
    }
    if (obj.includes('emagrecimento') || obj.includes('perda')) {
      hints.push('alimentos com alto volume e baixa caloria, vegetais, fibras, proteína magra');
    }
    if (obj.includes('diabetes') || obj.includes('glicemia')) {
      hints.push('alimentos com baixo índice glicêmico, fibras solúveis, grãos integrais');
    }
    if (obj.includes('hipertensão') || obj.includes('pressão')) {
      hints.push('alimentos com baixo teor de sódio, potássio, magnésio, DASH diet');
    }

    const hasLactoseIntolerance = restrictions.some(r => r.includes('lactose'));
    if (hasLactoseIntolerance) {
      hints.push('evitar laticínios, preferir bebidas vegetais, tofu, fontes alternativas de cálcio');
    }

    const hasGlutenRestriction = restrictions.some(r => r.includes('glúten') || r.includes('celíaco'));
    if (hasGlutenRestriction) {
      hints.push('alimentos naturalmente sem glúten, arroz, milho, quinoa, mandioca, batata-doce');
    }

    return hints.join('; ');
  }

  // ─── Step 4: Food retrieval + filtering ───────────────────────────────────

  private async retrieveCandidateFoods(
    patient: Patient,
    queryEmbedding: number[],
    macros: MacroTargets,
  ): Promise<Food[]> {
    const { excludeTags, excludeNames } = this.buildExclusionLists(patient.restrictions);

    const searchOptions: FoodSearchOptions = {
      queryEmbedding,
      topK: GenerateDietPlanUseCase.TOP_K_FOODS,
      excludeTags,
      excludeNames,
      // Retrieve foods up to 3× the total daily kcal target per 100g
      // (ensures high-density foods like nuts are included)
      kcalRange: { max: macros.kcal * 3 / 100 },
    };

    const foods = await this.foodRepo.searchBySimilarity(searchOptions);

    // Secondary filter: remove explicitly disliked foods
    const disliked = (patient.dislikedFoods ?? []).map(f => f.toLowerCase());
    return foods.filter(f => !disliked.includes(f.namePt.toLowerCase()));
  }

  /**
   * Converts patient restrictions to pgvector filter lists.
   * Uses a controlled vocabulary so the filter is precise.
   */
  private buildExclusionLists(restrictions: PatientRestriction[]): {
    excludeTags: string[];
    excludeNames: string[];
  } {
    const RESTRICTION_TAG_MAP: Record<string, string[]> = {
      'lactose':      ['dairy', 'lactose', 'milk', 'cheese', 'yogurt', 'laticínio'],
      'glúten':       ['gluten', 'wheat', 'barley', 'rye', 'trigo', 'centeio', 'cevada'],
      'celíaco':      ['gluten', 'wheat', 'barley', 'rye', 'trigo'],
      'amendoim':     ['peanut', 'amendoim'],
      'frutos do mar':['shellfish', 'seafood', 'frutos do mar', 'camarão', 'mariscos'],
      'vegano':       ['meat', 'fish', 'dairy', 'egg', 'carne', 'peixe', 'ovo', 'laticínio'],
      'vegetariano':  ['meat', 'fish', 'carne', 'peixe'],
    };

    const excludeTags = new Set<string>();
    const excludeNames: string[] = [];

    for (const restriction of restrictions) {
      const desc = restriction.description.toLowerCase();
      for (const [keyword, tags] of Object.entries(RESTRICTION_TAG_MAP)) {
        if (desc.includes(keyword)) {
          tags.forEach(t => excludeTags.add(t));
        }
      }
      // Specific allergies with exact food names
      if (restriction.type === 'allergy') {
        excludeNames.push(restriction.description);
      }
    }

    return {
      excludeTags:  [...excludeTags],
      excludeNames,
    };
  }

  // ─── Step 8: Validation ───────────────────────────────────────────────────

  /**
   * Validates that the generated plan's totals are within
   * acceptable clinical tolerance of the macro targets.
   */
  private validatePlan(
    plan: Omit<DietPlan, 'id' | 'patientId' | 'consultationId' | 'startDate' | 'endDate'>,
    targets: MacroTargets,
  ): string[] {
    const warnings: string[] = [];
    const KCAL_TOLERANCE   = 0.10; // ±10%
    const MACRO_TOLERANCE  = 0.15; // ±15%

    const kcalDiff = Math.abs(plan.totalDailyKcal - targets.kcal) / targets.kcal;
    if (kcalDiff > KCAL_TOLERANCE) {
      warnings.push(
        `Caloric total (${plan.totalDailyKcal} kcal) deviates ${(kcalDiff * 100).toFixed(1)}% ` +
        `from target (${targets.kcal} kcal). Consider manual adjustment.`
      );
    }

    const proteinDiff = Math.abs(plan.totalDailyProteinG - targets.proteinG) / targets.proteinG;
    if (proteinDiff > MACRO_TOLERANCE) {
      warnings.push(
        `Protein (${plan.totalDailyProteinG}g) deviates ${(proteinDiff * 100).toFixed(1)}% ` +
        `from target (${targets.proteinG}g).`
      );
    }

    const carbsDiff = Math.abs(plan.totalDailyCarbsG - targets.carbsG) / targets.carbsG;
    if (carbsDiff > MACRO_TOLERANCE) {
      warnings.push(
        `Carbs (${plan.totalDailyCarbsG}g) deviates ${(carbsDiff * 100).toFixed(1)}% ` +
        `from target (${targets.carbsG}g).`
      );
    }

    if (plan.meals.length === 0) {
      warnings.push('Generated plan has no meals. This is likely an AI parsing error.');
    }

    return warnings;
  }
}