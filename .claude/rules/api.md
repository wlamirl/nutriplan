---
globs: ["apps/api/**/*.ts"]
---

# Regras para a camada API (apps/api/)

- Use Fastify, nunca Express, para rotas novas.
- Controllers recebem `Request` e `Reply` do Fastify — nunca acessam repositórios diretamente.
- Valide o body de entrada com Zod antes de chamar o use-case. Retorne 400 com `details` em caso de erro.
- Erros de domínio (`DomainError`) → HTTP 422. Erros inesperados → HTTP 500 via errorHandler.
- Toda rota autenticada usa o middleware `authenticate` via `preHandler`.
- Respostas de sucesso seguem o formato: `{ data: ..., meta: ... }`.
- Nunca exponha stack traces na resposta em produção (`NODE_ENV === 'production'`).
- Rotas de admin verificam `request.user.role === 'admin'` antes de prosseguir.
