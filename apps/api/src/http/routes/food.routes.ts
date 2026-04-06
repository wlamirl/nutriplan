import { FastifyInstance } from 'fastify';
import {
  FoodSearchQuerySchema,
  FoodSimilaritySearchSchema,
  TriggerSyncSchema,
} from '@nutriplan/shared';
import { DomainError, GenerateFoodEmbeddingsUseCase } from '@nutriplan/domain';
import { AppError } from '@nutriplan/shared';
import { PgFoodRepository }    from '../../infrastructure/repositories/PgFoodRepository';
import { PgSyncLogRepository } from '../../infrastructure/repositories/PgSyncLogRepository';
import { ClaudeEmbeddingService } from '../../infrastructure/ai/ClaudeEmbeddingService';
import { authenticate, requireAdmin } from '../middlewares/authenticate';
import { dispatchFoodSync }    from '../../jobs/food-sync.queue';
import type { FoodSyncJobName } from '../../jobs/food-sync.queue';
import { db }                  from '../../infrastructure/database/db';

export async function foodRoutes(app: FastifyInstance): Promise<void> {
  const foodRepo    = new PgFoodRepository(db);
  const syncLogRepo = new PgSyncLogRepository();
  const embedSvc    = new ClaudeEmbeddingService(
    process.env.ANTHROPIC_API_KEY ?? (() => { throw new Error('ANTHROPIC_API_KEY não definido'); })(),
  );

  // ─── GET /foods/search?q=arroz ───────────────────────────────────────────

  app.get('/search', {
    schema: {
      tags:        ['Foods'],
      summary:     'Buscar alimentos por nome',
      querystring: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer', default: 20 } } },
      response: {
        200: { description: 'Lista de alimentos', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const parsed = FoodSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const results = await foodRepo.findByName(parsed.data.q);
    const limited = results.slice(0, parsed.data.limit);

    return reply.send({ data: limited, meta: { total: limited.length, query: parsed.data.q } });
  });

  // ─── GET /foods/similar ──────────────────────────────────────────────────

  app.post('/similar', {
    schema: {
      tags:    ['Foods'],
      summary: 'Busca semântica de alimentos por similaridade (RAG)',
      response: {
        200: { description: 'Alimentos similares', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const parsed = FoodSimilaritySearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const { queryText, topK, restrictions } = parsed.data;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await embedSvc.embed(queryText);
    } catch (err) {
      throw AppError.internal('Falha ao gerar embedding para a busca');
    }

    const results = await foodRepo.searchBySimilarity({
      queryEmbedding,
      topK,
      excludeTags:  restrictions.excludeTags,
      excludeNames: restrictions.excludeNames,
    });

    return reply.send({ data: results, meta: { total: results.length } });
  });

  // ─── POST /foods/sync — dispara sync manual (admin only) ─────────────────

  app.post('/sync', {
    schema: {
      tags:    ['Foods'],
      summary: 'Disparar sincronização manual de alimentos (admin)',
      response: {
        202: { description: 'Sync agendado', type: 'object', properties: { data: { type: 'object' } } },
      },
    },
    preHandler: [requireAdmin],
  }, async (request, reply) => {
    const parsed = TriggerSyncSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const { source } = parsed.data;

    const jobs: FoodSyncJobName[] = source
      ? [`sync-${source.toLowerCase()}` as FoodSyncJobName]
      : ['sync-tbca', 'sync-usda', 'sync-off'];

    for (const job of jobs) {
      await dispatchFoodSync(job, { triggeredBy: request.user.sub });
    }

    return reply.status(202).send({
      data: { message: 'Sincronização agendada', jobs },
      meta: {},
    });
  });

  // ─── GET /foods/sync/logs ─────────────────────────────────────────────────

  app.get('/sync/logs', {
    schema: {
      tags:        ['Foods'],
      summary:     'Listar logs de sincronização (admin)',
      querystring: { type: 'object', properties: { source: { type: 'string', enum: ['TBCA', 'USDA', 'OFF'] } } },
      response: {
        200: { description: 'Logs de sync', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [requireAdmin],
  }, async (request, reply) => {
    const { source } = request.query as { source?: string };
    const validSource = source === 'TBCA' || source === 'USDA' || source === 'OFF'
      ? source
      : undefined;

    const logs = await syncLogRepo.findAll(validSource);

    return reply.send({ data: logs, meta: { total: logs.length } });
  });
}
