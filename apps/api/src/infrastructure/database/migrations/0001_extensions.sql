-- migration: 0001_extensions.sql
-- Habilitar extensões necessárias antes de qualquer tabela

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector para embeddings
CREATE EXTENSION IF NOT EXISTS "unaccent";     -- busca textual sem acento (português)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- similaridade trigrama para busca fuzzy
