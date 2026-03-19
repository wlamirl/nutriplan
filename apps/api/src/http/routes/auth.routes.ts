import { FastifyInstance } from 'fastify';
import { RegisterSchema, LoginSchema } from '@nutriplan/shared';
import { RegisterNutritionistUseCase, LoginUseCase, DomainError } from '@nutriplan/domain';
import { PgUserRepository, PgNutritionistRepository } from '../../infrastructure/repositories/PgUserRepository';
import { BcryptPasswordHasher } from '../../infrastructure/services/BcryptPasswordHasher';
import { authenticate } from '../middlewares/authenticate';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const userRepo         = new PgUserRepository();
  const nutritionistRepo = new PgNutritionistRepository();
  const passwordHasher   = new BcryptPasswordHasher();

  const registerUseCase = new RegisterNutritionistUseCase(userRepo, nutritionistRepo, passwordHasher);
  const loginUseCase    = new LoginUseCase(userRepo, nutritionistRepo, passwordHasher);

  // ─── POST /auth/register ────────────────────────────────────────────────────

  app.post('/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const result = await registerUseCase.execute(parsed.data);

    const token = app.jwt.sign({
      sub:   result.userId,
      role:  'nutritionist',
      email: result.email,
    });

    return reply.status(201).send({ data: { ...result, token } });
  });

  // ─── POST /auth/login ───────────────────────────────────────────────────────

  app.post('/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    try {
      const result = await loginUseCase.execute(parsed.data);

      const token = app.jwt.sign({
        sub:   result.userId,
        role:  result.role,
        email: result.email,
      });

      return reply.status(200).send({ data: { ...result, token } });
    } catch (err) {
      // Credenciais inválidas → 401 (não 422, pois é falha de autenticação)
      if (err instanceof DomainError) {
        return reply.status(401).send({ error: err.message, code: 'INVALID_CREDENTIALS' });
      }
      throw err;
    }
  });

  // ─── GET /auth/me ───────────────────────────────────────────────────────────

  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({ data: request.user });
  });
}
