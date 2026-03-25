/**
 * schema/core.ts
 *
 * Tabelas principais do domínio clínico:
 *   users → nutritionists → patients → consultations
 *   patients → diet_plans → diet_meals → diet_meal_items
 *   patients → patient_restrictions
 *
 * Decisões de design:
 *   - UUIDs como PKs: evita enumeração, facilita merge de dados
 *   - soft delete via deleted_at: preserva histórico clínico
 *   - jsonb para ai_generation_meta: schema flexível sem migrations para metadados de IA
 *   - timestamps em todas as tabelas: auditoria e sincronização offline
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  real,
  integer,
  smallint,
  jsonb,
  pgEnum,
  time,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['nutritionist', 'patient', 'admin']);

export const sexEnum = pgEnum('sex', ['M', 'F']);

export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary',    // 1.2
  'light',        // 1.375
  'moderate',     // 1.55
  'active',       // 1.725
  'very_active',  // 1.9
]);

export const restrictionTypeEnum = pgEnum('restriction_type', [
  'allergy',      // alergia com risco de anafilaxia
  'intolerance',  // intolerância (digestiva, metabólica)
  'clinical',     // condição clínica: diabetes, hipertensão, DRC
  'preference',   // escolha: vegano, vegetariano
]);

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast',        // café da manhã
  'morning_snack',    // lanche da manhã
  'lunch',            // almoço
  'afternoon_snack',  // lanche da tarde
  'dinner',           // jantar
  'supper',           // ceia
]);

export const dietPlanStatusEnum = pgEnum('diet_plan_status', [
  'draft',     // gerado, ainda não revisado
  'active',    // em uso pelo paciente
  'paused',    // pausado temporariamente
  'completed', // período encerrado
  'archived',  // arquivado pelo nutricionista
]);

export const objectiveTypeEnum = pgEnum('objective_type', [
  'weight_loss',
  'muscle_gain',
  'maintenance',
  'glycemic_control',
  'cardiovascular',
  'renal',
  'sports_performance',
  'general',
]);

// ─── users ────────────────────────────────────────────────────────────────────
// Tabela de autenticação unificada. Nutricionistas e pacientes são rows aqui,
// com perfis estendidos em tabelas separadas (nutritionists / patients).

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role:         userRoleEnum('role').notNull(),
  name:         varchar('name', { length: 255 }).notNull(),
  avatarUrl:    varchar('avatar_url', { length: 500 }),
  isActive:     boolean('is_active').notNull().default(true),
  lastLoginAt:  timestamp('last_login_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }), // soft delete
}, (t) => ({
  usersEmailUnique:  uniqueIndex('users_email_unique').on(t.email),
  usersRoleIdx:      index('users_role_idx').on(t.role),
  usersDeletedAtIdx: index('users_deleted_at_idx').on(t.deletedAt),
}));

// ─── nutritionists ────────────────────────────────────────────────────────────
// Perfil estendido do nutricionista. 1:1 com users.

export const nutritionists = pgTable('nutritionists', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  crn:          varchar('crn', { length: 20 }).notNull(),   // Conselho Regional de Nutrição
  specialty:    varchar('specialty', { length: 100 }),      // ex: "Nutrição esportiva"
  bio:          text('bio'),
  phoneNumber:  varchar('phone_number', { length: 20 }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nutritionistsUserIdUnique: uniqueIndex('nutritionists_user_id_unique').on(t.userId),
  nutritionistsCrnUnique:    uniqueIndex('nutritionists_crn_unique').on(t.crn),
}));

// ─── patients ─────────────────────────────────────────────────────────────────
// Paciente é vinculado ao nutricionista que o cadastrou.
// Dados biométricos BASE ficam aqui; evolução fica em consultations.

export const patients = pgTable('patients', {
  id:                uuid('id').primaryKey().defaultRandom(),
  nutritionistId:    uuid('nutritionist_id').notNull()
                       .references(() => nutritionists.id, { onDelete: 'restrict' }),
  // Pode ter conta de usuário para acesso ao app mobile (opcional)
  userId:            uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:              varchar('name', { length: 255 }).notNull(),
  birthDate:         date('birth_date').notNull(),
  sex:               sexEnum('sex').notNull(),
  heightCm:          real('height_cm').notNull(),
  activityLevel:     activityLevelEnum('activity_level').notNull().default('moderate'),
  // Preferências e contexto (enriquece o embedding de busca semântica)
  culturalPreferences: text('cultural_preferences'),
  routineNotes:        text('routine_notes'),
  dislikedFoods:       text('disliked_foods').array().default(sql`'{}'::text[]`),
  // Controle
  isActive:          boolean('is_active').notNull().default(true),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  patientsNutritionistIdIdx: index('patients_nutritionist_id_idx').on(t.nutritionistId),
  patientsUserIdIdx:         index('patients_user_id_idx').on(t.userId),
  patientsDeletedAtIdx:      index('patients_deleted_at_idx').on(t.deletedAt),
  // Garante que height_cm é positivo
  patientsHeightPositive:    check('patients_height_positive', sql`height_cm > 0`),
}));

// ─── patient_restrictions ─────────────────────────────────────────────────────
// Restrições alimentares e condições clínicas do paciente.
// Tabela separada: um paciente pode ter N restrições e elas mudam ao longo do tempo.

export const patientRestrictions = pgTable('patient_restrictions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  patientId:   uuid('patient_id').notNull()
                 .references(() => patients.id, { onDelete: 'cascade' }),
  type:        restrictionTypeEnum('type').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  severity:    varchar('severity', { length: 20 }),  // 'mild', 'moderate', 'severe'
  notes:       text('notes'),
  isActive:    boolean('is_active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientRestrictionsPatientIdIdx: index('patient_restrictions_patient_id_idx').on(t.patientId),
  patientRestrictionsTypeIdx:      index('patient_restrictions_type_idx').on(t.type),
}));

// ─── consultations ────────────────────────────────────────────────────────────
// Cada consulta registra medidas antropométricas no momento da consulta.
// Serve de base para calcular TDEE e gerar planos alimentares.

export const consultations = pgTable('consultations', {
  id:               uuid('id').primaryKey().defaultRandom(),
  patientId:        uuid('patient_id').notNull()
                      .references(() => patients.id, { onDelete: 'cascade' }),
  nutritionistId:   uuid('nutritionist_id').notNull()
                      .references(() => nutritionists.id, { onDelete: 'restrict' }),
  date:             date('date').notNull(),
  // Antropometria
  weightKg:         real('weight_kg').notNull(),
  bodyFatPct:       real('body_fat_pct'),
  muscleMassKg:     real('muscle_mass_kg'),
  visceralFatLevel: smallint('visceral_fat_level'),     // 1-59 (escala Tanita)
  waterPct:         real('water_pct'),
  boneMassKg:       real('bone_mass_kg'),
  // Circunferências (cm)
  waistCm:          real('waist_cm'),
  hipCm:            real('hip_cm'),
  armCm:            real('arm_cm'),
  calfCm:           real('calf_cm'),
  // Exames laboratoriais (jsonb para flexibilidade — campos variam por paciente)
  labResults:       jsonb('lab_results').$type<{
    glucose?:        number;   // mg/dL
    hba1c?:          number;   // %
    totalCholesterol?: number;
    hdl?:            number;
    ldl?:            number;
    triglycerides?:  number;
    creatinine?:     number;
    uricAcid?:       number;
    tsh?:            number;
    hemoglobin?:     number;
    ferritin?:       number;
    vitaminD?:       number;
    vitaminB12?:     number;
    [key: string]: number | undefined;
  }>(),
  notes:            text('notes'),
  nextConsultation: date('next_consultation'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  consultationsPatientIdIdx:   index('consultations_patient_id_idx').on(t.patientId),
  consultationsDateIdx:        index('consultations_date_idx').on(t.date),
  // Índice composto para buscar "última consulta de um paciente"
  consultationsPatientDateIdx: index('consultations_patient_date_idx').on(t.patientId, t.date),
  consultationsWeightPositive: check('consultations_weight_positive', sql`weight_kg > 0`),
  consultationsBodyFatRange:   check('consultations_body_fat_range',  sql`body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 70)`),
}));

// ─── diet_plans ───────────────────────────────────────────────────────────────
// Plano alimentar gerado (por IA ou manualmente) e vinculado a uma consulta.
// ai_generation_meta armazena metadados da geração sem precisar de schema fixo.

export const dietPlans = pgTable('diet_plans', {
  id:               uuid('id').primaryKey().defaultRandom(),
  patientId:        uuid('patient_id').notNull()
                      .references(() => patients.id, { onDelete: 'cascade' }),
  consultationId:   uuid('consultation_id')
                      .references(() => consultations.id, { onDelete: 'set null' }),
  status:           dietPlanStatusEnum('status').notNull().default('draft'),
  objectiveType:    objectiveTypeEnum('objective_type').notNull(),
  objectives:       text('objectives').notNull(),
  startDate:        date('start_date').notNull(),
  endDate:          date('end_date').notNull(),
  // Metas calóricas e de macros
  dailyKcalTarget:  integer('daily_kcal_target').notNull(),
  proteinGTarget:   real('protein_g_target').notNull(),
  carbsGTarget:     real('carbs_g_target').notNull(),
  fatGTarget:       real('fat_g_target').notNull(),
  proteinPct:       real('protein_pct').notNull(),
  carbsPct:         real('carbs_pct').notNull(),
  fatPct:           real('fat_pct').notNull(),
  // Totais reais gerados (calculados a partir dos itens)
  totalDailyKcal:   real('total_daily_kcal'),
  totalProteinG:    real('total_protein_g'),
  totalCarbsG:      real('total_carbs_g'),
  totalFatG:        real('total_fat_g'),
  // Metadados da geração por IA (null = criado manualmente)
  aiGenerationMeta: jsonb('ai_generation_meta').$type<{
    model:            string;
    promptTokens:     number;
    completionTokens: number;
    foodSourcesUsed:  string[];
    generatedAt:      string;     // ISO string
    semanticQueryMeta?: {
      objectiveType:       string;
      estimatedComplexity: string;
      candidateFoodsCount: number;
      topKRequested:       number;
    };
  } | null>().default(null),
  // Notas e revisões
  nutritionistNotes: text('nutritionist_notes'),
  isAiGenerated:     boolean('is_ai_generated').notNull().default(false),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dietPlansPatientIdIdx:           index('diet_plans_patient_id_idx').on(t.patientId),
  dietPlansStatusIdx:              index('diet_plans_status_idx').on(t.status),
  dietPlansConsultationIdIdx:      index('diet_plans_consultation_id_idx').on(t.consultationId),
  // Para listar planos ativos de um paciente com ordenação por data
  dietPlansPatientStatusStartIdx:  index('diet_plans_patient_status_start_idx').on(t.patientId, t.status, t.startDate),
  dietPlansDatesOrder:             check('diet_plans_dates_order',  sql`end_date > start_date`),
  dietPlansKcalPositive:           check('diet_plans_kcal_positive', sql`daily_kcal_target > 0`),
  dietPlansMacroPctSum:            check('diet_plans_macro_pct_sum',
    sql`ABS(protein_pct + carbs_pct + fat_pct - 100) <= 1`
  ),
}));

// ─── diet_meals ───────────────────────────────────────────────────────────────
// Uma refeição dentro de um plano. Ex: "café da manhã às 07:30".

export const dietMeals = pgTable('diet_meals', {
  id:               uuid('id').primaryKey().defaultRandom(),
  dietPlanId:       uuid('diet_plan_id').notNull()
                      .references(() => dietPlans.id, { onDelete: 'cascade' }),
  mealType:         mealTypeEnum('meal_type').notNull(),
  orderIndex:       smallint('order_index').notNull(),    // ordem de exibição no app
  scheduledTime:    time('scheduled_time'),               // ex: 07:30
  // Totais calculados (desnormalizados para evitar JOINs pesados no app mobile)
  totalKcal:        real('total_kcal').notNull().default(0),
  totalProteinG:    real('total_protein_g').notNull().default(0),
  totalCarbsG:      real('total_carbs_g').notNull().default(0),
  totalFatG:        real('total_fat_g').notNull().default(0),
  nutritionistNote: text('nutritionist_note'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dietMealsDietPlanIdIdx: index('diet_meals_diet_plan_id_idx').on(t.dietPlanId),
  dietMealsOrderIdx:      index('diet_meals_order_idx').on(t.dietPlanId, t.orderIndex),
}));

// ─── diet_meal_items ──────────────────────────────────────────────────────────
// Item individual dentro de uma refeição: "100g de arroz integral".
// Valores nutricionais são DESNORMALIZADOS aqui — snapshot do momento da geração.
// Isso evita que edições no catálogo de alimentos alterem planos já prescritos.

export const dietMealItems = pgTable('diet_meal_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  dietMealId:  uuid('diet_meal_id').notNull()
                 .references(() => dietMeals.id, { onDelete: 'cascade' }),
  foodId:      uuid('food_id').notNull()
                 .references(() => foods.id, { onDelete: 'restrict' }),
                 // restrict: não permite deletar alimento que está em plano ativo
  // Quantidade e nutrientes calculados (snapshot — NÃO referenciar food_sources direto)
  quantityG:   real('quantity_g').notNull(),
  kcal:        real('kcal').notNull(),
  proteinG:    real('protein_g').notNull(),
  carbsG:      real('carbs_g').notNull(),
  fatG:        real('fat_g').notNull(),
  fiberG:      real('fiber_g'),
  sodiumMg:    real('sodium_mg'),
  // Referência à fonte que foi usada no cálculo (rastreabilidade)
  sourceUsed:  varchar('source_used', { length: 10 }), // 'TBCA' | 'USDA' | 'OFF'
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dietMealItemsMealIdIdx:        index('diet_meal_items_meal_id_idx').on(t.dietMealId),
  dietMealItemsFoodIdIdx:        index('diet_meal_items_food_id_idx').on(t.foodId),
  dietMealItemsQuantityPositive: check('diet_meal_items_quantity_positive', sql`quantity_g > 0`),
  dietMealItemsKcalPositive:     check('diet_meal_items_kcal_positive',     sql`kcal >= 0`),
}));

// ─── Forward declaration para referência circular ─────────────────────────────
// (foods é definido em foods.ts, importado aqui apenas para FK)
import { foods } from './foods';
