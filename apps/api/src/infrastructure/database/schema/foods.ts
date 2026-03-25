/**
 * schema/foods.ts
 *
 * Catálogo de alimentos com suporte a múltiplas fontes (TBCA, USDA, OFF)
 * e busca semântica via pgvector.
 *
 * Arquitetura:
 *   foods          → entidade canônica (nome, categoria, tags)
 *   food_sources   → valores nutricionais por fonte (1 food : N sources)
 *   food_embeddings → vetor float[1536] para busca semântica
 *   food_tags      → tags para filtros de busca (textura, preparo, origem)
 *   sync_logs      → histórico de sincronizações externas
 *
 * Decisões de design:
 *   - food_sources separada: permite auditoria por fonte e reconciliação de conflitos
 *   - Nutrientes base em colunas tipadas (kcal, protein, carbs, fat, fiber):
 *     consultados 100% do tempo, precisam de índice e constraint CHECK
 *   - Micronutrientes em extra_nutrients jsonb:
 *     ~40 micronutrientes, nem todos presentes em todas as fontes,
 *     evitar 40 colunas nullable
 *   - food_embeddings separada da foods: pode ser regenerada sem afetar o core
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  real,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Tipo customizado: vector(1536) do pgvector ───────────────────────────────
// Drizzle não tem suporte nativo a pgvector ainda — usar customType.

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    // config pode ter { dimensions: number }
    const dims = (config as { dimensions?: number })?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  toDriver(value: number[]): string {
    // Postgres espera: '[0.1, 0.2, ...]'
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Postgres retorna: '[0.1,0.2,...]'
    return value.replace(/[\[\]]/g, '').split(',').map(Number);
  },
});

// ─── Enums ────────────────────────────────────────────────────────────────────

export const foodSourceEnum = pgEnum('food_source', ['TBCA', 'USDA', 'OFF']);

export const syncStatusEnum = pgEnum('sync_status', [
  'running',
  'success',
  'partial',    // concluído com erros em alguns registros
  'failed',
]);

// ─── foods ────────────────────────────────────────────────────────────────────
// Entidade canônica do alimento. Identidade sem valores nutricionais.
// Valores nutricionais ficam em food_sources (por fonte).

export const foods = pgTable('foods', {
  id:              uuid('id').primaryKey().defaultRandom(),
  namePt:          varchar('name_pt', { length: 255 }).notNull(),   // nome em português
  nameEn:          varchar('name_en', { length: 255 }),
  // Hierarquia de categoria para filtros de busca
  category:        varchar('category', { length: 100 }).notNull(),
  // Ex: 'Cereais e derivados', 'Carnes e derivados', 'Frutas', 'Leguminosas'
  subcategory:     varchar('subcategory', { length: 100 }),
  // Ex: 'Arroz', 'Bovinos', 'Cítricas', 'Feijões'
  // Fonte primária usada quando não especificado (prioridade: TBCA > USDA > OFF)
  primarySource:   foodSourceEnum('primary_source').notNull(),
  // Descrição rica para geração de embeddings de qualidade
  // Alimentada pelo adapter de sync ou gerada automaticamente
  embeddingText:   text('embedding_text'),
  isActive:        boolean('is_active').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  foodsCategoryIdx:  index('foods_category_idx').on(t.category),
  foodsNamePtIdx:    index('foods_name_pt_idx').on(t.namePt),
  // Busca textual full-text em português
  foodsNamePtFtsIdx: index('foods_name_pt_fts_idx').using(
    'gin',
    sql`to_tsvector('portuguese', ${t.namePt})`
  ),
}));

// ─── food_sources ─────────────────────────────────────────────────────────────
// Valores nutricionais por 100g, por fonte. Um alimento pode ter entrada
// da TBCA, USDA e OFF simultaneamente — o sistema escolhe a mais confiável.
//
// Macros em colunas tipadas (NOT NULL com CHECK constraints):
//   - consultados em toda query de geração de dieta
//   - precisam de validação no banco
//
// Micronutrientes em extra_nutrients (jsonb):
//   - ~40 campos, maioria nullable
//   - schema varia por fonte (TBCA tem mais micronutrientes que OFF)
//   - sem perda de tipagem: $type<> do Drizzle mantém IntelliSense

export const foodSources = pgTable('food_sources', {
  id:           uuid('id').primaryKey().defaultRandom(),
  foodId:       uuid('food_id').notNull()
                  .references(() => foods.id, { onDelete: 'cascade' }),
  source:       foodSourceEnum('source').notNull(),
  externalId:   varchar('external_id', { length: 100 }),  // ID na base de origem
  // Macronutrientes por 100g — colunas tipadas com CHECK
  kcalPer100g:  real('kcal_per_100g').notNull(),
  proteinG:     real('protein_g').notNull(),
  carbsG:       real('carbs_g').notNull(),
  fatG:         real('fat_g').notNull(),
  fiberG:       real('fiber_g'),
  // Micronutrientes em jsonb — schema documentado em TypeScript
  extraNutrients: jsonb('extra_nutrients').$type<{
    // Minerais
    sodiumMg?:      number;
    potassiumMg?:   number;
    calciumMg?:     number;
    magnesiumMg?:   number;
    phosphorusMg?:  number;
    ironMg?:        number;
    zincMg?:        number;
    copperMg?:      number;
    manganeseMg?:   number;
    seleniumMcg?:   number;
    chromiumMcg?:   number;
    iodineMcg?:     number;
    // Vitaminas hidrossolúveis
    vitCMg?:        number;   // ácido ascórbico
    vitB1Mg?:       number;   // tiamina
    vitB2Mg?:       number;   // riboflavina
    vitB3Mg?:       number;   // niacina
    vitB5Mg?:       number;   // ácido pantotênico
    vitB6Mg?:       number;   // piridoxina
    vitB7Mcg?:      number;   // biotina
    vitB9Mcg?:      number;   // folato / ácido fólico
    vitB12Mcg?:     number;   // cobalamina
    // Vitaminas lipossolúveis
    vitAMcgRae?:    number;   // retinol activity equivalents
    vitDMcg?:       number;   // colecalciferol
    vitEMg?:        number;   // tocoferol
    vitKMcg?:       number;   // filoquinona
    // Outros
    cholesterolMg?: number;
    saturatedFatG?: number;
    monounsatFatG?: number;
    polyunsatFatG?: number;
    transFatG?:     number;
    omega3G?:       number;
    omega6G?:       number;
    sugarG?:        number;
    starchG?:       number;
    glycemicIndex?: number;
    glycemicLoad?:  number;
  }>(),
  // Controle de qualidade dos dados
  dataQuality:  varchar('data_quality', { length: 20 }),
  // 'analyzed'   → baseado em análise laboratorial
  // 'calculated' → calculado a partir de receita
  // 'assumed'    → assumido por similaridade
  // 'estimated'  → estimado por banco estrangeiro
  syncLogId:    uuid('sync_log_id').references(() => syncLogs.id, { onDelete: 'set null' }),
  syncedAt:     timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Um alimento tem no máximo 1 entrada por fonte
  foodSourcesFoodSourceUnique: uniqueIndex('food_sources_food_source_unique').on(t.foodId, t.source),
  foodSourcesFoodIdIdx:        index('food_sources_food_id_idx').on(t.foodId),
  foodSourcesSourceIdx:        index('food_sources_source_idx').on(t.source),
  // Índice para filtros de busca por kcal (usado no FoodSearchOptions)
  foodSourcesKcalIdx:          index('food_sources_kcal_idx').on(t.kcalPer100g),
  // Constraints de qualidade dos dados
  foodSourcesKcalPositive:     check('food_sources_kcal_positive',    sql`kcal_per_100g >= 0`),
  foodSourcesProteinPositive:  check('food_sources_protein_positive', sql`protein_g >= 0`),
  foodSourcesCarbsPositive:    check('food_sources_carbs_positive',   sql`carbs_g >= 0`),
  foodSourcesFatPositive:      check('food_sources_fat_positive',     sql`fat_g >= 0`),
  // Macros não podem ultrapassar 100g/100g no total
  foodSourcesMacrosPhysical:   check('food_sources_macros_physical',
    sql`protein_g + carbs_g + fat_g <= 105`
    // 105 em vez de 100 para tolerar arredondamentos de diferentes fontes
  ),
}));

// ─── food_embeddings ──────────────────────────────────────────────────────────
// Vetor de embedding gerado a partir do embeddingText do alimento.
// Tabela separada de foods para:
//   1. Poder ser regenerada sem afetar dados core
//   2. Índice ivfflat só na tabela pequena (sem JOIN pesado)
//   3. Suportar múltiplos modelos de embedding (model_version)

export const foodEmbeddings = pgTable('food_embeddings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  foodId:         uuid('food_id').notNull()
                    .references(() => foods.id, { onDelete: 'cascade' }),
  // Vetor de 1536 dimensões (compatível com text-embedding-3-small da OpenAI
  // e com os modelos de embedding da Anthropic)
  embedding:      vector('embedding', { dimensions: 1536 }).notNull(),
  modelVersion:   varchar('model_version', { length: 100 }).notNull(),
  // Ex: 'claude-3-haiku-20240307', 'text-embedding-3-small'
  generatedAt:    timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  // Texto que foi embeddado — preservado para reprocessamento
  sourceText:     text('source_text').notNull(),
}, (t) => ({
  // 1 embedding por food (pode ter múltiplos modelos — unique por food+model)
  foodEmbeddingsFoodModelUnique: uniqueIndex('food_embeddings_food_model_unique').on(t.foodId, t.modelVersion),
  // Índice ivfflat para busca por cosine similarity
  // lists=100: regra prática para catálogos de até ~100k alimentos
  // (valor ótimo ≈ sqrt(total_rows))
  // IMPORTANTE: este índice precisa ser criado via migration raw SQL (não Drizzle)
  // Ver: migration 0004_add_vector_index.sql
  foodEmbeddingsEmbeddingIdx: index('food_embeddings_embedding_idx').on(t.embedding),
}));

// ─── food_tags ────────────────────────────────────────────────────────────────
// Tags semânticas para filtros de busca além de categoria.
// Ex: 'proteico', 'low-carb', 'integral', 'vegano', 'fermentado', 'rápido preparo'

export const foodTags = pgTable('food_tags', {
  id:        uuid('id').primaryKey().defaultRandom(),
  foodId:    uuid('food_id').notNull()
               .references(() => foods.id, { onDelete: 'cascade' }),
  tag:       varchar('tag', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  foodTagsFoodTagUnique: uniqueIndex('food_tags_food_tag_unique').on(t.foodId, t.tag),
  foodTagsTagIdx:        index('food_tags_tag_idx').on(t.tag),
  foodTagsFoodIdIdx:     index('food_tags_food_id_idx').on(t.foodId),
}));

// ─── sync_logs ────────────────────────────────────────────────────────────────
// Histórico de sincronizações com as bases externas.
// Cada job de sync registra um row aqui com resultado e contadores.

export const syncLogs = pgTable('sync_logs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  source:           foodSourceEnum('source').notNull(),
  status:           syncStatusEnum('status').notNull(),
  recordsProcessed: integer('records_processed').notNull().default(0),
  recordsUpserted:  integer('records_upserted').notNull().default(0),
  recordsSkipped:   integer('records_skipped').notNull().default(0),
  recordsFailed:    integer('records_failed').notNull().default(0),
  errorMessage:     text('error_message'),
  errorDetails:     jsonb('error_details'),
  startedAt:        timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt:       timestamp('finished_at', { withTimezone: true }),
  durationMs:       integer('duration_ms'),
  triggeredBy:      varchar('triggered_by', { length: 50 }),
  // 'cron:weekly', 'manual:nutritionist-id', 'api:admin'
}, (t) => ({
  syncLogsSourceIdx:    index('sync_logs_source_idx').on(t.source),
  syncLogsStatusIdx:    index('sync_logs_status_idx').on(t.status),
  syncLogsStartedAtIdx: index('sync_logs_started_at_idx').on(t.startedAt),
}));
