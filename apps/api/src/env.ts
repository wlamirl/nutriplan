import { config } from 'dotenv';
import { resolve } from 'path';

// Este módulo deve ser o PRIMEIRO import em main.ts.
// Em modo CJS, todos os imports viram require() hoistados — se este for o
// primeiro, dotenv.config() roda antes que qualquer outro módulo (inclusive
// db.ts e seus new Pool()) seja inicializado.
config({ path: resolve(__dirname, '../../../.env') });
