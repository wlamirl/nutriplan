import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { errorHandler } from './http/middlewares/errorHandler';
import { authRoutes }  from './http/routes/auth.routes';
import { foodRoutes }  from './http/routes/food.routes';
import { startFoodSyncWorker } from './jobs/food-sync.worker';

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function bootstrap(): Promise<void> {
  // ─── Security plugins ──────────────────────────────────────────────────────
  await app.register(helmet);
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? false : true,
  });

  // ─── Auth plugin ───────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET não definido'); })(),
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
  });

  // ─── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(foodRoutes, { prefix: '/foods' });
  // Registradas nas próximas fases:
  // await app.register(patientRoutes,   { prefix: '/patients' });
  // await app.register(dietPlanRoutes,  { prefix: '/diet-plans' });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ─── Background workers ────────────────────────────────────────────────────
  startFoodSyncWorker();

  // ─── Start ─────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────

const signals = ['SIGINT', 'SIGTERM'] as const;

for (const signal of signals) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}

bootstrap().catch((err: unknown) => {
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
