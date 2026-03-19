-- pgvector deve ser habilitado ANTES de qualquer coluna do tipo vector
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('TBCA', 'USDA', 'OFF');
--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'running', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE "foods" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name_pt"       text NOT NULL,
  "name_en"       text,
  "category"      text NOT NULL,
  "subcategory"   text,
  "tags"          text[] NOT NULL DEFAULT '{}',
  "kcal_per100g"  numeric(7,2) NOT NULL,
  "protein_g"     numeric(6,2) NOT NULL,
  "carbs_g"       numeric(6,2) NOT NULL,
  "fat_g"         numeric(6,2) NOT NULL,
  "fiber_g"       numeric(5,2),
  "sodium_mg"     numeric(7,2),
  "calcium_mg"    numeric(7,2),
  "iron_mg"       numeric(6,3),
  "zinc_mg"       numeric(6,3),
  "vit_c_mg"      numeric(6,2),
  "vit_b12_mcg"   numeric(6,3),
  "primary_source" "food_source" NOT NULL,
  "external_id"   text,
  "created_at"    timestamp DEFAULT now() NOT NULL,
  "updated_at"    timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_embeddings" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "food_id"    uuid NOT NULL,
  "embedding"  vector(1536) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "food_embeddings_food_id_unique" UNIQUE("food_id"),
  CONSTRAINT "food_embeddings_food_id_fk" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE
);
--> statement-breakpoint
-- ivfflat para cosine similarity (listas=100 é adequado para até ~1M vetores)
CREATE INDEX "food_embeddings_embedding_idx"
  ON "food_embeddings"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source"          "food_source" NOT NULL,
  "status"          "sync_status" NOT NULL DEFAULT 'pending',
  "total_processed" integer DEFAULT 0,
  "total_inserted"  integer DEFAULT 0,
  "total_updated"   integer DEFAULT 0,
  "total_failed"    integer DEFAULT 0,
  "error_message"   text,
  "started_at"      timestamp DEFAULT now() NOT NULL,
  "finished_at"     timestamp,
  "created_at"      timestamp DEFAULT now() NOT NULL
);
