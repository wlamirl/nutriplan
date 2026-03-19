import { FastifyRequest, FastifyReply } from 'fastify';
import { GenerateDietPlanSchema } from '@nutriplan/shared';
import { GenerateDietPlanUseCase } from '@nutriplan/domain';

export class DietPlanController {
  constructor(
    private readonly generateDietPlanUseCase: GenerateDietPlanUseCase,
  ) {}

  generate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsed = GenerateDietPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({
        error: 'Erro de validação',
        details: parsed.error.flatten(),
      });
      return;
    }

    // DomainError propagates automatically to errorHandler → 422
    const { plan, warnings } = await this.generateDietPlanUseCase.execute(parsed.data);

    reply.status(201).send({
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
  };
}
