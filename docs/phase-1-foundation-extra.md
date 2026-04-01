# Fase 1 — Fundação do projeto

Referência para `@docs/phase-1-foundation-extra.md`.
Use este arquivo com: `ultrathink. Implemente a Fase 1 conforme @docs/phase-1-foundation-extra.md`

## Objetivo
Criar toda a estrutura do monorepo, configurar Docker, banco de dados, autenticação e o esqueleto das camadas.

## Checklist de implementação

### 1.5 — Banco de dados: migrations iniciais
- [ ] Migration 0006: tabelas `users`, `nutritionists`, `patients`, `patient_restrictions`, `consultations`, `diet_plans`, `diet_meals`, `diet_meal_items`
- [ ] Migration 0004: tabelas `foods`, `food_sources`, `food_tags`, `food_embeddings` (vector(1536)), `sync_logs`
- [ ] Criar índice ivfflat em `food_embeddings.embedding` para cosine similarity