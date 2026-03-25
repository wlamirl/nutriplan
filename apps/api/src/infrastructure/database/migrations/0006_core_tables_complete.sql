-- migration: 0006_core_tables_complete.sql
-- Gerado a partir de schema/core.ts (2026-03-25)
--
-- Cria todas as tabelas do domínio clínico com o esquema atual:
--   users → nutritionists → patients → consultations
--   patients → diet_plans → diet_meals → diet_meal_items
--   patients → patient_restrictions
--
-- Pré-requisito: 0001_extensions.sql deve estar aplicado (uuid-ossp, vector, etc.)

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "public"."user_role" AS ENUM ('nutritionist', 'patient', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."sex" AS ENUM ('M', 'F');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."activity_level" AS ENUM (
    'sedentary',    -- 1.2
    'light',        -- 1.375
    'moderate',     -- 1.55
    'active',       -- 1.725
    'very_active'   -- 1.9
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."restriction_type" AS ENUM (
    'allergy',      -- alergia com risco de anafilaxia
    'intolerance',  -- intolerância digestiva/metabólica
    'clinical',     -- condição clínica: diabetes, hipertensão, DRC
    'preference'    -- escolha pessoal: vegano, vegetariano
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."meal_type" AS ENUM (
    'breakfast',        -- café da manhã
    'morning_snack',    -- lanche da manhã
    'lunch',            -- almoço
    'afternoon_snack',  -- lanche da tarde
    'dinner',           -- jantar
    'supper'            -- ceia
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."diet_plan_status" AS ENUM (
    'draft',      -- gerado, ainda não revisado
    'active',     -- em uso pelo paciente
    'paused',     -- pausado temporariamente
    'completed',  -- período encerrado
    'archived'    -- arquivado pelo nutricionista
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
-- Tabela de autenticação unificada. Nutritionists e patients são rows aqui,
-- com perfis estendidos em nutritionists / patients.

CREATE TABLE IF NOT EXISTS "users" (
  "id"            uuid          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email"         varchar(255)  NOT NULL,
  "password_hash" varchar(255)  NOT NULL,
  "role"          "user_role"   NOT NULL,
  "name"          varchar(255)  NOT NULL,
  "avatar_url"    varchar(500),
  "is_active"     boolean       NOT NULL DEFAULT true,
  "last_login_at" timestamptz,
  "created_at"    timestamptz   NOT NULL DEFAULT now(),
  "updated_at"    timestamptz   NOT NULL DEFAULT now(),
  "deleted_at"    timestamptz,                                 -- soft delete
  CONSTRAINT "users_email_unique" UNIQUE ("email")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_role_idx"       ON "users" ("role");
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");
--> statement-breakpoint

-- ─── nutritionists ────────────────────────────────────────────────────────────
-- Perfil estendido do nutricionista. Relação 1:1 com users.

CREATE TABLE IF NOT EXISTS "nutritionists" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      uuid         NOT NULL,
  "crn"          varchar(20)  NOT NULL,   -- Conselho Regional de Nutrição
  "specialty"    varchar(100),            -- ex: "Nutrição esportiva"
  "bio"          text,
  "phone_number" varchar(20),
  "created_at"   timestamptz  NOT NULL DEFAULT now(),
  "updated_at"   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT "nutritionists_user_id_unique" UNIQUE ("user_id"),
  CONSTRAINT "nutritionists_crn_unique"     UNIQUE ("crn"),
  CONSTRAINT "nutritionists_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- ─── patients ─────────────────────────────────────────────────────────────────
-- Paciente vinculado ao nutricionista que o cadastrou.
-- Dados biométricos BASE ficam aqui; evolução fica em consultations.

CREATE TABLE IF NOT EXISTS "patients" (
  "id"                   uuid             PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nutritionist_id"      uuid             NOT NULL,
  "user_id"              uuid,            -- opcional: acesso ao app mobile
  "name"                 varchar(255)     NOT NULL,
  "birth_date"           date             NOT NULL,
  "sex"                  "sex"            NOT NULL,
  "height_cm"            real             NOT NULL,
  "activity_level"       "activity_level" NOT NULL DEFAULT 'moderate',
  "cultural_preferences" text,
  "routine_notes"        text,
  "disliked_foods"       text[]           NOT NULL DEFAULT '{}'::text[],
  "is_active"            boolean          NOT NULL DEFAULT true,
  "created_at"           timestamptz      NOT NULL DEFAULT now(),
  "updated_at"           timestamptz      NOT NULL DEFAULT now(),
  "deleted_at"           timestamptz,
  CONSTRAINT "patients_height_positive"
    CHECK (height_cm > 0),
  CONSTRAINT "patients_nutritionist_id_fk"
    FOREIGN KEY ("nutritionist_id") REFERENCES "nutritionists" ("id") ON DELETE RESTRICT,
  CONSTRAINT "patients_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "patients_nutritionist_id_idx" ON "patients" ("nutritionist_id");
CREATE INDEX IF NOT EXISTS "patients_user_id_idx"         ON "patients" ("user_id");
CREATE INDEX IF NOT EXISTS "patients_deleted_at_idx"      ON "patients" ("deleted_at");
--> statement-breakpoint

-- ─── patient_restrictions ─────────────────────────────────────────────────────
-- Restrições alimentares e condições clínicas por paciente.

CREATE TABLE IF NOT EXISTS "patient_restrictions" (
  "id"          uuid               PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"  uuid               NOT NULL,
  "type"        "restriction_type" NOT NULL,
  "description" varchar(255)       NOT NULL,
  "severity"    varchar(20),       -- 'mild' | 'moderate' | 'severe'
  "notes"       text,
  "is_active"   boolean            NOT NULL DEFAULT true,
  "created_at"  timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT "patient_restrictions_patient_id_fk"
    FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "patient_restrictions_patient_id_idx" ON "patient_restrictions" ("patient_id");
CREATE INDEX IF NOT EXISTS "patient_restrictions_type_idx"       ON "patient_restrictions" ("type");
--> statement-breakpoint

-- ─── consultations ────────────────────────────────────────────────────────────
-- Cada consulta registra as medidas antropométricas do momento.
-- Serve de base para calcular TDEE e gerar planos alimentares.

CREATE TABLE IF NOT EXISTS "consultations" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"         uuid        NOT NULL,
  "nutritionist_id"    uuid        NOT NULL,
  "date"               date        NOT NULL,

  -- Antropometria
  "weight_kg"          real        NOT NULL,
  "body_fat_pct"       real,
  "muscle_mass_kg"     real,
  "visceral_fat_level" smallint,            -- escala Tanita: 1–59
  "water_pct"          real,
  "bone_mass_kg"       real,

  -- Circunferências (cm)
  "waist_cm"           real,
  "hip_cm"             real,
  "arm_cm"             real,
  "calf_cm"            real,

  -- Exames laboratoriais (schema flexível — campos variam por paciente)
  -- Campos sugeridos: glucose, hba1c, totalCholesterol, hdl, ldl,
  --   triglycerides, creatinine, uricAcid, tsh, hemoglobin,
  --   ferritin, vitaminD, vitaminB12
  "lab_results"        jsonb,

  "notes"              text,
  "next_consultation"  date,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "consultations_weight_positive"
    CHECK (weight_kg > 0),
  CONSTRAINT "consultations_body_fat_range"
    CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 70)),
  CONSTRAINT "consultations_patient_id_fk"
    FOREIGN KEY ("patient_id")      REFERENCES "patients"      ("id") ON DELETE CASCADE,
  CONSTRAINT "consultations_nutritionist_id_fk"
    FOREIGN KEY ("nutritionist_id") REFERENCES "nutritionists" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "consultations_patient_id_idx"   ON "consultations" ("patient_id");
CREATE INDEX IF NOT EXISTS "consultations_date_idx"         ON "consultations" ("date");
-- Índice composto para "última consulta de um paciente"
CREATE INDEX IF NOT EXISTS "consultations_patient_date_idx" ON "consultations" ("patient_id", "date");
--> statement-breakpoint

-- ─── diet_plans ───────────────────────────────────────────────────────────────
-- Plano alimentar gerado (por IA ou manualmente) vinculado a uma consulta.
-- ai_generation_meta: schema flexível sem migrations para metadados de IA.

CREATE TABLE IF NOT EXISTS "diet_plans" (
  "id"                 uuid               PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"         uuid               NOT NULL,
  "consultation_id"    uuid,
  "status"             "diet_plan_status" NOT NULL DEFAULT 'draft',
  "objective_type"     "objective_type"   NOT NULL,
  "objectives"         text               NOT NULL,
  "start_date"         date               NOT NULL,
  "end_date"           date               NOT NULL,

  -- Metas calóricas e de macros
  "daily_kcal_target"  integer            NOT NULL,
  "protein_g_target"   real               NOT NULL,
  "carbs_g_target"     real               NOT NULL,
  "fat_g_target"       real               NOT NULL,
  "protein_pct"        real               NOT NULL,
  "carbs_pct"          real               NOT NULL,
  "fat_pct"            real               NOT NULL,

  -- Totais reais calculados a partir dos itens das refeições
  "total_daily_kcal"   real,
  "total_protein_g"    real,
  "total_carbs_g"      real,
  "total_fat_g"        real,

  -- Metadados da geração por IA (null = criado manualmente)
  -- Campos esperados: model, promptTokens, completionTokens, foodSourcesUsed,
  --   generatedAt, semanticQueryMeta.{objectiveType, estimatedComplexity,
  --   candidateFoodsCount, topKRequested}
  "ai_generation_meta" jsonb              DEFAULT NULL,

  "nutritionist_notes" text,
  "is_ai_generated"    boolean            NOT NULL DEFAULT false,
  "created_at"         timestamptz        NOT NULL DEFAULT now(),
  "updated_at"         timestamptz        NOT NULL DEFAULT now(),

  CONSTRAINT "diet_plans_dates_order"
    CHECK (end_date > start_date),
  CONSTRAINT "diet_plans_kcal_positive"
    CHECK (daily_kcal_target > 0),
  CONSTRAINT "diet_plans_macro_pct_sum"
    CHECK (ABS(protein_pct + carbs_pct + fat_pct - 100) <= 1),
  CONSTRAINT "diet_plans_patient_id_fk"
    FOREIGN KEY ("patient_id")      REFERENCES "patients"      ("id") ON DELETE CASCADE,
  CONSTRAINT "diet_plans_consultation_id_fk"
    FOREIGN KEY ("consultation_id") REFERENCES "consultations" ("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_plans_patient_id_idx"           ON "diet_plans" ("patient_id");
CREATE INDEX IF NOT EXISTS "diet_plans_status_idx"               ON "diet_plans" ("status");
CREATE INDEX IF NOT EXISTS "diet_plans_consultation_id_idx"      ON "diet_plans" ("consultation_id");
-- Índice composto para listar planos ativos de um paciente com ordenação por data
CREATE INDEX IF NOT EXISTS "diet_plans_patient_status_start_idx" ON "diet_plans" ("patient_id", "status", "start_date");
--> statement-breakpoint

-- ─── diet_meals ───────────────────────────────────────────────────────────────
-- Uma refeição dentro de um plano. Ex: "café da manhã às 07:30".
-- Totais são desnormalizados para evitar JOINs pesados no app mobile.

CREATE TABLE IF NOT EXISTS "diet_meals" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "diet_plan_id"      uuid        NOT NULL,
  "meal_type"         "meal_type" NOT NULL,
  "order_index"       smallint    NOT NULL,    -- ordem de exibição no app
  "scheduled_time"    time,                    -- ex: 07:30
  "total_kcal"        real        NOT NULL DEFAULT 0,
  "total_protein_g"   real        NOT NULL DEFAULT 0,
  "total_carbs_g"     real        NOT NULL DEFAULT 0,
  "total_fat_g"       real        NOT NULL DEFAULT 0,
  "nutritionist_note" text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "diet_meals_diet_plan_id_fk"
    FOREIGN KEY ("diet_plan_id") REFERENCES "diet_plans" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_meals_diet_plan_id_idx" ON "diet_meals" ("diet_plan_id");
-- Índice composto para ordenação eficiente das refeições dentro de um plano
CREATE INDEX IF NOT EXISTS "diet_meals_order_idx"        ON "diet_meals" ("diet_plan_id", "order_index");
--> statement-breakpoint

-- ─── diet_meal_items ──────────────────────────────────────────────────────────
-- Item individual dentro de uma refeição: "100g de arroz integral".
-- Valores nutricionais são DESNORMALIZADOS — snapshot do momento da geração.
-- Isso evita que edições no catálogo de alimentos alterem planos já prescritos.

CREATE TABLE IF NOT EXISTS "diet_meal_items" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "diet_meal_id" uuid         NOT NULL,
  "food_id"      uuid         NOT NULL,
  "quantity_g"   real         NOT NULL,
  "kcal"         real         NOT NULL,
  "protein_g"    real         NOT NULL,
  "carbs_g"      real         NOT NULL,
  "fat_g"        real         NOT NULL,
  "fiber_g"      real,
  "sodium_mg"    real,
  "source_used"  varchar(10),             -- 'TBCA' | 'USDA' | 'OFF'
  "created_at"   timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT "diet_meal_items_quantity_positive"
    CHECK (quantity_g > 0),
  CONSTRAINT "diet_meal_items_kcal_positive"
    CHECK (kcal >= 0),
  CONSTRAINT "diet_meal_items_meal_id_fk"
    FOREIGN KEY ("diet_meal_id") REFERENCES "diet_meals" ("id") ON DELETE CASCADE,
  CONSTRAINT "diet_meal_items_food_id_fk"
    -- RESTRICT: não permite deletar alimento referenciado em plano prescrito
    FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "diet_meal_items_meal_id_idx" ON "diet_meal_items" ("diet_meal_id");
CREATE INDEX IF NOT EXISTS "diet_meal_items_food_id_idx" ON "diet_meal_items" ("food_id");
