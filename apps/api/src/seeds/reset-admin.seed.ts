/**
 * Redefine a senha do usuário admin.
 *
 * Uso:
 *   pnpm --filter api seed:reset-admin
 *   ADMIN_EMAIL=outro@email.com ADMIN_NEW_PASSWORD=novasenha pnpm --filter api seed:reset-admin
 */
import '../env';
import { db } from '../infrastructure/database/db';
import { users } from '../infrastructure/database/schema';
import { BcryptPasswordHasher } from '../infrastructure/services/BcryptPasswordHasher';
import { eq } from 'drizzle-orm';

const EMAIL    = process.env.ADMIN_EMAIL        ?? 'admin@nutriplan.com';
const PASSWORD = process.env.ADMIN_NEW_PASSWORD ?? 'admin1234';

async function run(): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL)).limit(1);

  if (existing.length === 0) {
    console.error(`Usuário não encontrado: ${EMAIL}`);
    process.exit(1);
  }

  const hasher = new BcryptPasswordHasher();
  const passwordHash = await hasher.hash(PASSWORD);

  await db.update(users).set({ passwordHash }).where(eq(users.email, EMAIL));

  console.log(`✓ Senha redefinida para: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Erro ao redefinir senha:', err);
  process.exit(1);
});
