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
  const foodRepo         = new PgFoodRepository();
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

  app.post('/generate', { preHandler: [authenticate] }, async (request, reply) => {
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

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
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

  app.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
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

  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
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
