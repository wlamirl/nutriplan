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

  app.post('/register', {
    schema: {
      tags:        ['Auth'],
      summary:     'Cadastrar nutricionista',
      security:    [],
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name:     { type: 'string', example: 'Ana Paula' },
          email:    { type: 'string', format: 'email', example: 'ana@teste.com' },
          password: { type: 'string', minLength: 8, example: 'senha1234' },
        },
      },
      response: {
        201: {
          description: 'Nutricionista criado',
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                userId:         { type: 'string' },
                nutritionistId: { type: 'string' },
                email:          { type: 'string' },
                name:           { type: 'string' },
                token:          { type: 'string' },
              },
            },
          },
        },
        400: { description: 'Erro de validação', type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } },
      },
    },
  }, async (request, reply) => {
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

  app.post('/login', {
    schema: {
      tags:     ['Auth'],
      summary:  'Login de nutricionista',
      security: [],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email', example: 'ana@teste.com' },
          password: { type: 'string', example: 'senha1234' },
        },
      },
      response: {
        200: {
          description: 'Login bem-sucedido',
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                userId:          { type: 'string' },
                email:           { type: 'string' },
                role:            { type: 'string' },
                nutritionistId:  { type: 'string' },
                token:           { type: 'string' },
              },
            },
          },
        },
        400: { description: 'Erro de validação',     type: 'object', properties: { error: { type: 'string' } } },
        401: { description: 'Credenciais inválidas', type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
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

  app.get('/me', {
    schema: {
      tags:    ['Auth'],
      summary: 'Dados do usuário autenticado',
      response: {
        200: {
          description: 'Usuário autenticado',
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                sub:   { type: 'string' },
                role:  { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
        401: { description: 'Não autenticado', type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    return reply.send({ data: request.user });
  });
}
