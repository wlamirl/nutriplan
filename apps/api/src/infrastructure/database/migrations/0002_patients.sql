CREATE TYPE "public"."sex" AS ENUM('M', 'F');
--> statement-breakpoint
CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active');
--> statement-breakpoint
CREATE TYPE "public"."restriction_type" AS ENUM('allergy', 'intolerance', 'clinical', 'preference');
--> statement-breakpoint
CREATE TABLE "patients" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nutritionist_id"      uuid NOT NULL,
  "name"                 text NOT NULL,
  "birth_date"           date NOT NULL,
  "sex"                  "sex" NOT NULL,
  "height_cm"            numeric(5,1) NOT NULL,
  "activity_level"       "activity_level" NOT NULL,
  "cultural_preferences" text,
  "routine_notes"        text,
  "disliked_foods"       text[] NOT NULL DEFAULT '{}',
  "created_at"           timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "patients_nutritionist_id_fk" FOREIGN KEY ("nutritionist_id") REFERENCES "nutritionists"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "patient_restrictions" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"  uuid NOT NULL,
  "type"        "restriction_type" NOT NULL,
  "description" text NOT NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "patient_restrictions_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "consultations" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "patient_id"     uuid NOT NULL,
  "date"           timestamp DEFAULT now() NOT NULL,
  "weight_kg"      numeric(5,2) NOT NULL,
  "body_fat_pct"   numeric(4,1),
  "muscle_mass_kg" numeric(5,2),
  "notes"          text,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "consultations_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
);
