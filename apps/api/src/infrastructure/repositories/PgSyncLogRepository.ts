import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { syncLogs } from '../database/schema';
import { ISyncLogRepository, SyncLogEntry, FoodSource } from '@nutriplan/domain';

// ─── Status mapping ───────────────────────────────────────────────────────────
// Domain: 'pending' | 'running' | 'completed' | 'failed'
// DB:     'pending' | 'running' | 'completed' | 'failed'  (mesmos valores)

type DbStatus = 'pending' | 'running' | 'completed' | 'failed';

function toDbStatus(status: SyncLogEntry['status']): DbStatus {
  return status;
}

function toDomainStatus(status: DbStatus): SyncLogEntry['status'] {
  return status;
}

export class PgSyncLogRepository implements ISyncLogRepository {

  async create(source: FoodSource): Promise<SyncLogEntry> {
    const rows = await db
      .insert(syncLogs)
      .values({ source, status: 'running' })
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
        ...(data.status         != null && { status:           toDbStatus(data.status) }),
        ...(data.totalProcessed != null && { recordsProcessed: data.totalProcessed }),
        ...(data.totalInserted  != null && { recordsUpserted:  data.totalInserted }),
        ...(data.totalFailed    != null && { recordsFailed:    data.totalFailed }),
        ...(data.errorMessage   != null && { errorMessage:     data.errorMessage }),
        ...(data.finishedAt     != null && { finishedAt:       data.finishedAt }),
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
      status:         toDomainStatus(row.status),
      totalProcessed: row.recordsProcessed,
      totalInserted:  row.recordsUpserted,
      totalUpdated:   row.recordsSkipped,   // closest available column
      totalFailed:    row.recordsFailed,
      errorMessage:   row.errorMessage   ?? undefined,
      startedAt:      row.startedAt,
      finishedAt:     row.finishedAt     ?? undefined,
      createdAt:      row.startedAt,        // schema has no separate createdAt
    };
  }
}
