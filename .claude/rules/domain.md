---
globs: ["packages/domain/**/*.ts"]
---

# Regras para a camada Domain (packages/domain/)

- O domain NUNCA importa de `packages/infrastructure`, `apps/api`, `apps/web` ou `apps/mobile`.
- Use-cases dependem APENAS de interfaces (IPatientRepository, IAIService, etc.) — nunca de classes concretas.
- Entidades são classes ou interfaces simples com lógica de negócio pura (sem I/O).
- Erros de negócio: lance `DomainError` com mensagem clara em português.
- Funções de cálculo (BMR, TDEE, scaleNutrients) devem ser puras e testáveis sem mocks.
- Novos use-cases recebem dependências via construtor e expõem um único método `execute(request): Promise<response>`.
- Não use decorators ou frameworks no domain — TypeScript puro.
