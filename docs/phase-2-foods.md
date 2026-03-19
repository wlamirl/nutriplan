# Fase 2 — Catálogo de alimentos e sincronização

Referência para `@docs/phase-2-foods.md`.

## Objetivo
Implementar os adapters de sincronização com TBCA, USDA e Open Food Facts, geração de embeddings e busca vetorial.

## Checklist

### 2.1 — Adapters de sincronização
- [ ] Interface `IFoodSyncAdapter` em domain/services
- [ ] `TbcaSyncAdapter` — parser do JSON da TBCA (download manual, sem API pública)
- [ ] `UsdaSyncAdapter` — API REST da USDA FoodData Central (chave gratuita em fdc.nal.usda.gov)
- [ ] `OpenFoodFactsSyncAdapter` — API REST off.org (sem autenticação)
- [ ] Normalizar todos para o schema `Food` do domain
- [ ] `SyncFoodSourceUseCase` — orquestra os adapters, faz upsert no Postgres

### 2.2 — Embeddings
- [ ] `ClaudeEmbeddingService` — usa `claude-sonnet-4-20250514` para gerar texto descritivo de cada alimento e embeddings via API
- [ ] Texto de embedding: `"${namePt} - ${category} - ${subcategory} - rico em ${topNutrients} - fonte: ${source}"`
- [ ] `GenerateFoodEmbeddingsUseCase` — processa em lotes de 50 alimentos
- [ ] Salvar vetor em `food_embeddings.embedding` (vector(1536))

### 2.3 — Busca vetorial
- [ ] `PgFoodRepository.searchBySimilarity()` com cosine distance via pgvector
- [ ] Query: `ORDER BY embedding <=> $1 LIMIT $2`
- [ ] Filtros SQL: `tags NOT IN (excludeTags)`, `name NOT IN (excludeNames)`
- [ ] Testar com paciente com intolerância a lactose

### 2.4 — Jobs de sincronização (BullMQ)
- [ ] Queue `food-sync` com jobs: `sync-tbca`, `sync-usda`, `sync-off`
- [ ] Cron: TBCA mensal, USDA semanal, OFF diário
- [ ] Worker processa em background (apps/api/src/jobs/)
- [ ] Registrar resultado em `sync_logs`

### 2.5 — Endpoints REST
- [ ] GET `/foods/search?q=arroz` — busca textual
- [ ] GET `/foods/similar` — busca vetorial (body: { queryText, topK, restrictions })
- [ ] POST `/foods/sync` — dispara sync manual (admin only)
- [ ] GET `/foods/sync/logs` — histórico de syncs

### 2.6 — Seed inicial
- [ ] Script `pnpm --filter api db:seed` com ~200 alimentos brasileiros comuns
- [ ] Gerar embeddings para todos no seed
