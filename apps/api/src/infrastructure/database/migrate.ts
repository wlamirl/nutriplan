import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';

async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('Aplicando migrations...');
  await migrate(db, {
    migrationsFolder: path.join(__dirname, 'migrations'),
  });

  console.log('Migrations aplicadas com sucesso.');
  await pool.end();
}

runMigrations().catch((err: unknown) => {
  console.error('Falha ao aplicar migrations:', err);
  process.exit(1);
});
