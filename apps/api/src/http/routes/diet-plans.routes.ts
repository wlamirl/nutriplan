import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { AppError, GenerateDietPlanSchema } from '@nutriplan/shared';
import { GenerateDietPlanUseCase, DomainError } from '@nutriplan/domain';
import { PgPatientRepository }      from '../../infrastructure/repositories/PgPatientRepository';
import { PgFoodRepository }         from '../../infrastructure/repositories/PgFoodRepository';
import { PgDietPlanRepository }     from '../../infrastructure/repositories/PgDietPlanRepository';
import { PgNutritionistRepository } from '../../infrastructure/repositories/PgUserRepository';
import { ClaudeAIService }          from '../../infrastructure/ai/ClaudeAIService';
import { ClaudeEmbeddingService }   from '../../infrastructure/ai/ClaudeEmbeddingService';
import { authenticate }             from '../middlewares/authenticate';
import { db }                       from '../../infrastructure/database/db';

// ─── In-memory rate limiter: 10 req/min per nutritionist ─────────────────────

const rateLimitStore = new Map<string, number[]>();

function isRateLimited(nutritionistId: string): boolean {
  const now      = Date.now();
  const windowMs = 60_000;
  const limit    = 10;

  const timestamps = rateLimitStore.get(nutritionistId) ?? [];
  const recent     = timestamps.filter(t => now - t < windowMs);

  if (recent.length >= limit) return true;

  recent.push(now);
  rateLimitStore.set(nutritionistId, recent);
  return false;
}

// ─── Partial update schema ────────────────────────────────────────────────────

const UpdateDietPlanSchema = z.object({
  objectives: z.string().min(5).max(500).optional(),
  startDate:  z.string().datetime().optional(),
  endDate:    z.string().datetime().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function dietPlanRoutes(app: FastifyInstance): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
    ?? (() => { throw new Error('ANTHROPIC_API_KEY não definido'); })();

  const patientRepo      = new PgPatientRepository();
  const foodRepo         = new PgFoodRepository(db);
  const dietPlanRepo     = new PgDietPlanRepository();
  const nutritionistRepo = new PgNutritionistRepository();
  const aiService        = new ClaudeAIService(apiKey);
  const embedService     = new ClaudeEmbeddingService(apiKey);

  const generateUseCase = new GenerateDietPlanUseCase(
    patientRepo,
    foodRepo,
    dietPlanRepo,
    aiService,
    embedService,
  );

  // ─── Helper: resolve nutritionistId from JWT userId ──────────────────────

  async function getNutritionistId(userId: string): Promise<string> {
    const nutritionist = await nutritionistRepo.findByUserId(userId);
    if (!nutritionist) throw AppError.notFound('Nutricionista');
    return nutritionist.id;
  }

  // ─── POST /diet-plans/generate ───────────────────────────────────────────

  app.post('/generate', {
    schema: {
      tags:    ['Diet Plans'],
      summary: 'Gerar plano alimentar com IA (RAG + Claude)',
      body: {
        type: 'object',
        required: ['patientId', 'objectives'],
        properties: {
          patientId:        { type: 'string', format: 'uuid' },
          consultationId:   { type: 'string', format: 'uuid' },
          objectives:       { type: 'string', minLength: 5, maxLength: 500, example: 'Perda de peso saudável' },
          customKcalTarget: { type: 'integer', minimum: 800, maximum: 5000 },
          macroSplit: {
            type: 'object',
            properties: {
              proteinPct: { type: 'number' },
              carbsPct:   { type: 'number' },
              fatPct:     { type: 'number' },
            },
          },
          durationDays: { type: 'integer', minimum: 7, maximum: 90, default: 30 },
          mealTypes:    { type: 'array', items: { type: 'string', enum: ['breakfast','morning_snack','lunch','afternoon_snack','dinner','supper'] } },
          extraContext: { type: 'string', maxLength: 1000 },
        },
      },
      response: {
        201: { description: 'Plano gerado',      type: 'object', properties: { data: { type: 'object' }, meta: { type: 'object' } } },
        400: { description: 'Erro de validação', type: 'object', properties: { error: { type: 'string' } } },
        422: { description: 'Erro de domínio',   type: 'object', properties: { error: { type: 'string' } } },
        429: { description: 'Rate limit',        type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const parsed = GenerateDietPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const nutritionistId = await getNutritionistId(request.user.sub);

    // Rate limiting: 10 req/min per nutritionist
    if (isRateLimited(nutritionistId)) {
      return reply.status(429).send({
        error: 'Limite de geração atingido. Aguarde 1 minuto antes de tentar novamente.',
        code:  'RATE_LIMIT_EXCEEDED',
      });
    }

    // Verify the patient belongs to the authenticated nutritionist
    const patient = await patientRepo.findById(parsed.data.patientId);
    if (!patient) throw AppError.notFound('Paciente');
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    // DomainError propagates automatically to errorHandler → 422
    const { plan, warnings } = await generateUseCase.execute(parsed.data);

    const status = warnings.length > 0 ? 201 : 201;

    return reply.status(status).send({
      data: plan,
      meta: {
        warnings,
        generatedAt:      plan.aiGenerationMeta?.generatedAt,
        model:            plan.aiGenerationMeta?.model,
        foodSources:      plan.aiGenerationMeta?.foodSourcesUsed,
        promptTokens:     plan.aiGenerationMeta?.promptTokens,
        completionTokens: plan.aiGenerationMeta?.completionTokens,
      },
    });
  });

  // ─── GET /diet-plans/:id ──────────────────────────────────────────────────

  app.get('/:id', {
    schema: {
      tags:    ['Diet Plans'],
      summary: 'Buscar plano alimentar por ID',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Plano alimentar', type: 'object', properties: { data: { type: 'object' } } },
        404: { description: 'Não encontrado',  type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = await dietPlanRepo.findById(id);
    if (!plan) throw AppError.notFound('Plano alimentar');

    // Verify the patient's plan belongs to the nutritionist
    const patient = await patientRepo.findById(plan.patientId);
    const nutritionistId = await getNutritionistId(request.user.sub);
    if (!patient || patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    return reply.send({ data: plan });
  });

  // ─── PATCH /diet-plans/:id ────────────────────────────────────────────────

  app.patch('/:id', {
    schema: {
      tags:    ['Diet Plans'],
      summary: 'Atualizar plano alimentar',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Plano atualizado',  type: 'object', properties: { data: { type: 'object' } } },
        400: { description: 'Erro de validação', type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateDietPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const plan = await dietPlanRepo.findById(id);
    if (!plan) throw AppError.notFound('Plano alimentar');

    const patient = await patientRepo.findById(plan.patientId);
    const nutritionistId = await getNutritionistId(request.user.sub);
    if (!patient || patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    const updateData: Parameters<typeof dietPlanRepo.update>[1] = {};
    if (parsed.data.objectives !== undefined) updateData.objectives = parsed.data.objectives;
    if (parsed.data.startDate  !== undefined) updateData.startDate  = new Date(parsed.data.startDate);
    if (parsed.data.endDate    !== undefined) updateData.endDate    = new Date(parsed.data.endDate);

    const updated = await dietPlanRepo.update(id, updateData);
    return reply.send({ data: updated });
  });

  // ─── DELETE /diet-plans/:id ───────────────────────────────────────────────

  app.delete('/:id', {
    schema: {
      tags:    ['Diet Plans'],
      summary: 'Remover plano alimentar',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        204: { description: 'Removido com sucesso', type: 'null' },
        404: { description: 'Não encontrado',       type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = await dietPlanRepo.findById(id);
    if (!plan) throw AppError.notFound('Plano alimentar');

    const patient = await patientRepo.findById(plan.patientId);
    const nutritionistId = await getNutritionistId(request.user.sub);
    if (!patient || patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    await dietPlanRepo.delete(id);
    return reply.status(204).send();
  });
}
