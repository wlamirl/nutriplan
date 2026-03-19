CREATE TYPE "public"."user_role" AS ENUM('nutritionist', 'admin');
--> statement-breakpoint
CREATE TABLE "users" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email"         text NOT NULL,
  "password_hash" text NOT NULL,
  "role"          "user_role" NOT NULL DEFAULT 'nutritionist',
  "created_at"    timestamp DEFAULT now() NOT NULL,
  "updated_at"    timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "nutritionists" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    uuid NOT NULL,
  "name"       text NOT NULL,
  "crn"        text,
  "phone"      text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "nutritionists_crn_unique" UNIQUE("crn"),
  CONSTRAINT "nutritionists_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
