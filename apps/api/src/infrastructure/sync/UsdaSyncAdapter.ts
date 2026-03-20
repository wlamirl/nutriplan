import { createHash } from 'crypto';
import { Food, FoodSource } from '@nutriplan/domain';
import { IFoodSyncAdapter } from '@nutriplan/domain';

const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const PAGE_SIZE     = 200;

// Nutrient IDs relevantes da USDA FoodData Central
const NUTRIENT_IDS = {
  energy:    1008,
  protein:   1003,
  fat:       1004,
  carbs:     1005,
  fiber:     1079,
  sodium:    1093,
  calcium:   1087,
  iron:      1089,
  zinc:      1095,
  vitaminC:  1162,
  vitaminB12:1178,
} as const;

// ─── USDA API response shapes ─────────────────────────────────────────────────

interface UsdaNutrient {
  nutrientId:   number;
  nutrientName: string;
  value:        number;
  unitName:     string;
}

interface UsdaFood {
  fdcId:        number;
  description:  string;
  foodCategory?: string | { description: string };
  foodNutrients: UsdaNutrient[];
}

interface UsdaSearchResponse {
  foods:       UsdaFood[];
  totalHits:   number;
  currentPage: number;
  totalPages:  number;
}

// Termos de busca para alimentos comuns no contexto brasileiro
const SEARCH_QUERIES = [
  'rice', 'beans', 'chicken', 'beef', 'fish', 'egg',
  'bread', 'pasta', 'potato', 'sweet potato', 'cassava',
  'banana', 'orange', 'apple', 'mango', 'papaya', 'guava',
  'milk', 'cheese', 'yogurt', 'butter',
  'lettuce', 'tomato', 'onion', 'garlic', 'carrot',
  'oats', 'corn', 'soy', 'lentil', 'pea',
];

/**
 * UsdaSyncAdapter
 *
 * Consome a API REST da USDA FoodData Central (chave gratuita em fdc.nal.usda.gov)
 * e normaliza cada alimento para o schema Food do domain.
 *
 * Variável de ambiente necessária: USDA_API_KEY
 */
export class UsdaSyncAdapter implements IFoodSyncAdapter {
  readonly source: FoodSource = 'USDA';

  constructor(private readonly apiKey: string) {}

  async *syncAll(): AsyncGenerator<Food, void, unknown> {
    const seen = new Set<number>();

    for (const query of SEARCH_QUERIES) {
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const data = await this.searchPage(query, page);
        totalPages = data.totalPages;

        for (const item of data.foods) {
          if (seen.has(item.fdcId)) continue;
          seen.add(item.fdcId);
          const food = this.normalize(item);
          if (food) yield food;
        }

        page++;
        // Respeitar rate limit da API pública (1 req/s)
        await sleep(1000);
      }
    }
  }

  private async searchPage(query: string, page: number): Promise<UsdaSearchResponse> {
    const url = new URL(`${USDA_BASE_URL}/foods/search`);
    url.searchParams.set('query',    query);
    url.searchParams.set('api_key',  this.apiKey);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('pageNumber', String(page));
    url.searchParams.set('dataType', 'Foundation,SR Legacy');

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`USDA API error ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<UsdaSearchResponse>;
  }

  private normalize(item: UsdaFood): Food | null {
    const n = indexNutrients(item.foodNutrients);

    const kcal    = n[NUTRIENT_IDS.energy];
    const protein = n[NUTRIENT_IDS.protein];
    const fat     = n[NUTRIENT_IDS.fat];
    const carbs   = n[NUTRIENT_IDS.carbs];

    if (kcal == null || protein == null || fat == null || carbs == null) {
      return null;
    }

    const category = typeof item.foodCategory === 'string'
      ? item.foodCategory
      : (item.foodCategory?.description ?? 'Outros');

    return {
      id:          deterministicUuid('USDA', String(item.fdcId)),
      externalId:  String(item.fdcId),
      namePt:      item.description.trim(),
      nameEn:      item.description.trim(),
      category:    category.trim(),
      tags:        inferTags(category, item.description),
      nutrients: {
        kcalPer100g: round(kcal),
        proteinG:    round(protein),
        carbsG:      round(carbs),
        fatG:        round(fat),
        fiberG:      n[NUTRIENT_IDS.fiber]     != null ? round(n[NUTRIENT_IDS.fiber]!)     : undefined,
        sodiumMg:    n[NUTRIENT_IDS.sodium]    != null ? round(n[NUTRIENT_IDS.sodium]!)    : undefined,
        calciumMg:   n[NUTRIENT_IDS.calcium]   != null ? round(n[NUTRIENT_IDS.calcium]!)   : undefined,
        ironMg:      n[NUTRIENT_IDS.iron]      != null ? round(n[NUTRIENT_IDS.iron]!)      : undefined,
        zincMg:      n[NUTRIENT_IDS.zinc]      != null ? round(n[NUTRIENT_IDS.zinc]!)      : undefined,
        vitCMg:      n[NUTRIENT_IDS.vitaminC]  != null ? round(n[NUTRIENT_IDS.vitaminC]!)  : undefined,
        vitB12Mcg:   n[NUTRIENT_IDS.vitaminB12]!= null ? round(n[NUTRIENT_IDS.vitaminB12]!): undefined,
      },
      primarySource: 'USDA',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function indexNutrients(list: UsdaNutrient[]): Partial<Record<number, number>> {
  const map: Partial<Record<number, number>> = {};
  for (const n of list) {
    map[n.nutrientId] = n.value;
  }
  return map;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function deterministicUuid(source: string, externalId: string): string {
  const hash = createHash('sha256').update(`${source}:${externalId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    (parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

function inferTags(category: string, description: string): string[] {
  const tags: string[] = [];
  const lower = `${category} ${description}`.toLowerCase();
  if (lower.includes('dairy') || lower.includes('milk') || lower.includes('cheese')) {
    tags.push('laticinio', 'lactose');
  }
  if (lower.includes('beef') || lower.includes('pork') || lower.includes('chicken') || lower.includes('fish')) {
    tags.push('proteina-animal');
  }
  if (lower.includes('fruit')) tags.push('fruta');
  if (lower.includes('vegetable') || lower.includes('legume')) tags.push('vegetal');
  if (lower.includes('grain') || lower.includes('cereal') || lower.includes('rice') || lower.includes('wheat')) {
    tags.push('cereal');
  }
  if (lower.includes('bean') || lower.includes('lentil') || lower.includes('soy') || lower.includes('pea')) {
    tags.push('leguminosa');
  }
  if (lower.includes('nut') || lower.includes('seed') || lower.includes('almond') || lower.includes('walnut')) {
    tags.push('oleaginosa');
  }
  return [...new Set(tags)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
