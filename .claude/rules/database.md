---
globs: ["apps/api/src/infrastructure/database/**/*.ts", "apps/api/drizzle/**/*.sql"]
---

# Regras para banco de dados e migrations

- Use Drizzle ORM. Nunca escreva SQL raw exceto em queries de busca vetorial pgvector.
- Nunca edite uma migration já gerada. Crie sempre uma nova com `pnpm --filter api db:generate`.
- A extensão `vector` deve estar habilitada antes de qualquer tabela que use o tipo `vector`.
- O índice ivfflat em `food_embeddings.embedding` deve usar `vector_cosine_ops`.
- Colunas de embedding: tipo `vector(1536)` — dimensão compatível com os embeddings do Claude.
- Toda tabela deve ter `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` e `created_at timestamp DEFAULT now()`.
- Foreign keys devem ter `ON DELETE CASCADE` apenas quando fizer sentido de negócio (ex: diet_meal_items quando diet_meal é deletado).
- Nunca use `DROP TABLE` ou `DROP COLUMN` em migrations de produção. Use `ALTER TABLE ... RENAME` ou adicione coluna nova.
