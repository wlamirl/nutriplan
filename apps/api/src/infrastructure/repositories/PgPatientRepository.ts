import { eq, desc } from 'drizzle-orm';
import { db } from '../database/db';
import { patients, patientRestrictions, consultations } from '../database/schema';
import { IPatientRepository, Patient } from '@nutriplan/domain';

export class PgPatientRepository implements IPatientRepository {

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Patient | null> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, id))
      .limit(1);

    if (!patient) return null;

    const restrictionRows = await db
      .select()
      .from(patientRestrictions)
      .where(eq(patientRestrictions.patientId, id));

    const [lastConsultationRow] = await db
      .select()
      .from(consultations)
      .where(eq(consultations.patientId, id))
      .orderBy(desc(consultations.date))
      .limit(1);

    return this.toDomain(patient, restrictionRows, lastConsultationRow);
  }

  async findByNutritionistId(nutritionistId: string): Promise<Patient[]> {
    const rows = await db
      .select()
      .from(patients)
      .where(eq(patients.nutritionistId, nutritionistId));

    return rows.map(r => this.toDomain(r, [], undefined));
  }

  // ─── Escrita ──────────────────────────────────────────────────────────────

  async save(patient: Patient): Promise<Patient> {
    const insertValues: typeof patients.$inferInsert = {
      nutritionistId:      patient.nutritionistId,
      name:                patient.name,
      birthDate:           patient.birthDate.toISOString().split('T')[0]!,
      sex:                 patient.sex,
      heightCm:            patient.heightCm,
      activityLevel:       patient.activityLevel,
      culturalPreferences: patient.culturalPreferences ?? null,
      routineNotes:        patient.routineNotes ?? null,
      dislikedFoods:       patient.dislikedFoods ?? [],
    };
    // Only set id if non-empty (allows DB to generate UUID when empty)
    if (patient.id) insertValues.id = patient.id;

    const [saved] = await db.insert(patients).values(insertValues).returning();

    if (patient.restrictions.length > 0) {
      await db.insert(patientRestrictions).values(
        patient.restrictions.map(r => ({
          patientId:   saved!.id,
          type:        r.type,
          description: r.description,
        }))
      );
    }

    const savedRestrictions = await db
      .select()
      .from(patientRestrictions)
      .where(eq(patientRestrictions.patientId, saved!.id));

    return this.toDomain(saved!, savedRestrictions, undefined);
  }

  async update(id: string, data: Partial<Patient>): Promise<Patient> {
    const setValues: Partial<typeof patients.$inferInsert> = {};

    if (data.name              !== undefined) setValues.name              = data.name;
    if (data.birthDate         !== undefined) setValues.birthDate         = data.birthDate.toISOString().split('T')[0]!;
    if (data.sex               !== undefined) setValues.sex               = data.sex;
    if (data.heightCm          !== undefined) setValues.heightCm          = data.heightCm;
    if (data.activityLevel     !== undefined) setValues.activityLevel     = data.activityLevel;
    if (data.culturalPreferences !== undefined) setValues.culturalPreferences = data.culturalPreferences ?? null;
    if (data.routineNotes      !== undefined) setValues.routineNotes      = data.routineNotes ?? null;
    if (data.dislikedFoods     !== undefined) setValues.dislikedFoods     = data.dislikedFoods;

    if (Object.keys(setValues).length > 0) {
      await db.update(patients).set(setValues).where(eq(patients.id, id));
    }

    if (data.restrictions !== undefined) {
      await db.delete(patientRestrictions).where(eq(patientRestrictions.patientId, id));
      if (data.restrictions.length > 0) {
        await db.insert(patientRestrictions).values(
          data.restrictions.map(r => ({
            patientId:   id,
            type:        r.type,
            description: r.description,
          }))
        );
      }
    }

    const result = await this.findById(id);
    if (!result) throw new Error(`Patient ${id} not found after update`);
    return result;
  }

  // ─── Mapeamento ───────────────────────────────────────────────────────────

  private toDomain(
    row: typeof patients.$inferSelect,
    restrictionRows: Array<typeof patientRestrictions.$inferSelect>,
    lastConsultationRow: typeof consultations.$inferSelect | undefined,
  ): Patient {
    return {
      id:             row.id,
      nutritionistId: row.nutritionistId,
      name:           row.name,
      birthDate:      new Date(row.birthDate),
      sex:            row.sex,
      heightCm:       row.heightCm,
      activityLevel:  row.activityLevel,
      culturalPreferences: row.culturalPreferences ?? undefined,
      routineNotes:        row.routineNotes ?? undefined,
      dislikedFoods:       row.dislikedFoods ?? [],
      restrictions: restrictionRows.map(r => ({
        id:          r.id,
        type:        r.type,
        description: r.description,
      })),
      lastConsultation: lastConsultationRow
        ? {
            id:           lastConsultationRow.id,
            date:         new Date(lastConsultationRow.date),
            weightKg:     lastConsultationRow.weightKg,
            bodyFatPct:   lastConsultationRow.bodyFatPct   ?? undefined,
            muscleMassKg: lastConsultationRow.muscleMassKg ?? undefined,
            notes:        lastConsultationRow.notes ?? undefined,
          }
        : undefined,
    };
  }
}
