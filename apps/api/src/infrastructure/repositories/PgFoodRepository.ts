/**
 * PgFoodRepository
 *
 * Implementação concreta de IFoodRepository usando PostgreSQL + pgvector.
 * O método searchBySimilarity é o coração do sistema RAG.
 */

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, and, notInArray, between, inArray, eq, SQL } from 'drizzle-orm';
import { IFoodRepository, FoodSearchOptions, UpsertFoodResult } from '@nutriplan/domain/src/repositories/interfaces';

import { Food, FoodNutrients } from '@nutriplan/domain/src/entities/Food';
import * as schema from '../database/schema';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'claude-3-haiku-20240307';

export class PgFoodRepository implements IFoodRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  // ─── searchBySimilarity ────────────────────────────────────────────────────
  //
  // Pipeline:
  //   1. Serializar o vetor de query para o formato pgvector '[...]'
  //   2. Aplicar filtros SQL (tags, nomes, kcal)
  //   3. Ordenar por distância de cosseno com o operador <=>
  //   4. Fazer LIMIT topK
  //   5. Mapear rows para entidades Food do domain

  async searchBySimilarity(options: FoodSearchOptions): Promise<Food[]> {
    const {
      queryEmbedding,
      topK = 30,
      excludeTags = [],
      excludeNames = [],
      kcalRange,
      categories,
    } = options;

    // Serializar vetor para formato pgvector
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    // Ajustar probes para balance recall/speed
    // Para geração de dietas: priorizamos recall (mais alimentos relevantes)
    await this.db.execute(sql`SET LOCAL ivfflat.probes = 10`);

    // Também configurar o modelo de embedding para a view foods_with_nutrients
    await this.db.execute(
      sql`SET LOCAL app.embedding_model = ${EMBEDDING_MODEL}`
    );

    // Construir filtros condicionais
    const filters: SQL[] = [];

    // Filtro de tags excluídas (alergias, intolerâncias)
    if (excludeTags.length > 0) {
      filters.push(sql`
        NOT EXISTS (
          SELECT 1 FROM food_tags ft
          WHERE ft.food_id = fwn.id
          AND ft.tag = ANY(${excludeTags})
        )
      `);
    }

    // Filtro de nomes excluídos (alergias específicas)
    if (excludeNames.length > 0) {
      filters.push(sql`
        unaccent(lower(fwn.name_pt)) NOT IN (
          SELECT unaccent(lower(n)) FROM unnest(${excludeNames}::text[]) AS n
        )
      `);
    }

    // Filtro de range calórico
    if (kcalRange?.min !== undefined) {
      filters.push(sql`fwn.kcal_per_100g >= ${kcalRange.min}`);
    }
    if (kcalRange?.max !== undefined) {
      filters.push(sql`fwn.kcal_per_100g <= ${kcalRange.max}`);
    }

    // Filtro de categorias
    if (categories && categories.length > 0) {
      filters.push(sql`fwn.category = ANY(${categories})`);
    }

    const whereClause = filters.length > 0
      ? sql`WHERE ${sql.join(filters, sql` AND `)}`
      : sql``;

    // Query principal com busca vetorial
    // A VIEW foods_with_nutrients já faz o JOIN com food_sources e food_embeddings
    const rows = await this.db.execute<FoodRow>(sql`
      SELECT
        fwn.*,
        -- Distância de cosseno (0 = idêntico, 2 = oposto)
        -- Convertemos para similarity score (1 - distância)
        1 - (fwn.embedding <=> ${vectorLiteral}::vector) AS similarity_score
      FROM foods_with_nutrients fwn
      ${whereClause}
      -- Ordenar por similaridade decrescente (mais similar primeiro)
      ORDER BY fwn.embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `);

    return rows.rows.map(this.mapRowToFood);
  }

  // ─── findById ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Food | null> {
    await this.db.execute(
      sql`SET LOCAL app.embedding_model = ${EMBEDDING_MODEL}`
    );

    const rows = await this.db.execute<FoodRow>(sql`
      SELECT *, NULL::float AS similarity_score
      FROM foods_with_nutrients
      WHERE id = ${id}
      LIMIT 1
    `);

    return rows.rows[0] ? this.mapRowToFood(rows.rows[0]) : null;
  }

  // ─── findByName ────────────────────────────────────────────────────────────
  // Busca textual usando trigrama (pg_trgm) para tolerância a erros de digitação

  async findByName(name: string): Promise<Food[]> {
    await this.db.execute(
      sql`SET LOCAL app.embedding_model = ${EMBEDDING_MODEL}`
    );

    const rows = await this.db.execute<FoodRow>(sql`
      SELECT
        fwn.*,
        NULL::float AS similarity_score,
        similarity(unaccent(fwn.name_pt), unaccent(${name})) AS text_similarity
      FROM foods_with_nutrients fwn
      WHERE unaccent(fwn.name_pt) % unaccent(${name})   -- threshold padrão 0.3
         OR to_tsvector('portuguese', fwn.name_pt) @@ plainto_tsquery('portuguese', ${name})
      ORDER BY text_similarity DESC NULLS LAST
      LIMIT 20
    `);

    return rows.rows.map(this.mapRowToFood);
  }

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(options?: { limit?: number; offset?: number }): Promise<Food[]> {
    const rows = await this.db.execute<FoodRow>(sql`
      SELECT *, NULL::float AS similarity_score
      FROM foods_with_nutrients
      ORDER BY name_pt
      LIMIT ${options?.limit ?? 100}
      OFFSET ${options?.offset ?? 0}
    `);

    return rows.rows.map(this.mapRowToFood);
  }

  // ─── findWithoutEmbeddings ─────────────────────────────────────────────────

  async findWithoutEmbeddings(limit = 100): Promise<Food[]> {
    const rows = await this.db.execute<FoodRow>(sql`
      SELECT fwn.*, NULL::float AS similarity_score
      FROM foods_with_nutrients fwn
      WHERE NOT EXISTS (
        SELECT 1 FROM food_embeddings fe
        WHERE fe.food_id = fwn.id
          AND fe.model_version = ${EMBEDDING_MODEL}
      )
      ORDER BY fwn.name_pt
      LIMIT ${limit}
    `);

    return rows.rows.map(this.mapRowToFood);
  }

  // ─── saveEmbedding ─────────────────────────────────────────────────────────

  async saveEmbedding(foodId: string, embedding: number[]): Promise<void> {
    const food = await this.db
      .select({ embeddingText: schema.foods.embeddingText })
      .from(schema.foods)
      .where(eq(schema.foods.id, foodId))
      .limit(1);

    const sourceText = food[0]?.embeddingText ?? '';

    await this.db
      .insert(schema.foodEmbeddings)
      .values({
        foodId,
        embedding,
        modelVersion: EMBEDDING_MODEL,
        sourceText,
      })
      .onConflictDoUpdate({
        target: [schema.foodEmbeddings.foodId, schema.foodEmbeddings.modelVersion],
        set: {
          embedding,
          generatedAt: new Date(),
        },
      });
  }

  // ─── countAll ─────────────────────────────────────────────────────────────

  async countAll(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.foods)
      .where(eq(schema.foods.isActive, true));

    return result[0]?.count ?? 0;
  }

  // ─── upsert ────────────────────────────────────────────────────────────────

  async upsert(food: Food): Promise<UpsertFoodResult> {
    const result = await this.db
      .insert(schema.foods)
      .values({
        id:            food.id,
        namePt:        food.namePt,
        nameEn:        food.nameEn,
        category:      food.category,
        subcategory:   food.subcategory,
        primarySource: food.primarySource,
        isActive:      true,
        updatedAt:     new Date(),
      })
      .onConflictDoUpdate({
        target: schema.foods.id,
        set: {
          namePt:        food.namePt,
          nameEn:        food.nameEn,
          category:      food.category,
          subcategory:   food.subcategory,
          primarySource: food.primarySource,
          updatedAt:     new Date(),
        },
      })
      .returning({ wasInserted: sql<boolean>`(xmax = 0)` });

    const created = result[0]?.wasInserted ?? false;

    // Upsert na fonte primária
    await this.db
      .insert(schema.foodSources)
      .values({
        foodId:       food.id,
        source:       food.primarySource,
        kcalPer100g:  food.nutrients.kcalPer100g,
        proteinG:     food.nutrients.proteinG,
        carbsG:       food.nutrients.carbsG,
        fatG:         food.nutrients.fatG,
        fiberG:       food.nutrients.fiberG,
        extraNutrients: {
          sodiumMg:   food.nutrients.sodiumMg,
          calciumMg:  food.nutrients.calciumMg,
          ironMg:     food.nutrients.ironMg,
          zincMg:     food.nutrients.zincMg,
          vitCMg:     food.nutrients.vitCMg,
          vitB12Mcg:  food.nutrients.vitB12Mcg,
        },
      })
      .onConflictDoUpdate({
        target: [schema.foodSources.foodId, schema.foodSources.source],
        set: {
          kcalPer100g: food.nutrients.kcalPer100g,
          proteinG:    food.nutrients.proteinG,
          carbsG:      food.nutrients.carbsG,
          fatG:        food.nutrients.fatG,
          fiberG:      food.nutrients.fiberG,
          syncedAt:    new Date(),
          updatedAt:   new Date(),
        },
      });

    return { food, created };
  }

  // ─── Mapper ────────────────────────────────────────────────────────────────

  private mapRowToFood(row: FoodRow): Food {
    const nutrients: FoodNutrients = {
      kcalPer100g: row.kcal_per_100g,
      proteinG:    row.protein_g,
      carbsG:      row.carbs_g,
      fatG:        row.fat_g,
      fiberG:      row.fiber_g ?? undefined,
      sodiumMg:    row.extra_nutrients?.sodiumMg,
      calciumMg:   row.extra_nutrients?.calciumMg,
      ironMg:      row.extra_nutrients?.ironMg,
      zincMg:      row.extra_nutrients?.zincMg,
      vitCMg:      row.extra_nutrients?.vitCMg,
      vitB12Mcg:   row.extra_nutrients?.vitB12Mcg,
    };

    return {
      id:              row.id,
      namePt:          row.name_pt,
      nameEn:          row.name_en ?? undefined,
      category:        row.category,
      subcategory:     row.subcategory ?? undefined,
      tags:            row.tags ?? [],
      nutrients,
      primarySource:   row.primary_source as Food['primarySource'],
      similarityScore: row.similarity_score ?? undefined,
    };
  }
}

// ─── Tipo do row retornado pela view ─────────────────────────────────────────

interface FoodRow {
  [key: string]: unknown;
  id:              string;
  name_pt:         string;
  name_en:         string | null;
  category:        string;
  subcategory:     string | null;
  primary_source:  string;
  is_active:       boolean;
  kcal_per_100g:   number;
  protein_g:       number;
  carbs_g:         number;
  fat_g:           number;
  fiber_g:         number | null;
  extra_nutrients: Record<string, number> | null;
  data_quality:    string | null;
  nutrient_source: string;
  embedding:       number[] | null;
  embedding_model: string | null;
  tags:            string[] | null;
  similarity_score: number | null;
}
