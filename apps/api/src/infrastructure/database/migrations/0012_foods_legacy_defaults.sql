-- migration: 0012_foods_legacy_defaults.sql
-- Data: 2026-04-06
--
-- O schema atual (Drizzle) separou os nutrientes para a tabela food_sources.
-- Porém o banco em execução ainda tem as colunas legadas NOT NULL na tabela foods:
--   kcal_per100g, protein_g, carbs_g, fat_g
--
-- Sem DEFAULT, qualquer INSERT via Drizzle (que não conhece essas colunas)
-- viola a constraint NOT NULL.
--
-- Solução: adicionar DEFAULT 0 para que INSERTs sem o campo funcionem.
-- Os valores reais continuam em food_sources; a VIEW foods_with_nutrients
-- já usa COALESCE(food_sources.kcal_per_100g, foods.kcal_per100g) para leitura.

ALTER TABLE "foods"
  ALTER COLUMN "kcal_per100g" SET DEFAULT 0,
  ALTER COLUMN "protein_g"    SET DEFAULT 0,
  ALTER COLUMN "carbs_g"      SET DEFAULT 0,
  ALTER COLUMN "fat_g"        SET DEFAULT 0;
