import { FoodWithQuantity } from './Food';

export type MealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'supper';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast:       'Café da manhã',
  morning_snack:   'Lanche da manhã',
  lunch:           'Almoço',
  afternoon_snack: 'Lanche da tarde',
  dinner:          'Jantar',
  supper:          'Ceia',
};

export interface MacroTargets {
  kcal: number;
  proteinG: number;    // grams
  carbsG: number;
  fatG: number;
  proteinPct: number;  // 0-100
  carbsPct: number;
  fatPct: number;
}

export interface DietMeal {
  mealType: MealType;
  scheduledTime?: string;   // e.g. "07:30"
  items: FoodWithQuantity[];
  totalKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  nutritionistNote?: string;
}

export interface DietPlan {
  id?: string;
  patientId: string;
  consultationId?: string;
  startDate: Date;
  endDate: Date;
  objectives: string;
  macroTargets: MacroTargets;
  meals: DietMeal[];
  totalDailyKcal: number;
  totalDailyProteinG: number;
  totalDailyCarbsG: number;
  totalDailyFatG: number;
  aiGenerationMeta?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    foodSourcesUsed: string[];
    generatedAt: Date;
  };
}

export function calculateMealTotals(items: FoodWithQuantity[]): Pick<DietMeal, 'totalKcal' | 'totalProteinG' | 'totalCarbsG' | 'totalFatG'> {
  return items.reduce(
    (acc, item) => ({
      totalKcal:     acc.totalKcal     + item.kcal,
      totalProteinG: acc.totalProteinG + item.proteinG,
      totalCarbsG:   acc.totalCarbsG   + item.carbsG,
      totalFatG:     acc.totalFatG     + item.fatG,
    }),
    { totalKcal: 0, totalProteinG: 0, totalCarbsG: 0, totalFatG: 0 }
  );
}
