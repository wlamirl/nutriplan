-- migration: 0009_update_foods_schema.sql
-- Data: 2026-04-01
--
-- Garante que as tabelas do catálogo de alimentos existem e têm o schema completo.
-- Referência de destino: 0004_foods_embeddings.sql / schema/foods.ts
--
-- Estratégia:
--   - CREATE TABLE IF NOT EXISTS: cria tabelas que não existem
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS: adiciona colunas ausentes em tabelas já existentes
--   - Trata o caso de o 0004 original ter criado um schema simplificado
--
-- Tabelas: sync_logs, foods, food_sources, food_embeddings, food_tags
--
-- Pré-requisito: 0001_extensions.sql (vector, uuid-ossp, pg_trgm, unaccent)

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
    'partial',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── sync_logs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sync_logs" (
  "id"                uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source"            "food_source" NOT NULL,
  "status"            "sync_status" NOT NULL,
  "records_processed" integer       NOT NULL DEFAULT 0,
  "records_upserted"  integer       NOT NULL DEFAULT 0,
  "records_skipped"   integer       NOT NULL DEFAULT 0,
  "records_failed"    integer       NOT NULL DEFAULT 0,
  "error_message"     text,
  "error_details"     jsonb,
  "started_at"        timestamptz   NOT NULL DEFAULT now(),
  "finished_at"       timestamptz,
  "duration_ms"       integer,
  "triggered_by"      varchar(50)
);
--> statement-breakpoint

-- Colunas que podem estar ausentes se sync_logs existia com schema simplificado
ALTER TABLE "sync_logs"
  ADD COLUMN IF NOT EXISTS "records_upserted"  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "records_skipped"   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "records_failed"    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "error_details"     jsonb,
  ADD COLUMN IF NOT EXISTS "duration_ms"       integer,
  ADD COLUMN IF NOT EXISTS "triggered_by"      varchar(50),
  ADD COLUMN IF NOT EXISTS "finished_at"       timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_logs_source_idx"     ON "sync_logs" ("source");
CREATE INDEX IF NOT EXISTS "sync_logs_status_idx"     ON "sync_logs" ("status");
CREATE INDEX IF NOT EXISTS "sync_logs_started_at_idx" ON "sync_logs" ("started_at");
--> statement-breakpoint

-- ─── foods ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "foods" (
  "id"             uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name_pt"        varchar(255)  NOT NULL,
  "name_en"        varchar(255),
  "category"       varchar(100)  NOT NULL,
  "subcategory"    varchar(100),
  "primary_source" "food_source" NOT NULL,
  "embedding_text" text,
  "is_active"      boolean       NOT NULL DEFAULT true,
  "created_at"     timestamptz   NOT NULL DEFAULT now(),
  "updated_at"     timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Colunas que podem estar ausentes se foods existia com schema simplificado
-- (ex: coluna "name" renomeada para "name_pt")
DO $$ BEGIN
  -- Se a coluna "name" existe mas "name_pt" não, renomear
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'foods' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'foods' AND column_name = 'name_pt'
  ) THEN
    ALTER TABLE "foods" RENAME COLUMN "name" TO "name_pt";
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "name_en"        varchar(255),
  ADD COLUMN IF NOT EXISTS "subcategory"    varchar(100),
  ADD COLUMN IF NOT EXISTS "primary_source" "food_source",
  ADD COLUMN IF NOT EXISTS "embedding_text" text,
  ADD COLUMN IF NOT EXISTS "is_active"      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updated_at"     timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

-- Ajusta tipo de colunas que podem estar como text simples
ALTER TABLE "foods"
  ALTER COLUMN "name_pt"  TYPE varchar(255),
  ALTER COLUMN "category" TYPE varchar(100);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "foods_category_idx" ON "foods" ("category");
CREATE INDEX IF NOT EXISTS "foods_name_pt_idx"  ON "foods" ("name_pt");
--> statement-breakpoint

-- Índice GIN para busca full-text em português
CREATE INDEX IF NOT EXISTS "foods_name_pt_fts_idx"
  ON "foods" USING gin (to_tsvector('portuguese', "name_pt"));
--> statement-breakpoint

-- ─── food_sources ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "food_sources" (
  "id"              uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"         uuid          NOT NULL,
  "source"          "food_source" NOT NULL,
  "external_id"     varchar(100),
  "kcal_per_100g"   real          NOT NULL,
  "protein_g"       real          NOT NULL,
  "carbs_g"         real          NOT NULL,
  "fat_g"           real          NOT NULL,
  "fiber_g"         real,
  "extra_nutrients" jsonb,
  "data_quality"    varchar(20),
  "sync_log_id"     uuid,
  "synced_at"       timestamptz   NOT NULL DEFAULT now(),
  "created_at"      timestamptz   NOT NULL DEFAULT now(),
  "updated_at"      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT "food_sources_food_source_unique" UNIQUE ("food_id", "source"),
  CONSTRAINT "food_sources_kcal_positive"      CHECK (kcal_per_100g >= 0),
  CONSTRAINT "food_sources_protein_positive"   CHECK (protein_g >= 0),
  CONSTRAINT "food_sources_carbs_positive"     CHECK (carbs_g >= 0),
  CONSTRAINT "food_sources_fat_positive"       CHECK (fat_g >= 0),
  CONSTRAINT "food_sources_macros_physical"    CHECK (protein_g + carbs_g + fat_g <= 105),
  CONSTRAINT "food_sources_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE CASCADE,
  CONSTRAINT "food_sources_sync_log_id_fk"
    FOREIGN KEY ("sync_log_id") REFERENCES "sync_logs" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

-- Colunas que podem estar ausentes se food_sources existia com schema simplificado
ALTER TABLE "food_sources"
  ADD COLUMN IF NOT EXISTS "external_id"     varchar(100),
  ADD COLUMN IF NOT EXISTS "fiber_g"         real,
  ADD COLUMN IF NOT EXISTS "extra_nutrients" jsonb,
  ADD COLUMN IF NOT EXISTS "data_quality"    varchar(20),
  ADD COLUMN IF NOT EXISTS "sync_log_id"     uuid REFERENCES "sync_logs"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "synced_at"       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at"      timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "food_sources_food_id_idx" ON "food_sources" ("food_id");
CREATE INDEX IF NOT EXISTS "food_sources_source_idx"  ON "food_sources" ("source");
CREATE INDEX IF NOT EXISTS "food_sources_kcal_idx"    ON "food_sources" ("kcal_per_100g");
--> statement-breakpoint

-- ─── food_embeddings ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "food_embeddings" (
  "id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"       uuid         NOT NULL,
  "embedding"     vector(1536) NOT NULL,
  "model_version" varchar(100) NOT NULL,
  "generated_at"  timestamptz  NOT NULL DEFAULT now(),
  "source_text"   text         NOT NULL,

  CONSTRAINT "food_embeddings_food_model_unique"
    UNIQUE ("food_id", "model_version"),
  CONSTRAINT "food_embeddings_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- Colunas que podem estar ausentes numa versão antiga de food_embeddings
ALTER TABLE "food_embeddings"
  ADD COLUMN IF NOT EXISTS "model_version" varchar(100),
  ADD COLUMN IF NOT EXISTS "source_text"   text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "food_embeddings_food_id_idx" ON "food_embeddings" ("food_id");
--> statement-breakpoint

-- ─── food_tags ────────────────────────────────────────────────────────────────

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
--> statement-breakpoint

-- ─── FK de diet_meal_items → foods (complemento do 0008) ─────────────────────
-- Garante que a FK existe agora que foods certamente existe.
DO $$ BEGIN
  ALTER TABLE "diet_meal_items"
    ADD CONSTRAINT "diet_meal_items_food_id_fk"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
