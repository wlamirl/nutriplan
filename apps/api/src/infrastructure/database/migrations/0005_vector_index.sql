-- migration: 0005_vector_index.sql
--
-- O índice ivfflat NÃO pode ser criado pelo Drizzle ainda (sem suporte nativo).
-- Deve ser executado APÓS a tabela food_embeddings existir e ter dados.
--
-- Estratégia ivfflat:
--   - lists=100: ≈ sqrt(10.000 alimentos) — bom ponto de partida
--   - Para catálogos maiores (>100k rows): recalcular como sqrt(total_rows)
--   - vector_cosine_ops: distância de cosseno (ideal para embeddings de texto)
--
-- Recall vs Speed:
--   - Após criar o índice, ajustar SET ivfflat.probes = N na sessão:
--     - probes=1  → mais rápido, recall ~70%
--     - probes=10 → equilibrado, recall ~90%  ← recomendado para produção
--     - probes=lists → scan completo (sem benefício do índice)
--
-- ATENÇÃO: criar o índice com a tabela vazia reduz a qualidade dos centróides.
-- Execute este script APÓS o seed inicial de alimentos.

CREATE INDEX CONCURRENTLY IF NOT EXISTS food_embeddings_ivfflat_cosine_idx
  ON food_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Comentário no índice para documentação
COMMENT ON INDEX food_embeddings_ivfflat_cosine_idx IS
  'ivfflat index para busca de alimentos por similaridade de cosseno. '
  'lists=100 calibrado para ~10k alimentos. '
  'Ajustar ivfflat.probes=10 por sessão para balance recall/speed.';

-- View de conveniência para busca semântica com JOIN
-- Usada pelo PgFoodRepository.searchBySimilarity()
CREATE OR REPLACE VIEW foods_with_nutrients AS
SELECT
  f.id,
  f.name_pt,
  f.name_en,
  f.category,
  f.subcategory,
  f.primary_source,
  f.is_active,
  -- Macros da fonte primária
  fs.kcal_per_100g,
  fs.protein_g,
  fs.carbs_g,
  fs.fat_g,
  fs.fiber_g,
  fs.extra_nutrients,
  fs.data_quality,
  fs.source AS nutrient_source,
  -- Embedding
  fe.embedding,
  fe.model_version AS embedding_model,
  -- Tags como array
  ARRAY(
    SELECT ft.tag FROM food_tags ft WHERE ft.food_id = f.id
  ) AS tags
FROM foods f
-- JOIN com a fonte primária (prioridade: TBCA > USDA > OFF)
LEFT JOIN LATERAL (
  SELECT fs2.*
  FROM food_sources fs2
  WHERE fs2.food_id = f.id
  ORDER BY
    CASE fs2.source
      WHEN 'TBCA' THEN 1
      WHEN 'USDA' THEN 2
      WHEN 'OFF'  THEN 3
    END
  LIMIT 1
) fs ON true
LEFT JOIN food_embeddings fe
  ON fe.food_id = f.id
  AND fe.model_version = current_setting('app.embedding_model', true)
WHERE f.is_active = true;

COMMENT ON VIEW foods_with_nutrients IS
  'View desnormalizada para queries de geração de dietas. '
  'Resolve automaticamente a fonte primária (TBCA > USDA > OFF). '
  'Requer SET app.embedding_model = ''nome-do-modelo'' na sessão.';
