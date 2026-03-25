-- migration: 0007_foods_complete.sql
-- Gerado a partir de schema/foods.ts (2026-03-25)
--
-- Cria todas as tabelas do catálogo de alimentos:
--   foods → food_sources → food_embeddings
--   foods → food_tags
--   sync_logs (referenciado por food_sources)
--
-- Pré-requisito: 0001_extensions.sql deve estar aplicado
--   (CREATE EXTENSION vector, uuid-ossp, pg_trgm, unaccent)

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "public"."food_source" AS ENUM ('TBCA', 'USDA', 'OFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."sync_status" AS ENUM (
    'running',
    'success',
    'partial',   -- concluído com erros em alguns registros
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── sync_logs ────────────────────────────────────────────────────────────────
-- Criada antes de food_sources pois food_sources tem FK para sync_logs.
-- Histórico de sincronizações com bases externas (TBCA, USDA, OFF).

CREATE TABLE IF NOT EXISTS "sync_logs" (
  "id"                uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source"            "food_source" NOT NULL,
  "status"            "sync_status" NOT NULL,
  "records_processed" integer      NOT NULL DEFAULT 0,
  "records_upserted"  integer      NOT NULL DEFAULT 0,
  "records_skipped"   integer      NOT NULL DEFAULT 0,
  "records_failed"    integer      NOT NULL DEFAULT 0,
  "error_message"     text,
  -- Detalhes estruturados do erro (stack, ids afetados, etc.)
  "error_details"     jsonb,
  "started_at"        timestamptz  NOT NULL DEFAULT now(),
  "finished_at"       timestamptz,
  "duration_ms"       integer,
  -- Ex: 'cron:weekly', 'manual:nutritionist-id', 'api:admin'
  "triggered_by"      varchar(50)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_logs_source_idx"     ON "sync_logs" ("source");
CREATE INDEX IF NOT EXISTS "sync_logs_status_idx"     ON "sync_logs" ("status");
CREATE INDEX IF NOT EXISTS "sync_logs_started_at_idx" ON "sync_logs" ("started_at");
--> statement-breakpoint

-- ─── foods ────────────────────────────────────────────────────────────────────
-- Entidade canônica do alimento — identidade sem valores nutricionais.
-- Valores nutricionais ficam em food_sources (separado por fonte).

CREATE TABLE IF NOT EXISTS "foods" (
  "id"             uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name_pt"        varchar(255) NOT NULL,                -- nome em português
  "name_en"        varchar(255),
  -- Hierarquia de categoria para filtros de busca
  -- Ex: 'Cereais e derivados', 'Carnes e derivados', 'Frutas', 'Leguminosas'
  "category"       varchar(100) NOT NULL,
  -- Ex: 'Arroz', 'Bovinos', 'Cítricas', 'Feijões'
  "subcategory"    varchar(100),
  -- Fonte primária usada quando não especificado (prioridade: TBCA > USDA > OFF)
  "primary_source" "food_source" NOT NULL,
  -- Texto rico para geração de embeddings de qualidade
  -- Alimentado pelo adapter de sync ou gerado automaticamente
  "embedding_text" text,
  "is_active"      boolean      NOT NULL DEFAULT true,
  "created_at"     timestamptz  NOT NULL DEFAULT now(),
  "updated_at"     timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "foods_category_idx"  ON "foods" ("category");
CREATE INDEX IF NOT EXISTS "foods_name_pt_idx"   ON "foods" ("name_pt");
-- Índice GIN para busca textual full-text em português
CREATE INDEX IF NOT EXISTS "foods_name_pt_fts_idx"
  ON "foods" USING gin (to_tsvector('portuguese', "name_pt"));
--> statement-breakpoint

-- ─── food_sources ─────────────────────────────────────────────────────────────
-- Valores nutricionais por 100g, separados por fonte.
-- Um alimento pode ter entrada da TBCA, USDA e OFF simultaneamente.
--
-- Macros em colunas tipadas (NOT NULL com CHECK): consultados em toda query de
-- geração de dieta, precisam de validação no banco.
--
-- Micronutrientes em extra_nutrients (jsonb): ~40 campos, maioria nullable,
-- schema varia por fonte (TBCA tem mais que OFF).
-- Campos documentados: sodiumMg, potassiumMg, calciumMg, magnesiumMg,
--   phosphorusMg, ironMg, zincMg, copperMg, manganeseMg, seleniumMcg,
--   chromiumMcg, iodineMcg, vitCMg, vitB1Mg, vitB2Mg, vitB3Mg, vitB5Mg,
--   vitB6Mg, vitB7Mcg, vitB9Mcg, vitB12Mcg, vitAMcgRae, vitDMcg, vitEMg,
--   vitKMcg, cholesterolMg, saturatedFatG, monounsatFatG, polyunsatFatG,
--   transFatG, omega3G, omega6G, sugarG, starchG, glycemicIndex, glycemicLoad

CREATE TABLE IF NOT EXISTS "food_sources" (
  "id"              uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"         uuid          NOT NULL,
  "source"          "food_source" NOT NULL,
  "external_id"     varchar(100),            -- ID na base de origem
  -- Macronutrientes por 100g
  "kcal_per_100g"   real          NOT NULL,
  "protein_g"       real          NOT NULL,
  "carbs_g"         real          NOT NULL,
  "fat_g"           real          NOT NULL,
  "fiber_g"         real,
  -- Micronutrientes em jsonb (ver documentação de campos acima)
  "extra_nutrients" jsonb,
  -- Qualidade do dado: 'analyzed' | 'calculated' | 'assumed' | 'estimated'
  "data_quality"    varchar(20),
  "sync_log_id"     uuid,
  "synced_at"       timestamptz   NOT NULL DEFAULT now(),
  "created_at"      timestamptz   NOT NULL DEFAULT now(),
  "updated_at"      timestamptz   NOT NULL DEFAULT now(),

  -- Um alimento tem no máximo 1 entrada por fonte
  CONSTRAINT "food_sources_food_source_unique"
    UNIQUE ("food_id", "source"),
  -- Constraints de qualidade dos dados
  CONSTRAINT "food_sources_kcal_positive"
    CHECK (kcal_per_100g >= 0),
  CONSTRAINT "food_sources_protein_positive"
    CHECK (protein_g >= 0),
  CONSTRAINT "food_sources_carbs_positive"
    CHECK (carbs_g >= 0),
  CONSTRAINT "food_sources_fat_positive"
    CHECK (fat_g >= 0),
  -- 105 em vez de 100 para tolerar arredondamentos entre diferentes fontes
  CONSTRAINT "food_sources_macros_physical"
    CHECK (protein_g + carbs_g + fat_g <= 105),
  CONSTRAINT "food_sources_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE CASCADE,
  CONSTRAINT "food_sources_sync_log_id_fk"
    FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "food_sources_food_id_idx" ON "food_sources" ("food_id");
CREATE INDEX IF NOT EXISTS "food_sources_source_idx"  ON "food_sources" ("source");
-- Índice para filtros de busca por faixa de kcal (FoodSearchOptions)
CREATE INDEX IF NOT EXISTS "food_sources_kcal_idx"    ON "food_sources" ("kcal_per_100g");
--> statement-breakpoint

-- ─── food_embeddings ──────────────────────────────────────────────────────────
-- Vetor de embedding float[1536] gerado a partir de embedding_text.
-- Tabela separada de foods para:
--   1. Poder ser regenerada sem afetar dados core
--   2. Índice ivfflat apenas na tabela pequena (sem JOIN pesado)
--   3. Suportar múltiplos modelos de embedding (model_version)

CREATE TABLE IF NOT EXISTS "food_embeddings" (
  "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"       uuid         NOT NULL,
  -- Vetor 1536 dimensões (compatível com text-embedding-3-small e modelos Anthropic)
  "embedding"     vector(1536) NOT NULL,
  -- Ex: 'claude-3-haiku-20240307', 'text-embedding-3-small'
  "model_version" varchar(100) NOT NULL,
  "generated_at"  timestamptz  NOT NULL DEFAULT now(),
  -- Texto embeddado preservado para reprocessamento
  "source_text"   text         NOT NULL,

  -- 1 embedding por alimento por modelo
  CONSTRAINT "food_embeddings_food_model_unique"
    UNIQUE ("food_id", "model_version"),
  CONSTRAINT "food_embeddings_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- Índice B-tree placeholder — o índice ivfflat real está na migration separada
-- (0005_vector_index.sql ou equivalente) e deve ser criado APÓS o seed inicial.
-- Criar o índice ivfflat com tabela vazia reduz a qualidade dos centróides.
CREATE INDEX IF NOT EXISTS "food_embeddings_food_id_idx" ON "food_embeddings" ("food_id");
--> statement-breakpoint

-- ─── food_tags ────────────────────────────────────────────────────────────────
-- Tags semânticas para filtros de busca além de categoria.
-- Ex: 'proteico', 'low-carb', 'integral', 'vegano', 'fermentado', 'rápido preparo'

CREATE TABLE IF NOT EXISTS "food_tags" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"    uuid        NOT NULL,
  "tag"        varchar(50) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "food_tags_food_tag_unique"
    UNIQUE ("food_id", "tag"),
  CONSTRAINT "food_tags_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "food_tags_tag_idx"     ON "food_tags" ("tag");
CREATE INDEX IF NOT EXISTS "food_tags_food_id_idx" ON "food_tags" ("food_id");
