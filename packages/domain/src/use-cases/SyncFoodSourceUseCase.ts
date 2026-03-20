import { IFoodRepository, ISyncLogRepository } from '../repositories/interfaces';
import { IFoodSyncAdapter } from '../services/interfaces';
import { FoodSource } from '../entities/Food';
import { DomainError } from '../errors/DomainError';

export interface SyncFoodSourceRequest {
  adapter: IFoodSyncAdapter;
}

export interface SyncFoodSourceResponse {
  source: FoodSource;
  totalProcessed: number;
  totalInserted: number;
  totalUpdated: number;
  totalFailed: number;
  errors: string[];
}

export class SyncFoodSourceUseCase {
  constructor(
    private readonly foodRepo: IFoodRepository,
    private readonly syncLogRepo: ISyncLogRepository,
  ) {}

  async execute(req: SyncFoodSourceRequest): Promise<SyncFoodSourceResponse> {
    const { adapter } = req;

    const logEntry = await this.syncLogRepo.create(adapter.source);
    await this.syncLogRepo.update(logEntry.id, { status: 'running' });

    let totalProcessed = 0;
    let totalInserted  = 0;
    let totalUpdated   = 0;
    let totalFailed    = 0;
    const errors: string[] = [];

    try {
      for await (const food of adapter.syncAll()) {
        totalProcessed++;
        try {
          const result = await this.foodRepo.upsert(food);
          if (result.created) {
            totalInserted++;
          } else {
            totalUpdated++;
          }
        } catch (err) {
          totalFailed++;
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      await this.syncLogRepo.update(logEntry.id, {
        status: 'completed',
        totalProcessed,
        totalInserted,
        totalUpdated,
        totalFailed,
        finishedAt: new Date(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.syncLogRepo.update(logEntry.id, {
        status: 'failed',
        totalProcessed,
        totalInserted,
        totalUpdated,
        totalFailed,
        errorMessage,
        finishedAt: new Date(),
      });
      throw new DomainError(`Sincronização de ${adapter.source} falhou: ${errorMessage}`);
    }

    return {
      source: adapter.source,
      totalProcessed,
      totalInserted,
      totalUpdated,
      totalFailed,
      errors,
    };
  }
}
