CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper');
--> statement-breakpoint
CREATE TABLE "diet_plans" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"            uuid NOT NULL,
  "consultation_id"       uuid,
  "start_date"            timestamp NOT NULL,
  "end_date"              timestamp NOT NULL,
  "objectives"            text NOT NULL,
  "target_kcal"           integer NOT NULL,
  "target_protein_g"      integer NOT NULL,
  "target_carbs_g"        integer NOT NULL,
  "target_fat_g"          integer NOT NULL,
  "target_protein_pct"    integer NOT NULL,
  "target_carbs_pct"      integer NOT NULL,
  "target_fat_pct"        integer NOT NULL,
  "total_daily_kcal"      integer NOT NULL,
  "total_daily_protein_g" numeric(6,1) NOT NULL,
  "total_daily_carbs_g"   numeric(6,1) NOT NULL,
  "total_daily_fat_g"     numeric(6,1) NOT NULL,
  "ai_model"              text,
  "ai_prompt_tokens"      integer,
  "ai_completion_tokens"  integer,
  "ai_food_sources"       text[],
  "ai_generated_at"       timestamp,
  "created_at"            timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "diet_plans_patient_id_fk"      FOREIGN KEY ("patient_id")      REFERENCES "patients"("id")      ON DELETE CASCADE,
  CONSTRAINT "diet_plans_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id")
);
--> statement-breakpoint
CREATE TABLE "diet_meals" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "diet_plan_id"      uuid NOT NULL,
  "meal_type"         "meal_type" NOT NULL,
  "scheduled_time"    text,
  "total_kcal"        integer NOT NULL,
  "total_protein_g"   numeric(6,1) NOT NULL,
  "total_carbs_g"     numeric(6,1) NOT NULL,
  "total_fat_g"       numeric(6,1) NOT NULL,
  "nutritionist_note" text,
  "created_at"        timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "diet_meals_diet_plan_id_fk" FOREIGN KEY ("diet_plan_id") REFERENCES "diet_plans"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "diet_meal_items" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "diet_meal_id" uuid NOT NULL,
  "food_id"      uuid NOT NULL,
  "quantity_g"   numeric(6,1) NOT NULL,
  "kcal"         integer NOT NULL,
  "protein_g"    numeric(5,1) NOT NULL,
  "carbs_g"      numeric(5,1) NOT NULL,
  "fat_g"        numeric(5,1) NOT NULL,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "diet_meal_items_diet_meal_id_fk" FOREIGN KEY ("diet_meal_id") REFERENCES "diet_meals"("id") ON DELETE CASCADE
);
