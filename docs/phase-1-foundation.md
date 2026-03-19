# Fase 1 — Fundação do projeto

Referência para `@docs/phase-1-foundation.md`.
Use este arquivo com: `ultrathink. Implemente a Fase 1 conforme @docs/phase-1-foundation.md`

## Objetivo
Criar toda a estrutura do monorepo, configurar Docker, banco de dados, autenticação e o esqueleto das camadas.

## Checklist de implementação

### 1.1 — Estrutura do monorepo
- [ ] Criar `pnpm-workspace.yaml` com packages: `apps/*`, `packages/*`
- [ ] Criar `turbo.json` com pipelines: `build`, `dev`, `test`, `lint`
- [ ] Criar `package.json` raiz com scripts de conveniência
- [ ] Criar `tsconfig.base.json` com strict mode e path aliases
- [ ] Criar `.env.example` com todas as variáveis necessárias
- [ ] Criar `docker-compose.yml` (postgres 16 + pgvector, redis)
- [ ] Criar `.gitignore` (node_modules, .env, dist, .turbo)

### 1.2 — Packages do domain
- [ ] Criar `packages/domain/` com `package.json` e `tsconfig.json`
- [ ] Implementar `src/entities/Patient.ts` (com calculateBMR, calculateTDEE)
- [ ] Implementar `src/entities/Food.ts` (com scaleNutrients)
- [ ] Implementar `src/entities/DietPlan.ts` (com MealType, calculateMealTotals)
- [ ] Implementar `src/repositories/interfaces.ts` (IPatientRepository, IFoodRepository, IDietPlanRepository)
- [ ] Implementar `src/services/interfaces.ts` (IAIService, IEmbeddingService)
- [ ] Implementar `src/errors/DomainError.ts`

### 1.3 — Package shared
- [ ] Criar `packages/shared/` com `package.json` e `tsconfig.json`
- [ ] Criar `src/errors/AppError.ts` com status code
- [ ] Criar `src/types/api.ts` (tipos de resposta padrão)
- [ ] Criar `src/validators/patient.schema.ts` (Zod)
- [ ] Criar `src/validators/dietPlan.schema.ts` (Zod)

### 1.4 — API: configuração base
- [ ] Criar `apps/api/` com Fastify + TypeScript
- [ ] Configurar plugins: `@fastify/jwt`, `@fastify/cors`, `@fastify/helmet`
- [ ] Criar `src/main.ts` com startup e graceful shutdown
- [ ] Criar `src/http/middlewares/authenticate.ts` (JWT guard)
- [ ] Criar `src/http/middlewares/errorHandler.ts`

### 1.5 — Banco de dados: migrations iniciais
- [ ] Configurar Drizzle ORM com conexão ao PostgreSQL
- [ ] Habilitar extensão pgvector no schema (`CREATE EXTENSION IF NOT EXISTS vector`)
- [ ] Migration 0001: tabelas `users` e `nutritionists`
- [ ] Migration 0002: tabelas `patients`, `patient_restrictions`, `consultations`
- [ ] Migration 0003: tabelas `diet_plans`, `diet_meals`, `diet_meal_items`
- [ ] Migration 0004: tabelas `foods`, `food_sources`, `food_tags`, `food_embeddings` (vector(1536)), `sync_logs`
- [ ] Criar índice ivfflat em `food_embeddings.embedding` para cosine similarity

### 1.6 — Auth: registro e login
- [ ] Implementar `RegisterNutritionistUseCase` (domain)
- [ ] Implementar `LoginUseCase` (domain)
- [ ] Implementar `PgUserRepository` (infrastructure)
- [ ] Criar rota POST `/auth/register`
- [ ] Criar rota POST `/auth/login`
- [ ] Criar rota GET `/auth/me`

### 1.7 — Testes da fase 1
- [ ] Teste unitário: `RegisterNutritionistUseCase`
- [ ] Teste unitário: `LoginUseCase`
- [ ] Teste de integração: rotas de auth (com banco real via Docker)

## Arquivos de referência já criados
Os seguintes arquivos já existem e devem ser usados como base:
- `packages/domain/src/entities/Patient.ts`
- `packages/domain/src/entities/Food.ts`
- `packages/domain/src/entities/DietPlan.ts`
- `packages/domain/src/repositories/interfaces.ts`
- `packages/domain/src/services/interfaces.ts`
- `packages/domain/src/use-cases/GenerateDietPlanUseCase.ts`
- `packages/infrastructure/src/ai/ClaudeAIService.ts`
- `apps/api/src/http/controllers/DietPlanController.ts`
