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