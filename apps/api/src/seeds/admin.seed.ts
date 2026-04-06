/**
 * Seed para criar um usuário admin.
 *
 * Uso: pnpm --filter api seed:admin
 */
import '../env';
import { db } from '../infrastructure/database/db';
import { users } from '../infrastructure/database/schema';
import { BcryptPasswordHasher } from '../infrastructure/services/BcryptPasswordHasher';
import { eq } from 'drizzle-orm';

const EMAIL    = process.env.ADMIN_EMAIL    ?? 'admin@nutriplan.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin1234';

async function run(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);

  if (existing.length > 0) {
    console.log(`Usuário admin já existe: ${EMAIL}`);
    process.exit(0);
  }

  const hasher = new BcryptPasswordHasher();
  const passwordHash = await hasher.hash(PASSWORD);

  await db.insert(users).values({
    email:        EMAIL,
    passwordHash,
    role:         'admin',
    name:         'Admin',
    isActive:     true,
  });

  console.log(`✓ Admin criado: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Erro ao criar admin:', err);
  process.exit(1);
});
