-- migration: 0010_foods_view.sql
-- Data: 2026-04-06
--
-- 1. Instala extensões pg_trgm (busca fuzzy) e unaccent (busca sem acento)
-- 2. Cria a view foods_with_nutrients usada pelo PgFoodRepository
--
-- A view combina:
--   foods           → dados canônicos do alimento
--   food_sources    → valores nutricionais da fonte primária
--   food_embeddings → vetor de embedding para busca semântica (RAG)
--   foods.tags      → array de tags do alimento

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "unaccent";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint

CREATE OR REPLACE VIEW foods_with_nutrients AS
SELECT
  f.id,
  f.name_pt,
  f.name_en,
  f.category,
  f.subcategory,
  f.primary_source,
  f.external_id,
  f.is_active,

  -- Nutrients: food_sources (dado sincronizado) tem precedência sobre colunas legadas de foods
  COALESCE(fs.kcal_per_100g, f.kcal_per100g::real)  AS kcal_per_100g,
  COALESCE(fs.protein_g,     f.protein_g::real)      AS protein_g,
  COALESCE(fs.carbs_g,       f.carbs_g::real)        AS carbs_g,
  COALESCE(fs.fat_g,         f.fat_g::real)          AS fat_g,
  COALESCE(fs.fiber_g,       f.fiber_g::real)        AS fiber_g,
  fs.extra_nutrients,
  fs.data_quality,
  COALESCE(fs.source::text, f.primary_source::text)  AS nutrient_source,

  -- Embedding (pode ser NULL se ainda não foi gerado)
  fe.embedding,
  fe.model_version                                   AS embedding_model,

  -- Tags (array direto da tabela foods)
  COALESCE(f.tags, '{}'::text[])                     AS tags,

  f.created_at,
  f.updated_at
FROM foods f
LEFT JOIN food_sources fs
  ON fs.food_id = f.id
 AND fs.source  = f.primary_source
LEFT JOIN food_embeddings fe
  ON fe.food_id = f.id;
