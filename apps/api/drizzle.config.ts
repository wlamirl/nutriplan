import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema:   './src/infrastructure/database/schema/index.ts',
  out:      './src/infrastructure/database/migrations',
  dialect:  'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict:  true,
});
