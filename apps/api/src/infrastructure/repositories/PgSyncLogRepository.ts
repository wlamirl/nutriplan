import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { syncLogs } from '../database/schema';
import { ISyncLogRepository, SyncLogEntry, FoodSource } from '@nutriplan/domain';

export class PgSyncLogRepository implements ISyncLogRepository {

  async create(source: FoodSource): Promise<SyncLogEntry> {
    const rows = await db
      .insert(syncLogs)
      .values({ source, status: 'pending' })
      .returning();
    return this.toDomain(rows[0]!);
  }

  async update(
    id: string,
    data: Partial<Omit<SyncLogEntry, 'id' | 'source' | 'createdAt' | 'startedAt'>>,
  ): Promise<SyncLogEntry> {
    const rows = await db
      .update(syncLogs)
      .set({
        ...(data.status          != null && { status:         data.status }),
        ...(data.totalProcessed  != null && { totalProcessed: data.totalProcessed }),
        ...(data.totalInserted   != null && { totalInserted:  data.totalInserted }),
        ...(data.totalUpdated    != null && { totalUpdated:   data.totalUpdated }),
        ...(data.totalFailed     != null && { totalFailed:    data.totalFailed }),
        ...(data.errorMessage    != null && { errorMessage:   data.errorMessage }),
        ...(data.finishedAt      != null && { finishedAt:     data.finishedAt }),
      })
      .where(eq(syncLogs.id, id))
      .returning();
    return this.toDomain(rows[0]!);
  }

  async findAll(source?: FoodSource): Promise<SyncLogEntry[]> {
    const rows = source
      ? await db.select().from(syncLogs).where(eq(syncLogs.source, source))
      : await db.select().from(syncLogs);
    return rows.map(r => this.toDomain(r));
  }

  async findById(id: string): Promise<SyncLogEntry | null> {
    const rows = await db.select().from(syncLogs).where(eq(syncLogs.id, id)).limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  private toDomain(row: typeof syncLogs.$inferSelect): SyncLogEntry {
    return {
      id:             row.id,
      source:         row.source,
      status:         row.status,
      totalProcessed: row.totalProcessed ?? 0,
      totalInserted:  row.totalInserted  ?? 0,
      totalUpdated:   row.totalUpdated   ?? 0,
      totalFailed:    row.totalFailed    ?? 0,
      errorMessage:   row.errorMessage   ?? undefined,
      startedAt:      row.startedAt,
      finishedAt:     row.finishedAt     ?? undefined,
      createdAt:      row.createdAt,
    };
  }
}
