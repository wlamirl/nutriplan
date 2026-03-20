/// <reference types="node" />
import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env') });

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
