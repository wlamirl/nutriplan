import { eq, desc } from 'drizzle-orm';
import { db } from '../database/db';
import { consultations } from '../database/schema';
import { Consultation } from '@nutriplan/domain';

export class PgConsultationRepository {

  async create(patientId: string, data: {
    date?: Date;
    weightKg: number;
    bodyFatPct?: number;
    muscleMassKg?: number;
    notes?: string;
  }): Promise<Consultation> {
    const [saved] = await db
      .insert(consultations)
      .values({
        patientId,
        date:         data.date ?? new Date(),
        weightKg:     String(data.weightKg),
        bodyFatPct:   data.bodyFatPct   != null ? String(data.bodyFatPct)   : null,
        muscleMassKg: data.muscleMassKg != null ? String(data.muscleMassKg) : null,
        notes:        data.notes ?? null,
      })
      .returning();

    return this.toDomain(saved!);
  }

  async findByPatientId(patientId: string): Promise<Consultation[]> {
    const rows = await db
      .select()
      .from(consultations)
      .where(eq(consultations.patientId, patientId))
      .orderBy(desc(consultations.date));

    return rows.map(r => this.toDomain(r));
  }

  async findById(id: string): Promise<Consultation | null> {
    const [row] = await db
      .select()
      .from(consultations)
      .where(eq(consultations.id, id))
      .limit(1);

    return row ? this.toDomain(row) : null;
  }

  // ─── Mapeamento ───────────────────────────────────────────────────────────

  private toDomain(row: typeof consultations.$inferSelect): Consultation {
    return {
      id:           row.id,
      date:         row.date,
      weightKg:     parseFloat(row.weightKg),
      bodyFatPct:   row.bodyFatPct   != null ? parseFloat(row.bodyFatPct)   : undefined,
      muscleMassKg: row.muscleMassKg != null ? parseFloat(row.muscleMassKg) : undefined,
      notes:        row.notes ?? undefined,
    };
  }
}
