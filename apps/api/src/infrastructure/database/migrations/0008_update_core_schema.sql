-- migration: 0008_update_core_schema.sql
-- Data: 2026-04-01
--
-- Atualiza as tabelas do domínio clínico para o schema completo.
-- Referência de destino: 0006_core_tables_complete.sql / schema/core.ts
--
-- Estratégia:
--   - ADD COLUMN IF NOT EXISTS: seguro e idempotente
--   - ALTER COLUMN TYPE: usa USING para conversão explícita
--   - CHECK / FK / UNIQUE: envolvidos em DO $$ BEGIN ... EXCEPTION ... END $$
--   - Nenhuma coluna é removida (regra de migrations de produção)
--
-- Tabelas afetadas:
--   users, nutritionists, patients, patient_restrictions,
--   consultations, diet_plans, diet_meals, diet_meal_items

-- ─── Enums: adicionar valores e criar novos ───────────────────────────────────

-- user_role: adiciona 'patient' que não existia em 0001
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'patient';
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."diet_plan_status" AS ENUM (
    'draft',
    'active',
    'paused',
    'completed',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."objective_type" AS ENUM (
    'weight_loss',
    'muscle_gain',
    'maintenance',
    'glycemic_control',
    'cardiovascular',
    'renal',
    'sports_performance',
    'general'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── users ────────────────────────────────────────────────────────────────────
-- Schema antigo (0001): id, email (text), password_hash (text), role, created_at, updated_at
-- Schema novo: + name, avatar_url, is_active, last_login_at, deleted_at
--              email/password_hash: text → varchar(255)

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "name"          varchar(255),
  ADD COLUMN IF NOT EXISTS "avatar_url"    varchar(500),
  ADD COLUMN IF NOT EXISTS "is_active"     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deleted_at"    timestamptz;
--> statement-breakpoint

ALTER TABLE "users"
  ALTER COLUMN "email"         TYPE varchar(255),
  ALTER COLUMN "password_hash" TYPE varchar(255);
--> statement-breakpoint

-- Remove o DEFAULT 'nutritionist' do role (schema novo não tem default)
ALTER TABLE "users"
  ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_role_idx"       ON "users" ("role");
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");
--> statement-breakpoint

-- ─── nutritionists ────────────────────────────────────────────────────────────
-- Schema antigo (0001): id, user_id, name (text), crn (text), phone, created_at
-- Schema novo: + specialty, bio, phone_number, updated_at
--              crn: text → varchar(20)

ALTER TABLE "nutritionists"
  ADD COLUMN IF NOT EXISTS "specialty"    varchar(100),
  ADD COLUMN IF NOT EXISTS "bio"          text,
  ADD COLUMN IF NOT EXISTS "phone_number" varchar(20),
  ADD COLUMN IF NOT EXISTS "updated_at"   timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

ALTER TABLE "nutritionists"
  ALTER COLUMN "crn" TYPE varchar(20);
--> statement-breakpoint

-- Garante unicidade em user_id (já tínhamos FK, mas não UNIQUE constraint)
DO $$ BEGIN
  ALTER TABLE "nutritionists"
    ADD CONSTRAINT "nutritionists_user_id_unique" UNIQUE ("user_id");
EXCEPTION WHEN duplicate_table THEN NULL;
       WHEN duplicate_object  THEN NULL;
END $$;
--> statement-breakpoint

-- ─── patients ─────────────────────────────────────────────────────────────────
-- Schema antigo (0002): id, nutritionist_id (CASCADE), name (text), birth_date,
--                       sex, height_cm (numeric(5,1)), activity_level, cultural_preferences,
--                       routine_notes, disliked_foods, created_at
-- Schema novo: + user_id, is_active, updated_at, deleted_at
--              height_cm: numeric → real
--              nutritionist_id FK: ON DELETE CASCADE → RESTRICT

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "user_id"    uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "is_active"  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint

-- Converter height_cm de numeric(5,1) para real
ALTER TABLE "patients"
  ALTER COLUMN "height_cm" TYPE real USING "height_cm"::real;
--> statement-breakpoint

-- Adicionar DEFAULT 'moderate' ao activity_level
ALTER TABLE "patients"
  ALTER COLUMN "activity_level" SET DEFAULT 'moderate';
--> statement-breakpoint

-- Converter name de text para varchar(255)
ALTER TABLE "patients"
  ALTER COLUMN "name" TYPE varchar(255);
--> statement-breakpoint

-- Trocar ON DELETE CASCADE por RESTRICT na FK nutritionist_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'patients_nutritionist_id_fk'
       AND table_name = 'patients'
  ) THEN
    ALTER TABLE "patients" DROP CONSTRAINT "patients_nutritionist_id_fk";
    ALTER TABLE "patients"
      ADD CONSTRAINT "patients_nutritionist_id_fk"
      FOREIGN KEY ("nutritionist_id") REFERENCES "nutritionists"("id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "patients_nutritionist_id_idx" ON "patients" ("nutritionist_id");
CREATE INDEX IF NOT EXISTS "patients_user_id_idx"         ON "patients" ("user_id");
CREATE INDEX IF NOT EXISTS "patients_deleted_at_idx"      ON "patients" ("deleted_at");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "patients"
    ADD CONSTRAINT "patients_height_positive" CHECK (height_cm > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── patient_restrictions ─────────────────────────────────────────────────────
-- Schema antigo (0002): id, patient_id, type, description (text), created_at
-- Schema novo: + severity, notes, is_active
--              description: text → varchar(255)

ALTER TABLE "patient_restrictions"
  ADD COLUMN IF NOT EXISTS "severity"  varchar(20),
  ADD COLUMN IF NOT EXISTS "notes"     text,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE "patient_restrictions"
  ALTER COLUMN "description" TYPE varchar(255);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "patient_restrictions_type_idx" ON "patient_restrictions" ("type");
--> statement-breakpoint

-- ─── consultations ────────────────────────────────────────────────────────────
-- Schema antigo (0002): id, patient_id, date (timestamp), weight_kg (numeric(5,2)),
--                       body_fat_pct (numeric(4,1)), muscle_mass_kg (numeric(5,2)),
--                       notes, created_at
-- Schema novo: + nutritionist_id (nullable), visceral_fat_level, water_pct, bone_mass_kg,
--              waist_cm, hip_cm, arm_cm, calf_cm, lab_results, next_consultation, updated_at
--              date: timestamp → date
--              weight_kg, body_fat_pct, muscle_mass_kg: numeric → real

ALTER TABLE "consultations"
  -- nutritionist_id nullable: linhas existentes não têm valor
  ADD COLUMN IF NOT EXISTS "nutritionist_id"    uuid REFERENCES "nutritionists"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "visceral_fat_level" smallint,
  ADD COLUMN IF NOT EXISTS "water_pct"          real,
  ADD COLUMN IF NOT EXISTS "bone_mass_kg"       real,
  ADD COLUMN IF NOT EXISTS "waist_cm"           real,
  ADD COLUMN IF NOT EXISTS "hip_cm"             real,
  ADD COLUMN IF NOT EXISTS "arm_cm"             real,
  ADD COLUMN IF NOT EXISTS "calf_cm"            real,
  ADD COLUMN IF NOT EXISTS "lab_results"        jsonb,
  ADD COLUMN IF NOT EXISTS "next_consultation"  date,
  ADD COLUMN IF NOT EXISTS "updated_at"         timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

-- date era timestamp, converter para date (extrai apenas a data)
ALTER TABLE "consultations"
  ALTER COLUMN "date" TYPE date USING "date"::date;
--> statement-breakpoint

-- Converter campos antropométricos de numeric para real
ALTER TABLE "consultations"
  ALTER COLUMN "weight_kg"      TYPE real USING "weight_kg"::real,
  ALTER COLUMN "body_fat_pct"   TYPE real USING "body_fat_pct"::real,
  ALTER COLUMN "muscle_mass_kg" TYPE real USING "muscle_mass_kg"::real;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "consultations_patient_id_idx"   ON "consultations" ("patient_id");
CREATE INDEX IF NOT EXISTS "consultations_date_idx"         ON "consultations" ("date");
CREATE INDEX IF NOT EXISTS "consultations_patient_date_idx" ON "consultations" ("patient_id", "date");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "consultations"
    ADD CONSTRAINT "consultations_weight_positive"
      CHECK (weight_kg > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "consultations"
    ADD CONSTRAINT "consultations_body_fat_range"
      CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 70));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── diet_plans ───────────────────────────────────────────────────────────────
-- Schema antigo (0003): id, patient_id, consultation_id, start_date (timestamp),
--   end_date (timestamp), objectives, target_kcal, target_protein_g, target_carbs_g,
--   target_fat_g, target_protein_pct, target_carbs_pct, target_fat_pct,
--   total_daily_kcal (integer), total_daily_protein_g (numeric), total_daily_carbs_g (numeric),
--   total_daily_fat_g (numeric), ai_model, ai_prompt_tokens, ai_completion_tokens,
--   ai_food_sources, ai_generated_at, created_at
-- Schema novo: + status, objective_type, daily_kcal_target, protein_g_target,
--   carbs_g_target, fat_g_target, protein_pct, carbs_pct, fat_pct,
--   total_protein_g, total_carbs_g, total_fat_g, ai_generation_meta,
--   nutritionist_notes, is_ai_generated, updated_at
--   start_date, end_date: timestamp → date
--   total_daily_kcal: integer → real
-- Colunas antigas (target_kcal, ai_model, etc.) são mantidas (regra de produção)

ALTER TABLE "diet_plans"
  ADD COLUMN IF NOT EXISTS "status"             "diet_plan_status" NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "objective_type"     "objective_type",
  ADD COLUMN IF NOT EXISTS "daily_kcal_target"  integer,
  ADD COLUMN IF NOT EXISTS "protein_g_target"   real,
  ADD COLUMN IF NOT EXISTS "carbs_g_target"     real,
  ADD COLUMN IF NOT EXISTS "fat_g_target"       real,
  ADD COLUMN IF NOT EXISTS "protein_pct"        real,
  ADD COLUMN IF NOT EXISTS "carbs_pct"          real,
  ADD COLUMN IF NOT EXISTS "fat_pct"            real,
  ADD COLUMN IF NOT EXISTS "total_protein_g"    real,
  ADD COLUMN IF NOT EXISTS "total_carbs_g"      real,
  ADD COLUMN IF NOT EXISTS "total_fat_g"        real,
  ADD COLUMN IF NOT EXISTS "ai_generation_meta" jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "nutritionist_notes" text,
  ADD COLUMN IF NOT EXISTS "is_ai_generated"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updated_at"         timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint

-- start_date, end_date: timestamp → date
ALTER TABLE "diet_plans"
  ALTER COLUMN "start_date" TYPE date USING "start_date"::date,
  ALTER COLUMN "end_date"   TYPE date USING "end_date"::date;
--> statement-breakpoint

-- total_daily_kcal: integer → real
ALTER TABLE "diet_plans"
  ALTER COLUMN "total_daily_kcal" TYPE real USING "total_daily_kcal"::real;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_plans_patient_id_idx"           ON "diet_plans" ("patient_id");
CREATE INDEX IF NOT EXISTS "diet_plans_status_idx"               ON "diet_plans" ("status");
CREATE INDEX IF NOT EXISTS "diet_plans_consultation_id_idx"      ON "diet_plans" ("consultation_id");
CREATE INDEX IF NOT EXISTS "diet_plans_patient_status_start_idx" ON "diet_plans" ("patient_id", "status", "start_date");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "diet_plans"
    ADD CONSTRAINT "diet_plans_dates_order" CHECK (end_date > start_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "diet_plans"
    ADD CONSTRAINT "diet_plans_kcal_positive" CHECK (daily_kcal_target > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "diet_plans"
    ADD CONSTRAINT "diet_plans_macro_pct_sum"
      CHECK (ABS(protein_pct + carbs_pct + fat_pct - 100) <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── diet_meals ───────────────────────────────────────────────────────────────
-- Schema antigo (0003): id, diet_plan_id, meal_type, scheduled_time (text),
--   total_kcal (integer), total_protein_g (numeric), total_carbs_g (numeric),
--   total_fat_g (numeric), nutritionist_note, created_at
-- Schema novo: + order_index
--   scheduled_time: text → time
--   total_kcal, total_protein_g, total_carbs_g, total_fat_g: numeric/integer → real

ALTER TABLE "diet_meals"
  ADD COLUMN IF NOT EXISTS "order_index" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

-- scheduled_time: text → time. Se coluna existir como text, converter.
-- USING: valores válidos como '07:30' convertem corretamente; NULL fica NULL.
ALTER TABLE "diet_meals"
  ALTER COLUMN "scheduled_time" TYPE time USING "scheduled_time"::time;
--> statement-breakpoint

ALTER TABLE "diet_meals"
  ALTER COLUMN "total_kcal"      TYPE real USING "total_kcal"::real,
  ALTER COLUMN "total_protein_g" TYPE real USING "total_protein_g"::real,
  ALTER COLUMN "total_carbs_g"   TYPE real USING "total_carbs_g"::real,
  ALTER COLUMN "total_fat_g"     TYPE real USING "total_fat_g"::real;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_meals_diet_plan_id_idx" ON "diet_meals" ("diet_plan_id");
CREATE INDEX IF NOT EXISTS "diet_meals_order_idx"        ON "diet_meals" ("diet_plan_id", "order_index");
--> statement-breakpoint

-- ─── diet_meal_items ──────────────────────────────────────────────────────────
-- Schema antigo (0003): id, diet_meal_id, food_id (sem FK), quantity_g (numeric),
--   kcal (integer), protein_g (numeric), carbs_g (numeric), fat_g (numeric), created_at
-- Schema novo: + fiber_g, sodium_mg, source_used
--   todos os numeric/integer → real
--   Adiciona FK food_id → foods(id) ON DELETE RESTRICT

ALTER TABLE "diet_meal_items"
  ADD COLUMN IF NOT EXISTS "fiber_g"     real,
  ADD COLUMN IF NOT EXISTS "sodium_mg"   real,
  ADD COLUMN IF NOT EXISTS "source_used" varchar(10);
--> statement-breakpoint

ALTER TABLE "diet_meal_items"
  ALTER COLUMN "quantity_g" TYPE real USING "quantity_g"::real,
  ALTER COLUMN "kcal"       TYPE real USING "kcal"::real,
  ALTER COLUMN "protein_g"  TYPE real USING "protein_g"::real,
  ALTER COLUMN "carbs_g"    TYPE real USING "carbs_g"::real,
  ALTER COLUMN "fat_g"      TYPE real USING "fat_g"::real;
--> statement-breakpoint

-- FK para foods (migration 0003 criou food_id sem FK)
-- Só adiciona se foods já existir (criada em 0004 ou 0009)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'foods') THEN
    ALTER TABLE "diet_meal_items"
      ADD CONSTRAINT "diet_meal_items_food_id_fk"
      FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_meal_items_meal_id_idx" ON "diet_meal_items" ("diet_meal_id");
CREATE INDEX IF NOT EXISTS "diet_meal_items_food_id_idx" ON "diet_meal_items" ("food_id");
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "diet_meal_items"
    ADD CONSTRAINT "diet_meal_items_quantity_positive" CHECK (quantity_g > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "diet_meal_items"
    ADD CONSTRAINT "diet_meal_items_kcal_positive" CHECK (kcal >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
