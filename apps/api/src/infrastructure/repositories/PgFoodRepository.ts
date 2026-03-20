import { eq, sql, and, not, inArray } from 'drizzle-orm';
import { db } from '../database/db';
import { foods, foodEmbeddings } from '../database/schema';
import {
  IFoodRepository,
  FoodSearchOptions,
  UpsertFoodResult,
  Food,
} from '@nutriplan/domain';

export class PgFoodRepository implements IFoodRepository {

  // ─── Busca vetorial via pgvector ──────────────────────────────────────────

  async searchBySimilarity(opts: FoodSearchOptions): Promise<Food[]> {
    const topK          = opts.topK          ?? 20;
    const excludeTags   = opts.excludeTags   ?? [];
    const excludeNames  = opts.excludeNames  ?? [];

    const vectorLiteral = `[${opts.queryEmbedding.join(',')}]`;

    // SQL raw é necessário para operadores pgvector (<=>)
    const rows = await db.execute<{
      id: string; external_id: string | null; name_pt: string; name_en: string | null;
      category: string; subcategory: string | null; tags: string[];
      kcal_per100g: string; protein_g: string; carbs_g: string; fat_g: string;
      fiber_g: string | null; sodium_mg: string | null; calcium_mg: string | null;
      iron_mg: string | null; zinc_mg: string | null; vit_c_mg: string | null;
      vit_b12_mcg: string | null; primary_source: string; similarity: string;
    }>(sql`
      SELECT
        f.id, f.external_id, f.name_pt, f.name_en, f.category, f.subcategory, f.tags,
        f.kcal_per100g, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
        f.sodium_mg, f.calcium_mg, f.iron_mg, f.zinc_mg, f.vit_c_mg, f.vit_b12_mcg,
        f.primary_source,
        1 - (fe.embedding <=> ${sql.raw(`'${vectorLiteral}'::vector`)}::vector) AS similarity
      FROM foods f
      JOIN food_embeddings fe ON fe.food_id = f.id
      ${excludeTags.length   ? sql`WHERE NOT (f.tags && ${excludeTags}::text[])` : sql``}
      ${excludeNames.length  ? sql`AND f.name_pt NOT IN (${sql.join(excludeNames.map(n => sql`${n}`), sql`, `)})` : sql``}
      ORDER BY fe.embedding <=> ${sql.raw(`'${vectorLiteral}'::vector`)}::vector
      LIMIT ${topK}
    `);

    return rows.rows.map(r => this.toDomain(r as unknown as typeof foods.$inferSelect & { similarity?: string }));
  }

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Food | null> {
    const rows = await db.select().from(foods).where(eq(foods.id, id)).limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findByName(name: string): Promise<Food[]> {
    const rows = await db.select().from(foods)
      .where(sql`lower(${foods.namePt}) like lower(${'%' + name + '%'})`);
    return rows.map(r => this.toDomain(r));
  }

  async findAll(opts?: { limit?: number; offset?: number }): Promise<Food[]> {
    const rows = await db.select().from(foods)
      .limit(opts?.limit   ?? 1000)
      .offset(opts?.offset ?? 0);
    return rows.map(r => this.toDomain(r));
  }

  async countAll(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(foods);
    return Number(result[0]?.count ?? 0);
  }

  async findWithoutEmbeddings(limit = 500): Promise<Food[]> {
    const withEmbedding = db.select({ foodId: foodEmbeddings.foodId }).from(foodEmbeddings);
    const rows = await db.select().from(foods)
      .where(not(inArray(foods.id, withEmbedding)))
      .limit(limit);
    return rows.map(r => this.toDomain(r));
  }

  // ─── Escrita ──────────────────────────────────────────────────────────────

  async upsert(food: Food): Promise<UpsertFoodResult> {
    // Tenta encontrar por (primarySource, externalId) para deduplicação
    if (food.externalId) {
      const existing = await db.select({ id: foods.id })
        .from(foods)
        .where(and(
          eq(foods.primarySource, food.primarySource),
          eq(foods.externalId,    food.externalId),
        ))
        .limit(1);

      if (existing[0]) {
        const updated = await db.update(foods)
          .set(this.toRow(food))
          .where(eq(foods.id, existing[0].id))
          .returning();
        return { food: this.toDomain(updated[0]!), created: false };
      }
    }

    const inserted = await db.insert(foods).values(this.toRow(food)).returning();
    return { food: this.toDomain(inserted[0]!), created: true };
  }

  async saveEmbedding(foodId: string, embedding: number[]): Promise<void> {
    await db.insert(foodEmbeddings)
      .values({ foodId, embedding })
      .onConflictDoUpdate({
        target: foodEmbeddings.foodId,
        set:    { embedding },
      });
  }

  // ─── Mapeamento ───────────────────────────────────────────────────────────

  private toDomain(row: typeof foods.$inferSelect & { similarity?: string }): Food {
    return {
      id:             row.id,
      externalId:     row.externalId ?? undefined,
      namePt:         row.namePt,
      nameEn:         row.nameEn    ?? undefined,
      category:       row.category,
      subcategory:    row.subcategory ?? undefined,
      tags:           row.tags ?? [],
      primarySource:  row.primarySource,
      similarityScore: row.similarity != null ? parseFloat(row.similarity) : undefined,
      nutrients: {
        kcalPer100g: parseFloat(row.kcalPer100g),
        proteinG:    parseFloat(row.proteinG),
        carbsG:      parseFloat(row.carbsG),
        fatG:        parseFloat(row.fatG),
        fiberG:      row.fiberG    != null ? parseFloat(row.fiberG)    : undefined,
        sodiumMg:    row.sodiumMg  != null ? parseFloat(row.sodiumMg)  : undefined,
        calciumMg:   row.calciumMg != null ? parseFloat(row.calciumMg) : undefined,
        ironMg:      row.ironMg    != null ? parseFloat(row.ironMg)    : undefined,
        zincMg:      row.zincMg    != null ? parseFloat(row.zincMg)    : undefined,
        vitCMg:      row.vitCMg    != null ? parseFloat(row.vitCMg)    : undefined,
        vitB12Mcg:   row.vitB12Mcg != null ? parseFloat(row.vitB12Mcg) : undefined,
      },
    };
  }

  private toRow(food: Food): typeof foods.$inferInsert {
    return {
      id:            food.id,
      externalId:    food.externalId,
      namePt:        food.namePt,
      nameEn:        food.nameEn,
      category:      food.category,
      subcategory:   food.subcategory,
      tags:          food.tags,
      primarySource: food.primarySource,
      kcalPer100g:   String(food.nutrients.kcalPer100g),
      proteinG:      String(food.nutrients.proteinG),
      carbsG:        String(food.nutrients.carbsG),
      fatG:          String(food.nutrients.fatG),
      fiberG:        food.nutrients.fiberG    != null ? String(food.nutrients.fiberG)    : null,
      sodiumMg:      food.nutrients.sodiumMg  != null ? String(food.nutrients.sodiumMg)  : null,
      calciumMg:     food.nutrients.calciumMg != null ? String(food.nutrients.calciumMg) : null,
      ironMg:        food.nutrients.ironMg    != null ? String(food.nutrients.ironMg)    : null,
      zincMg:        food.nutrients.zincMg    != null ? String(food.nutrients.zincMg)    : null,
      vitCMg:        food.nutrients.vitCMg    != null ? String(food.nutrients.vitCMg)    : null,
      vitB12Mcg:     food.nutrients.vitB12Mcg != null ? String(food.nutrients.vitB12Mcg) : null,
    };
  }
}
