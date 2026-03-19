# NutriPlan Pro — Guia de início rápido com Claude Code

## Pré-requisitos
- Node.js 20+
- pnpm 9+: `npm install -g pnpm`
- Docker Desktop
- Claude Code: `npm install -g @anthropic-ai/claude-code`
- VS Code com extensão Claude Code (opcional, mas recomendado)

---

## 1. Preparação (5 min)

```bash
# Criar a pasta do projeto
mkdir nutri-plan && cd nutri-plan

# Copiar todos os arquivos gerados para esta pasta
# (CLAUDE.md, docs/, .claude/, packages/, apps/)

# Iniciar o Claude Code no diretório
claude
```

---

## 2. Verificar que o Claude leu o contexto

No terminal do Claude Code, rode:
```
/memory
```
Você verá o `CLAUDE.md` e os arquivos de `.claude/rules/` listados. Isso confirma que o Claude carregou toda a arquitetura.

---

## 3. Executar as fases em ordem

### Fase 1 — Fundação
```
ultrathink. Implemente a Fase 1 conforme @docs/phase-1-foundation.md
Comece pela estrutura do monorepo e vá implementando cada item do checklist em ordem.
Confirme comigo antes de iniciar cada sub-seção (1.1, 1.2, etc.).
```

### Fase 2 — Catálogo de alimentos
```
ultrathink. Implemente a Fase 2 conforme @docs/phase-2-foods.md
Os adapters TBCA, USDA e Open Food Facts devem seguir a interface IFoodSyncAdapter do domain.
```

### Fase 3 — Motor RAG
```
ultrathink. Implemente a Fase 3 conforme @docs/phase-3-rag.md
Os arquivos base do use-case já existem em packages/domain e packages/infrastructure.
Integre-os e implemente os repositórios concretos.
```

---

## 4. Dicas de uso do Claude Code

**Pedir revisão de uma implementação:**
```
Revise @packages/domain/src/use-cases/GenerateDietPlanUseCase.ts
Verifique se está seguindo Clean Architecture e os princípios SOLID do @CLAUDE.md
```

**Adicionar um novo use-case:**
```
Crie o use-case CreateConsultationUseCase seguindo o mesmo padrão de
@packages/domain/src/use-cases/GenerateDietPlanUseCase.ts
```

**Pedir testes:**
```
Escreva testes unitários completos para @packages/domain/src/use-cases/GenerateDietPlanUseCase.ts
Use Vitest. Mock todos os repositórios e serviços.
Cubra os cenários: paciente sem consulta, restrição de lactose, objetivo hipertrofia.
```

**Quando travar em um erro:**
```
Estou com este erro: [colar o erro]
Arquivo relevante: @apps/api/src/http/controllers/DietPlanController.ts
```

---

## 5. Estrutura de arquivos gerados nesta sessão

```
nutri-plan/
├── CLAUDE.md                          ← lido automaticamente pelo Claude Code
├── docs/
│   ├── phase-1-foundation.md          ← plano detalhado da fase 1
│   ├── phase-2-foods.md               ← plano detalhado da fase 2
│   └── phase-3-rag.md                 ← plano detalhado da fase 3
├── .claude/
│   └── rules/
│       ├── api.md                     ← regras para apps/api/**
│       ├── domain.md                  ← regras para packages/domain/**
│       └── database.md                ← regras para migrations
└── packages/
    ├── domain/src/
    │   ├── entities/Patient.ts
    │   ├── entities/Food.ts
    │   ├── entities/DietPlan.ts
    │   ├── repositories/interfaces.ts
    │   ├── services/interfaces.ts
    │   └── use-cases/GenerateDietPlanUseCase.ts
    └── infrastructure/src/
        └── ai/ClaudeAIService.ts
    apps/api/src/
        └── http/controllers/DietPlanController.ts
```

---

## 6. Variáveis de ambiente necessárias

Crie o arquivo `.env` na raiz com:
```env
# Banco de dados
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nutriplan
REDIS_URL=redis://localhost:6379

# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Auth
JWT_SECRET=sua-chave-secreta-aqui
JWT_EXPIRES_IN=7d

# USDA FoodData Central (gratuito em fdc.nal.usda.gov)
USDA_API_KEY=sua-chave-usda

# App
NODE_ENV=development
PORT=3000
```
