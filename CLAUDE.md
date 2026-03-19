# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral do projeto
Aplicativo SaaS para nutricionistas. Monorepo com web (React), mobile (React Native) e API (Node.js). Motor de IA com RAG (pgvector + Claude API) para geração de planos alimentares personalizados.

## Pré-requisitos
- Node.js 20+
- pnpm 9+: `npm install -g pnpm`
- Docker Desktop (para PostgreSQL + Redis)

## Stack
- Monorepo: pnpm workspaces + Turborepo
- Frontend web: React 18, TypeScript, Vite, TailwindCSS
- Mobile: React Native (Expo), TypeScript
- Backend: Node.js, Fastify, TypeScript
- ORM: Drizzle ORM
- Banco principal: PostgreSQL 16 + extensão pgvector
- Cache / filas: Redis (BullMQ para jobs de sync)
- IA: Claude API (claude-sonnet-4-20250514)
- Validação: Zod (em toda a stack)
- Testes: Vitest (unit), Supertest (integration)
- Containerização: Docker + docker-compose

## Arquitetura — Clean Architecture + SOLID
A separação de camadas é INEGOCIÁVEL. Nunca viole estas fronteiras:

```
packages/domain        → entidades, use-cases, interfaces de repositório e serviço
packages/infrastructure → implementações concretas (Postgres, Redis, Claude API, sync adapters)
packages/shared        → DTOs, erros, validators Zod (sem lógica de negócio)
packages/api-client    → cliente HTTP tipado (fetch) — usado por web e mobile
apps/api               → HTTP layer (controllers, rotas, middlewares)
apps/web               → React SPA
apps/mobile            → React Native / Expo
```

> **Atenção:** o diretório `packages/infrastructure/` existe no disco com typo como `packages/infrastucture/` (falta um 'r'). Corrija para `infrastructure` ao criar novos arquivos ou ao mover existentes.

## Arquivos já implementados (ponto de partida)
Os seguintes arquivos já existem e devem ser usados como base para as fases seguintes:
- `packages/domain/src/entities/Patient.ts` — com `calculateBMR`, `calculateTDEE`
- `packages/domain/src/entities/Food.ts` — com `scaleNutrients`
- `packages/domain/src/entities/DietPlan.ts` — com `MealType`, `calculateMealTotals`
- `packages/domain/src/repositories/interfaces.ts` — `IPatientRepository`, `IFoodRepository`, `IDietPlanRepository`
- `packages/domain/src/services/interfaces.ts` — `IAIService`, `IEmbeddingService`
- `packages/domain/src/use-cases/GenerateDietPlanUseCase.ts` — pipeline completo de geração de dieta
- `packages/infrastucture/src/ai/ClaudeAIService.ts` — implementação de `IAIService` via Claude API
- `apps/api/src/http/controllers/DietPlanController.ts` — **usa Express** (deve ser migrado para Fastify)

## Regras de código (imperativos)

- Use TypeScript strict em todos os arquivos. Nunca use `any`.
- Nomeie arquivos em PascalCase para classes/entidades, kebab-case para utilitários.
- Escreva funções puras sempre que possível. Evite efeitos colaterais fora de infrastructure/.
- Use injeção de dependência via construtor. O domain NUNCA importa de infrastructure.
- Valide todo input externo com Zod antes de entrar no use-case.
- Trate erros com `DomainError` (domain) e `AppError` (http layer). Nunca lance strings.
- Escreva testes unitários para todos os use-cases. Mock repositórios e serviços com interfaces.
- Use `pnpm` — nunca `npm` ou `yarn`.
- Commits em português, formato conventional: `feat:`, `fix:`, `chore:`, `docs:`.

## Comandos principais
- Instalar deps: `pnpm install`
- Dev (todos): `pnpm dev`
- Dev só API: `pnpm --filter api dev`
- Build: `pnpm build`
- Testes: `pnpm test`
- Rodar um único teste: `pnpm --filter <package> test -- <caminho-do-arquivo>`
- Lint: `pnpm lint`
- Subir infra local: `docker compose up -d`
- Migrations: `pnpm --filter api db:migrate`
- Gerar tipos do DB: `pnpm --filter api db:generate`

## Banco de dados
- PostgreSQL 16 na porta 5432 (via Docker)
- Extensão pgvector habilitada — use para embeddings de alimentos
- Redis na porta 6379 (via Docker)
- Migrations ficam em `apps/api/src/infrastructure/database/migrations/`
- Nunca edite migrations já aplicadas. Crie sempre uma nova.

## Variáveis de ambiente
Arquivo `.env` na raiz (ver `.env.example`). Nunca commite `.env`.
Variáveis críticas: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `USDA_API_KEY`.

## Plano de implementação (ordem recomendada)
Implemente nesta sequência. Use `@docs/` para contexto adicional de cada etapa.

- [ ] Fase 1 — Fundação (@docs/phase-1-foundation.md)
- [ ] Fase 2 — Catálogo de alimentos e sync (@docs/phase-2-foods.md)
- [ ] Fase 3 — Motor RAG e geração de dietas (@docs/phase-3-rag.md)
- [ ] Fase 4 — Frontend web (@docs/phase-4-web.md)
- [ ] Fase 5 — App mobile (@docs/phase-5-mobile.md)

## Regras modulares (carregadas automaticamente por path glob)
- `.claude/rules/api.md` → regras para `apps/api/**`
- `.claude/rules/domain.md` → regras para `packages/domain/**`
- `.claude/rules/frontend.md` → regras para `apps/web/**`
- `.claude/rules/database.md` → regras para arquivos de migration e schema
