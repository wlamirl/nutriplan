import { eq, inArray, and } from 'drizzle-orm';
import { db } from '../database/db';
import { dietPlans, dietMeals, dietMealItems, foods, foodSources } from '../database/schema';
import {
  IDietPlanRepository,
  DietPlan,
  DietMeal,
  FoodWithQuantity,
} from '@nutriplan/domain';

export class PgDietPlanRepository implements IDietPlanRepository {

  // ─── Leitura ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<DietPlan | null> {
    const [plan] = await db
      .select()
      .from(dietPlans)
      .where(eq(dietPlans.id, id))
      .limit(1);

    if (!plan) return null;

    const mealRows = await db
      .select()
      .from(dietMeals)
      .where(eq(dietMeals.dietPlanId, id))
      .orderBy(dietMeals.orderIndex);

    const mealIds = mealRows.map(m => m.id);

    const itemRows = mealIds.length > 0
      ? await db
          .select({ item: dietMealItems, food: foods, source: foodSources })
          .from(dietMealItems)
          .innerJoin(foods, eq(dietMealItems.foodId, foods.id))
          .leftJoin(
            foodSources,
            and(
              eq(foodSources.foodId, foods.id),
              eq(foodSources.source, foods.primarySource),
            ),
          )
          .where(inArray(dietMealItems.dietMealId, mealIds))
      : [];

    const itemsByMealId = new Map<string, typeof itemRows>();
    for (const row of itemRows) {
      const list = itemsByMealId.get(row.item.dietMealId) ?? [];
      list.push(row);
      itemsByMealId.set(row.item.dietMealId, list);
    }

    const meals: DietMeal[] = mealRows.map(meal => ({
      mealType:         meal.mealType,
      scheduledTime:    meal.scheduledTime    ?? undefined,
      nutritionistNote: meal.nutritionistNote ?? undefined,
      totalKcal:        meal.totalKcal,
      totalProteinG:    meal.totalProteinG,
      totalCarbsG:      meal.totalCarbsG,
      totalFatG:        meal.totalFatG,
      items: (itemsByMealId.get(meal.id) ?? []).map(({ item, food, source }) =>
        this.toFoodWithQuantity(food, item, source)
      ),
    }));

    return this.toDomain(plan, meals);
  }

  async findByPatientId(patientId: string): Promise<DietPlan[]> {
    const rows = await db
      .select()
      .from(dietPlans)
      .where(eq(dietPlans.patientId, patientId));

    return rows.map(r => this.toDomain(r, []));
  }

  // ─── Escrita ──────────────────────────────────────────────────────────────

  async save(plan: DietPlan): Promise<DietPlan> {
    return await db.transaction(async (tx) => {
      const insertValues: typeof dietPlans.$inferInsert = {
        patientId:        plan.patientId,
        consultationId:   plan.consultationId ?? null,
        objectiveType:    'general',
        startDate:        plan.startDate.toISOString().split('T')[0]!,
        endDate:          plan.endDate.toISOString().split('T')[0]!,
        objectives:       plan.objectives,
        dailyKcalTarget:  plan.macroTargets.kcal,
        proteinGTarget:   plan.macroTargets.proteinG,
        carbsGTarget:     plan.macroTargets.carbsG,
        fatGTarget:       plan.macroTargets.fatG,
        proteinPct:       plan.macroTargets.proteinPct,
        carbsPct:         plan.macroTargets.carbsPct,
        fatPct:           plan.macroTargets.fatPct,
        totalDailyKcal:   plan.totalDailyKcal,
        totalProteinG:    plan.totalDailyProteinG,
        totalCarbsG:      plan.totalDailyCarbsG,
        totalFatG:        plan.totalDailyFatG,
        isAiGenerated:    !!plan.aiGenerationMeta,
        aiGenerationMeta: plan.aiGenerationMeta
          ? {
              model:            plan.aiGenerationMeta.model,
              promptTokens:     plan.aiGenerationMeta.promptTokens,
              completionTokens: plan.aiGenerationMeta.completionTokens,
              foodSourcesUsed:  plan.aiGenerationMeta.foodSourcesUsed,
              generatedAt:      plan.aiGenerationMeta.generatedAt.toISOString(),
            }
          : null,
      };
      if (plan.id) insertValues.id = plan.id;

      const [savedPlan] = await tx
        .insert(dietPlans)
        .values(insertValues)
        .returning();

      const savedMeals: DietMeal[] = [];

      for (const [index, meal] of plan.meals.entries()) {
        const [savedMeal] = await tx
          .insert(dietMeals)
          .values({
            dietPlanId:       savedPlan!.id,
            mealType:         meal.mealType,
            orderIndex:       index,
            scheduledTime:    meal.scheduledTime    ?? null,
            totalKcal:        meal.totalKcal,
            totalProteinG:    meal.totalProteinG,
            totalCarbsG:      meal.totalCarbsG,
            totalFatG:        meal.totalFatG,
            nutritionistNote: meal.nutritionistNote ?? null,
          })
          .returning();

        for (const item of meal.items) {
          await tx.insert(dietMealItems).values({
            dietMealId: savedMeal!.id,
            foodId:     item.id,
            quantityG:  item.quantityG,
            kcal:       item.kcal,
            proteinG:   item.proteinG,
            carbsG:     item.carbsG,
            fatG:       item.fatG,
          });
        }

        savedMeals.push(meal);
      }

      return this.toDomain(savedPlan!, savedMeals);
    });
  }

  async update(id: string, data: Partial<DietPlan>): Promise<DietPlan> {
    const setValues: Partial<typeof dietPlans.$inferInsert> = {};

    if (data.objectives         !== undefined) setValues.objectives      = data.objectives;
    if (data.startDate          !== undefined) setValues.startDate       = data.startDate.toISOString().split('T')[0]!;
    if (data.endDate            !== undefined) setValues.endDate         = data.endDate.toISOString().split('T')[0]!;
    if (data.totalDailyKcal     !== undefined) setValues.totalDailyKcal  = data.totalDailyKcal;
    if (data.totalDailyProteinG !== undefined) setValues.totalProteinG   = data.totalDailyProteinG;
    if (data.totalDailyCarbsG   !== undefined) setValues.totalCarbsG     = data.totalDailyCarbsG;
    if (data.totalDailyFatG     !== undefined) setValues.totalFatG       = data.totalDailyFatG;

    if (Object.keys(setValues).length > 0) {
      await db.update(dietPlans).set(setValues).where(eq(dietPlans.id, id));
    }

    const result = await this.findById(id);
    if (!result) throw new Error(`DietPlan ${id} not found after update`);
    return result;
  }

  async delete(id: string): Promise<void> {
    await db.delete(dietPlans).where(eq(dietPlans.id, id));
  }

  // ─── Mapeamento ───────────────────────────────────────────────────────────

  private toDomain(
    row: typeof dietPlans.$inferSelect,
    meals: DietMeal[],
  ): DietPlan {
    const aiMeta = row.aiGenerationMeta;
    return {
      id:             row.id,
      patientId:      row.patientId,
      consultationId: row.consultationId ?? undefined,
      startDate:      new Date(row.startDate),
      endDate:        new Date(row.endDate),
      objectives:     row.objectives,
      macroTargets: {
        kcal:       row.dailyKcalTarget,
        proteinG:   row.proteinGTarget,
        carbsG:     row.carbsGTarget,
        fatG:       row.fatGTarget,
        proteinPct: row.proteinPct,
        carbsPct:   row.carbsPct,
        fatPct:     row.fatPct,
      },
      meals,
      totalDailyKcal:     row.totalDailyKcal     ?? 0,
      totalDailyProteinG: row.totalProteinG ?? 0,
      totalDailyCarbsG:   row.totalCarbsG   ?? 0,
      totalDailyFatG:     row.totalFatG     ?? 0,
      aiGenerationMeta: aiMeta
        ? {
            model:            aiMeta.model,
            promptTokens:     aiMeta.promptTokens,
            completionTokens: aiMeta.completionTokens,
            foodSourcesUsed:  aiMeta.foodSourcesUsed,
            generatedAt:      new Date(aiMeta.generatedAt),
          }
        : undefined,
    };
  }

  private toFoodWithQuantity(
    food: typeof foods.$inferSelect,
    item: typeof dietMealItems.$inferSelect,
    source: typeof foodSources.$inferSelect | null,
  ): FoodWithQuantity {
    return {
      id:            food.id,
      externalId:    source?.externalId ?? undefined,
      namePt:        food.namePt,
      nameEn:        food.nameEn    ?? undefined,
      category:      food.category,
      subcategory:   food.subcategory ?? undefined,
      tags:          [],
      primarySource: food.primarySource,
      nutrients: {
        kcalPer100g: source?.kcalPer100g ?? 0,
        proteinG:    source?.proteinG    ?? 0,
        carbsG:      source?.carbsG      ?? 0,
        fatG:        source?.fatG        ?? 0,
        fiberG:      source?.fiberG      ?? undefined,
        sodiumMg:    source?.extraNutrients?.sodiumMg   ?? undefined,
        calciumMg:   source?.extraNutrients?.calciumMg  ?? undefined,
        ironMg:      source?.extraNutrients?.ironMg     ?? undefined,
        zincMg:      source?.extraNutrients?.zincMg     ?? undefined,
        vitCMg:      source?.extraNutrients?.vitCMg     ?? undefined,
        vitB12Mcg:   source?.extraNutrients?.vitB12Mcg  ?? undefined,
      },
      quantityG: item.quantityG,
      kcal:      item.kcal,
      proteinG:  item.proteinG,
      carbsG:    item.carbsG,
      fatG:      item.fatG,
    };
  }
}

