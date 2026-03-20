import { Queue } from 'bullmq';
import { redis } from '../infrastructure/cache/redis';

export type FoodSyncJobName = 'sync-tbca' | 'sync-usda' | 'sync-off' | 'generate-embeddings';

export interface FoodSyncJobData {
  triggeredBy?: string;   // 'cron' | 'manual' | userId
}

export const foodSyncQueue = new Queue<FoodSyncJobData>('food-sync', {
  connection: redis,
  defaultJobOptions: {
    attempts:      3,
    backoff:       { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 100 },
  },
});

export async function dispatchFoodSync(
  jobName: FoodSyncJobName,
  data: FoodSyncJobData = {},
): Promise<void> {
  await foodSyncQueue.add(jobName, data);
}
