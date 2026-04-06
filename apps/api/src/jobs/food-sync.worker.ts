import { Worker, Job } from 'bullmq';
import { redis } from '../infrastructure/cache/redis';
import { PgFoodRepository }     from '../infrastructure/repositories/PgFoodRepository';
import { PgSyncLogRepository }  from '../infrastructure/repositories/PgSyncLogRepository';
import { ClaudeEmbeddingService } from '../infrastructure/ai/ClaudeEmbeddingService';
import { TbcaSyncAdapter }       from '../infrastructure/sync/TbcaSyncAdapter';
import { UsdaSyncAdapter }        from '../infrastructure/sync/UsdaSyncAdapter';
import { OpenFoodFactsSyncAdapter } from '../infrastructure/sync/OpenFoodFactsSyncAdapter';
import {
  SyncFoodSourceUseCase,
  GenerateFoodEmbeddingsUseCase,
} from '@nutriplan/domain';
import { FoodSyncJobData, FoodSyncJobName } from './food-sync.queue';
import { db } from '../infrastructure/database/db';

const logger = {
  info:  (data: unknown, msg?: string) => console.log(`[food-sync] ${msg ?? ''}`, data),
  error: (data: unknown, msg?: string) => console.error(`[food-sync] ${msg ?? ''}`, data),
};

function buildDeps() {
  const foodRepo    = new PgFoodRepository(db);
  const syncLogRepo = new PgSyncLogRepository();
  const embedSvc    = new ClaudeEmbeddingService(
    process.env.ANTHROPIC_API_KEY ?? (() => { throw new Error('ANTHROPIC_API_KEY não definido'); })(),
  );
  return { foodRepo, syncLogRepo, embedSvc };
}

async function processJob(job: Job<FoodSyncJobData>): Promise<void> {
  const jobName = job.name as FoodSyncJobName;
  logger.info({ jobName, jobId: job.id }, 'Iniciando job de sincronização');

  const { foodRepo, syncLogRepo, embedSvc } = buildDeps();
  const syncUseCase  = new SyncFoodSourceUseCase(foodRepo, syncLogRepo);
  const embedUseCase = new GenerateFoodEmbeddingsUseCase(foodRepo, embedSvc);

  switch (jobName) {
    case 'sync-tbca': {
      const jsonPath = process.env.TBCA_JSON_PATH ?? 'data/tbca.json';
      const adapter  = new TbcaSyncAdapter(jsonPath);
      const result   = await syncUseCase.execute({ adapter });
      logger.info(result, 'sync-tbca concluído');
      break;
    }

    case 'sync-usda': {
      const apiKey = process.env.USDA_API_KEY ?? (() => { throw new Error('USDA_API_KEY não definido'); })();
      const adapter = new UsdaSyncAdapter(apiKey);
      const result  = await syncUseCase.execute({ adapter });
      logger.info(result, 'sync-usda concluído');
      break;
    }

    case 'sync-off': {
      const adapter = new OpenFoodFactsSyncAdapter();
      const result  = await syncUseCase.execute({ adapter });
      logger.info(result, 'sync-off concluído');
      break;
    }

    case 'generate-embeddings': {
      const result = await embedUseCase.execute({});
      logger.info(result, 'generate-embeddings concluído');
      break;
    }

    default: {
      const exhaustive: never = jobName;
      throw new Error(`Job desconhecido: ${exhaustive}`);
    }
  }
}

export function startFoodSyncWorker(): Worker<FoodSyncJobData> {
  const worker = new Worker<FoodSyncJobData>('food-sync', processJob, {
    connection:  redis,
    concurrency: 1,   // sincronizações rodam em série para evitar conflitos
  });

  worker.on('completed', job => {
    logger.info({ jobName: job.name, jobId: job.id }, 'Job concluído com sucesso');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobName: job?.name, jobId: job?.id, err }, 'Job falhou');
  });

  return worker;
}
