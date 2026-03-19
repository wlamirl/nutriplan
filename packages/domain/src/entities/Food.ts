export type FoodSource = 'TBCA' | 'USDA' | 'OFF';

export interface FoodNutrients {
  kcalPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  zincMg?: number;
  vitCMg?: number;
  vitB12Mcg?: number;
}

export interface Food {
  id: string;
  namePt: string;
  nameEn?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  nutrients: FoodNutrients;
  primarySource: FoodSource;
  // Similarity score from pgvector — populated after RAG retrieval
  similarityScore?: number;
}

export interface FoodWithQuantity extends Food {
  quantityG: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function scaleNutrients(food: Food, quantityG: number): FoodWithQuantity {
  const ratio = quantityG / 100;
  return {
    ...food,
    quantityG,
    kcal:      Math.round(food.nutrients.kcalPer100g * ratio),
    proteinG:  Math.round(food.nutrients.proteinG    * ratio * 10) / 10,
    carbsG:    Math.round(food.nutrients.carbsG      * ratio * 10) / 10,
    fatG:      Math.round(food.nutrients.fatG        * ratio * 10) / 10,
  };
}
