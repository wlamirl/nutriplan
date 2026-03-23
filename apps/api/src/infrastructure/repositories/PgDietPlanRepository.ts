import { eq, inArray } from 'drizzle-orm';
import { db } from '../database/db';
import { dietPlans, dietMeals, dietMealItems, foods } from '../database/schema';
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
      .where(eq(dietMeals.dietPlanId, id));

    const mealIds = mealRows.map(m => m.id);

    const itemRows = mealIds.length > 0
      ? await db
          .select({ item: dietMealItems, food: foods })
          .from(dietMealItems)
          .innerJoin(foods, eq(dietMealItems.foodId, foods.id))
          .where(inArray(dietMealItems.dietMealId, mealIds))
      : [];

    // Group items by mealId for O(n) reconstruction
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
      totalProteinG:    parseFloat(meal.totalProteinG),
      totalCarbsG:      parseFloat(meal.totalCarbsG),
      totalFatG:        parseFloat(meal.totalFatG),
      items: (itemsByMealId.get(meal.id) ?? []).map(({ item, food }) =>
        this.toFoodWithQuantity(food, item)
      ),
    }));

    return this.toDomain(plan, meals);
  }

  async findByPatientId(patientId: string): Promise<DietPlan[]> {
    const rows = await db
      .select()
      .from(dietPlans)
      .where(eq(dietPlans.patientId, patientId));

    // Return summary without nested meals for list performance
    return rows.map(r => this.toDomain(r, []));
  }

  // ─── Escrita ──────────────────────────────────────────────────────────────

  async save(plan: DietPlan): Promise<DietPlan> {
    return await db.transaction(async (tx) => {
      const insertValues: typeof dietPlans.$inferInsert = {
        patientId:          plan.patientId,
        consultationId:     plan.consultationId ?? null,
        startDate:          plan.startDate,
        endDate:            plan.endDate,
        objectives:         plan.objectives,
        targetKcal:         plan.macroTargets.kcal,
        targetProteinG:     plan.macroTargets.proteinG,
        targetCarbsG:       plan.macroTargets.carbsG,
        targetFatG:         plan.macroTargets.fatG,
        targetProteinPct:   plan.macroTargets.proteinPct,
        targetCarbsPct:     plan.macroTargets.carbsPct,
        targetFatPct:       plan.macroTargets.fatPct,
        totalDailyKcal:     plan.totalDailyKcal,
        totalDailyProteinG: String(plan.totalDailyProteinG),
        totalDailyCarbsG:   String(plan.totalDailyCarbsG),
        totalDailyFatG:     String(plan.totalDailyFatG),
        aiModel:            plan.aiGenerationMeta?.model            ?? null,
        aiPromptTokens:     plan.aiGenerationMeta?.promptTokens     ?? null,
        aiCompletionTokens: plan.aiGenerationMeta?.completionTokens ?? null,
        aiFoodSources:      plan.aiGenerationMeta?.foodSourcesUsed  ?? null,
        aiGeneratedAt:      plan.aiGenerationMeta?.generatedAt      ?? null,
      };
      if (plan.id) insertValues.id = plan.id;

      const [savedPlan] = await tx
        .insert(dietPlans)
        .values(insertValues)
        .returning();

      const savedMeals: DietMeal[] = [];

      for (const meal of plan.meals) {
        const [savedMeal] = await tx
          .insert(dietMeals)
          .values({
            dietPlanId:       savedPlan!.id,
            mealType:         meal.mealType,
            scheduledTime:    meal.scheduledTime    ?? null,
            totalKcal:        meal.totalKcal,
            totalProteinG:    String(meal.totalProteinG),
            totalCarbsG:      String(meal.totalCarbsG),
            totalFatG:        String(meal.totalFatG),
            nutritionistNote: meal.nutritionistNote ?? null,
          })
          .returning();

        for (const item of meal.items) {
          await tx.insert(dietMealItems).values({
            dietMealId: savedMeal!.id,
            foodId:     item.id,
            quantityG:  String(item.quantityG),
            kcal:       item.kcal,
            proteinG:   String(item.proteinG),
            carbsG:     String(item.carbsG),
            fatG:       String(item.fatG),
          });
        }

        savedMeals.push(meal);
      }

      return this.toDomain(savedPlan!, savedMeals);
    });
  }

  async update(id: string, data: Partial<DietPlan>): Promise<DietPlan> {
    const setValues: Partial<typeof dietPlans.$inferInsert> = {};

    if (data.objectives         !== undefined) setValues.objectives         = data.objectives;
    if (data.startDate          !== undefined) setValues.startDate          = data.startDate;
    if (data.endDate            !== undefined) setValues.endDate            = data.endDate;
    if (data.totalDailyKcal     !== undefined) setValues.totalDailyKcal     = data.totalDailyKcal;
    if (data.totalDailyProteinG !== undefined) setValues.totalDailyProteinG = String(data.totalDailyProteinG);
    if (data.totalDailyCarbsG   !== undefined) setValues.totalDailyCarbsG   = String(data.totalDailyCarbsG);
    if (data.totalDailyFatG     !== undefined) setValues.totalDailyFatG     = String(data.totalDailyFatG);

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
    return {
      id:             row.id,
      patientId:      row.patientId,
      consultationId: row.consultationId ?? undefined,
      startDate:      row.startDate,
      endDate:        row.endDate,
      objectives:     row.objectives,
      macroTargets: {
        kcal:       row.targetKcal,
        proteinG:   row.targetProteinG,
        carbsG:     row.targetCarbsG,
        fatG:       row.targetFatG,
        proteinPct: row.targetProteinPct,
        carbsPct:   row.targetCarbsPct,
        fatPct:     row.targetFatPct,
      },
      meals,
      totalDailyKcal:     row.totalDailyKcal,
      totalDailyProteinG: parseFloat(row.totalDailyProteinG),
      totalDailyCarbsG:   parseFloat(row.totalDailyCarbsG),
      totalDailyFatG:     parseFloat(row.totalDailyFatG),
      aiGenerationMeta: row.aiModel
        ? {
            model:            row.aiModel,
            promptTokens:     row.aiPromptTokens     ?? 0,
            completionTokens: row.aiCompletionTokens ?? 0,
            foodSourcesUsed:  row.aiFoodSources       ?? [],
            generatedAt:      row.aiGeneratedAt        ?? new Date(),
          }
        : undefined,
    };
  }

  private toFoodWithQuantity(
    food: typeof foods.$inferSelect,
    item: typeof dietMealItems.$inferSelect,
  ): FoodWithQuantity {
    return {
      id:           food.id,
      externalId:   food.externalId ?? undefined,
      namePt:       food.namePt,
      nameEn:       food.nameEn    ?? undefined,
      category:     food.category,
      subcategory:  food.subcategory ?? undefined,
      tags:         food.tags ?? [],
      primarySource: food.primarySource,
      nutrients: {
        kcalPer100g: parseFloat(food.kcalPer100g),
        proteinG:    parseFloat(food.proteinG),
        carbsG:      parseFloat(food.carbsG),
        fatG:        parseFloat(food.fatG),
        fiberG:      food.fiberG    != null ? parseFloat(food.fiberG)    : undefined,
        sodiumMg:    food.sodiumMg  != null ? parseFloat(food.sodiumMg)  : undefined,
        calciumMg:   food.calciumMg != null ? parseFloat(food.calciumMg) : undefined,
        ironMg:      food.ironMg    != null ? parseFloat(food.ironMg)    : undefined,
        zincMg:      food.zincMg    != null ? parseFloat(food.zincMg)    : undefined,
        vitCMg:      food.vitCMg    != null ? parseFloat(food.vitCMg)    : undefined,
        vitB12Mcg:   food.vitB12Mcg != null ? parseFloat(food.vitB12Mcg) : undefined,
      },
      quantityG: parseFloat(item.quantityG),
      kcal:      item.kcal,
      proteinG:  parseFloat(item.proteinG),
      carbsG:    parseFloat(item.carbsG),
      fatG:      parseFloat(item.fatG),
    };
  }
}
