import {
  pgTable, uuid, text, timestamp, integer, numeric, pgEnum, customType,
} from 'drizzle-orm/pg-core';

// ─── pgvector custom type ─────────────────────────────────────────────────────
// Dimensão 1536 é compatível com embeddings do Claude (text-embedding-3-small)

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector retorna no formato: [1.0,2.0,3.0]
    return value.slice(1, -1).split(',').map(Number);
  },
});

// ─── Enums ────────────────────────────────────────────────────────────────────

export const foodSourceEnum = pgEnum('food_source', ['TBCA', 'USDA', 'OFF']);
export const syncStatusEnum  = pgEnum('sync_status',  ['pending', 'running', 'completed', 'failed']);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const foods = pgTable('foods', {
  id:           uuid('id').primaryKey().defaultRandom(),
  namePt:       text('name_pt').notNull(),
  nameEn:       text('name_en'),
  category:     text('category').notNull(),
  subcategory:  text('subcategory'),
  tags:         text('tags').array().notNull().default([]),
  // nutrientes por 100g
  kcalPer100g: numeric('kcal_per100g', { precision: 7, scale: 2 }).notNull(),
  proteinG:    numeric('protein_g',    { precision: 6, scale: 2 }).notNull(),
  carbsG:      numeric('carbs_g',      { precision: 6, scale: 2 }).notNull(),
  fatG:        numeric('fat_g',        { precision: 6, scale: 2 }).notNull(),
  fiberG:      numeric('fiber_g',      { precision: 5, scale: 2 }),
  sodiumMg:    numeric('sodium_mg',    { precision: 7, scale: 2 }),
  calciumMg:   numeric('calcium_mg',   { precision: 7, scale: 2 }),
  ironMg:      numeric('iron_mg',      { precision: 6, scale: 3 }),
  zincMg:      numeric('zinc_mg',      { precision: 6, scale: 3 }),
  vitCMg:      numeric('vit_c_mg',     { precision: 6, scale: 2 }),
  vitB12Mcg:   numeric('vit_b12_mcg',  { precision: 6, scale: 3 }),
  primarySource: foodSourceEnum('primary_source').notNull(),
  externalId:    text('external_id'),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
  updatedAt:     timestamp('updated_at').defaultNow().notNull(),
});

export const foodEmbeddings = pgTable('food_embeddings', {
  id:        uuid('id').primaryKey().defaultRandom(),
  foodId:    uuid('food_id').notNull().unique().references(() => foods.id, { onDelete: 'cascade' }),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
// O índice ivfflat está na migration 0004 (requer sintaxe de operator class do pgvector,
// não suportada nativamente pelo Drizzle schema builder)

export const syncLogs = pgTable('sync_logs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  source:         foodSourceEnum('source').notNull(),
  status:         syncStatusEnum('status').notNull().default('pending'),
  totalProcessed: integer('total_processed').default(0),
  totalInserted:  integer('total_inserted').default(0),
  totalUpdated:   integer('total_updated').default(0),
  totalFailed:    integer('total_failed').default(0),
  errorMessage:   text('error_message'),
  startedAt:      timestamp('started_at').defaultNow().notNull(),
  finishedAt:     timestamp('finished_at'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
});
