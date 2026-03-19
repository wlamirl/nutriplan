# Fase 3 — Motor RAG e geração de dietas

Referência para `@docs/phase-3-rag.md`.

## Objetivo
Implementar o pipeline completo de geração de planos alimentares com RAG.

## Checklist

### 3.1 — Use-case principal (já criado, integrar)
- [ ] Injetar dependências reais em `apps/api/src/main.ts`:
  ```ts
  const patientRepo  = new PgPatientRepository(db);
  const foodRepo     = new PgFoodRepository(db);
  const dietPlanRepo = new PgDietPlanRepository(db);
  const aiService    = new ClaudeAIService();
  const embedService = new ClaudeEmbeddingService();
  const useCase = new GenerateDietPlanUseCase(
    patientRepo, foodRepo, dietPlanRepo, aiService, embedService
  );
  ```
- [ ] Registrar no container de DI (ou factory function)

### 3.2 — Repositórios de infrastructure
- [ ] `PgPatientRepository` implementando `IPatientRepository`
- [ ] `PgFoodRepository` implementando `IFoodRepository` (com searchBySimilarity)
- [ ] `PgDietPlanRepository` implementando `IDietPlanRepository`
- [ ] `PgConsultationRepository`

### 3.3 — Endpoints de planos alimentares
- [ ] POST `/diet-plans/generate` → `DietPlanController.generate` (já criado)
- [ ] GET `/diet-plans/:id`
- [ ] GET `/patients/:patientId/diet-plans`
- [ ] PATCH `/diet-plans/:id` (edição manual pelo nutricionista)
- [ ] DELETE `/diet-plans/:id`

### 3.4 — Endpoints de pacientes e consultas
- [ ] POST `/patients`
- [ ] GET `/patients` (lista do nutricionista autenticado)
- [ ] GET `/patients/:id`
- [ ] PATCH `/patients/:id`
- [ ] POST `/patients/:id/consultations`
- [ ] GET `/patients/:id/consultations`

### 3.5 — Validação e tolerância
- [ ] Garantir tolerância de ±10% calórica (já no use-case)
- [ ] Se warnings.length > 0, retornar com status 201 + campo `meta.warnings`
- [ ] Rate limit na rota de geração: 10 req/min por nutricionista (proteção de custo)

### 3.6 — Cache Redis
- [ ] Cache de embeddings de query (TTL 1h) — evitar re-embeddar mesma query
- [ ] Cache de resultados de busca vetorial por hash do perfil (TTL 30min)

### 3.7 — Testes
- [ ] Teste unitário completo de `GenerateDietPlanUseCase` com mocks
- [ ] Teste de integração: POST `/diet-plans/generate` com banco real
- [ ] Testar cenário com intolerância a lactose + objetivo hipertrofia
- [ ] Testar cenário com diabetes tipo 2

## System prompt do Claude (referência)
Ver implementação em `packages/infrastructure/src/ai/ClaudeAIService.ts`.
O system prompt instrui o modelo a:
1. Usar APENAS os food_ids fornecidos na tabela de candidatos
2. Respeitar todas as restrições alimentares
3. Distribuir macros dentro de ±10% da meta
4. Retornar JSON puro sem markdown
