-- migration: 0011_sync_logs_columns.sql
-- Data: 2026-04-06
--
-- Alinha a tabela sync_logs com o schema Drizzle atual (foods.ts).
-- O banco foi criado com nomes legados (total_processed, total_inserted, etc.)
-- enquanto o schema Drizzle usa records_processed, records_upserted, etc.
--
-- Estratégia: renomear colunas legadas e copiar dados existentes.

--> statement-breakpoint
-- Renomear total_processed → records_processed (se ainda não existe)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'total_processed'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'records_processed'
  ) THEN
    ALTER TABLE sync_logs RENAME COLUMN total_processed TO records_processed;
  END IF;
END $$;
--> statement-breakpoint

-- Renomear total_inserted → (dados vão para records_upserted se não existir)
-- records_upserted já existe no banco — apenas dropar total_inserted
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'total_inserted'
  ) THEN
    -- Migrar dados para records_upserted antes de dropar
    UPDATE sync_logs SET records_upserted = COALESCE(total_inserted, records_upserted);
    ALTER TABLE sync_logs DROP COLUMN total_inserted;
  END IF;
END $$;
--> statement-breakpoint

-- Dropar total_updated (mapeado para records_skipped que já existe)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'total_updated'
  ) THEN
    ALTER TABLE sync_logs DROP COLUMN total_updated;
  END IF;
END $$;
--> statement-breakpoint

-- Renomear total_failed → (records_failed já existe — apenas dropar total_failed)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'total_failed'
  ) THEN
    UPDATE sync_logs SET records_failed = COALESCE(total_failed, records_failed);
    ALTER TABLE sync_logs DROP COLUMN total_failed;
  END IF;
END $$;
--> statement-breakpoint

-- Dropar created_at legado (o schema usa started_at)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_logs' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE sync_logs DROP COLUMN created_at;
  END IF;
END $$;
--> statement-breakpoint

-- Garantir NOT NULL com default nas colunas de contagem
ALTER TABLE sync_logs
  ALTER COLUMN records_processed SET NOT NULL,
  ALTER COLUMN records_processed SET DEFAULT 0,
  ALTER COLUMN records_upserted  SET NOT NULL,
  ALTER COLUMN records_upserted  SET DEFAULT 0,
  ALTER COLUMN records_skipped   SET NOT NULL,
  ALTER COLUMN records_skipped   SET DEFAULT 0,
  ALTER COLUMN records_failed    SET NOT NULL,
  ALTER COLUMN records_failed    SET DEFAULT 0;
