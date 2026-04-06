 # 1. Instalar dependências
  pnpm install

  # 2. Subir Postgres + Redis
  pnpm infra:up

  # 3. Aplicar migrations
  pnpm db:migrate

  # 4. Rodar testes
  pnpm test

  # 5. Dev
  pnpm dev

  # kill process
  lsof -ti :3000 | xargs kill -9 && echo "Processo encerrado"

  Pronto. Com a API rodando (pnpm --filter api dev), acesse:

http://localhost:3000/docs

O que foi feito:

Instalado @fastify/swagger + @fastify/swagger-ui
Configurado no main.ts: OpenAPI 3.0 com bearerAuth JWT habilitado globalmente, UI em docs
Anotadas todas as rotas com tags, summary, params, body e response — organizadas em 5 grupos na UI:

Tag	          Rotas
Auth	        POST /auth/register, POST /auth/login, GET /auth/me
Patients	    CRUD de pacientes
Consultations	Consultas por paciente
Diet Plans	  Gerar, buscar, atualizar, remover planos
Foods	        Busca, similaridade semântica, sync admin

Na UI do Swagger você pode clicar em Authorize, colar o JWT obtido em /auth/login e testar todos os endpoints diretamente pelo browser.

# Uma vez (ou após mudar domain/shared):
pnpm --filter @nutriplan/shared build && pnpm --filter @nutriplan/domain build

# Dev da API:
pnpm --filter api dev