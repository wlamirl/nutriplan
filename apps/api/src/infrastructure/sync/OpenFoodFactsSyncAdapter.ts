import { createHash } from 'crypto';
import { Food, FoodSource } from '@nutriplan/domain';
import { IFoodSyncAdapter } from '@nutriplan/domain';

const OFF_BASE_URL = 'https://world.openfoodfacts.org/api/v2';
const PAGE_SIZE    = 200;

// ─── OFF API response shapes ──────────────────────────────────────────────────

interface OffNutriments {
  'energy-kcal_100g'?:  number;
  proteins_100g?:       number;
  fat_100g?:            number;
  carbohydrates_100g?:  number;
  fiber_100g?:          number;
  sodium_100g?:         number;
  calcium_100g?:        number;
  iron_100g?:           number;
  zinc_100g?:           number;
  'vitamin-c_100g'?:    number;
  'vitamin-b12_100g'?:  number;
  [key: string]: number | undefined;
}

interface OffProduct {
  _id:            string;
  product_name?:  string;
  product_name_pt?: string;
  categories?:    string;
  labels_tags?:   string[];
  nutriments?:    OffNutriments;
}

interface OffSearchResponse {
  products: OffProduct[];
  count:    number;
  page:     number;
  page_count: number;
}

// Categorias relevantes para o contexto nutricional brasileiro
const CATEGORIES_TO_SYNC = [
  'en:cereals-and-their-products',
  'en:fruits',
  'en:vegetables',
  'en:dairy-products',
  'en:meats',
  'en:fish-and-seafood',
  'en:legumes',
  'en:breads-and-buns',
  'en:beverages',
  'en:snacks',
];

/**
 * OpenFoodFactsSyncAdapter
 *
 * Consome a API REST do Open Food Facts (sem autenticação).
 * Filtra produtos disponíveis no Brasil e normaliza para o schema Food.
 *
 * Documentação: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
export class OpenFoodFactsSyncAdapter implements IFoodSyncAdapter {
  readonly source: FoodSource = 'OFF';

  async *syncAll(): AsyncGenerator<Food, void, unknown> {
    const seen = new Set<string>();

    for (const category of CATEGORIES_TO_SYNC) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const data = await this.fetchPage(category, page);

        for (const product of data.products) {
          if (!product._id || seen.has(product._id)) continue;
          seen.add(product._id);
          const food = this.normalize(product);
          if (food) yield food;
        }

        hasMore = data.products.length === PAGE_SIZE;
        page++;
        await sleep(500);
      }
    }
  }

  private async fetchPage(category: string, page: number): Promise<OffSearchResponse> {
    const url = new URL(`${OFF_BASE_URL}/search`);
    url.searchParams.set('categories_tags', category);
    url.searchParams.set('countries_tags',  'en:brazil');
    url.searchParams.set('fields', [
      'id', '_id', 'product_name', 'product_name_pt',
      'categories', 'labels_tags', 'nutriments',
    ].join(','));
    url.searchParams.set('page_size', String(PAGE_SIZE));
    url.searchParams.set('page',      String(page));
    url.searchParams.set('json',      '1');

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'NutriPlan/1.0 (nutriplan@example.com)' },
    });

    if (!res.ok) {
      throw new Error(`Open Food Facts API error ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<OffSearchResponse>;
  }

  private normalize(product: OffProduct): Food | null {
    const nm = product.nutriments;
    if (!nm) return null;

    const kcal    = nm['energy-kcal_100g'];
    const protein = nm['proteins_100g'];
    const fat     = nm['fat_100g'];
    const carbs   = nm['carbohydrates_100g'];

    if (kcal == null || protein == null || fat == null || carbs == null) {
      return null;
    }

    const namePt = (product.product_name_pt || product.product_name || '').trim();
    if (!namePt) return null;

    const rawCategories = product.categories ?? '';
    const category      = extractCategory(rawCategories);
    const tags          = buildTags(product.labels_tags ?? [], rawCategories);

    return {
      id:          deterministicUuid('OFF', product._id),
      externalId:  product._id,
      namePt,
      category,
      tags,
      nutrients: {
        kcalPer100g: round(kcal),
        proteinG:    round(protein),
        carbsG:      round(carbs),
        fatG:        round(fat),
        fiberG:      nm['fiber_100g']         != null ? round(nm['fiber_100g']!)         : undefined,
        sodiumMg:    nm['sodium_100g']        != null ? round(nm['sodium_100g']! * 1000)  : undefined, // OFF usa gramas
        calciumMg:   nm['calcium_100g']       != null ? round(nm['calcium_100g']! * 1000) : undefined,
        ironMg:      nm['iron_100g']          != null ? round(nm['iron_100g']! * 1000)    : undefined,
        zincMg:      nm['zinc_100g']          != null ? round(nm['zinc_100g']! * 1000)    : undefined,
        vitCMg:      nm['vitamin-c_100g']     != null ? round(nm['vitamin-c_100g']! * 1000)  : undefined,
        vitB12Mcg:   nm['vitamin-b12_100g']   != null ? round(nm['vitamin-b12_100g']! * 1e6) : undefined,
      },
      primarySource: 'OFF',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function extractCategory(rawCategories: string): string {
  // OFF retorna categorias separadas por vírgula; pega a mais específica (última)
  const parts = rawCategories
    .split(',')
    .map(s => s.replace(/^[a-z]{2}:/, '').trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? 'Outros';
}

function buildTags(labelTags: string[], categories: string): string[] {
  const tags: string[] = [];
  const lower = categories.toLowerCase();

  if (labelTags.some(t => t.includes('vegan')))      tags.push('vegano');
  if (labelTags.some(t => t.includes('vegetarian'))) tags.push('vegetariano');
  if (labelTags.some(t => t.includes('gluten-free'))) tags.push('sem-gluten');
  if (labelTags.some(t => t.includes('lactose-free'))) tags.push('sem-lactose');
  if (labelTags.some(t => t.includes('organic')))    tags.push('organico');

  if (lower.includes('dairy'))    { tags.push('laticinio', 'lactose'); }
  if (lower.includes('meat') || lower.includes('fish')) tags.push('proteina-animal');
  if (lower.includes('fruit'))    tags.push('fruta');
  if (lower.includes('vegetable') || lower.includes('legume')) tags.push('vegetal');
  if (lower.includes('cereal') || lower.includes('grain')) tags.push('cereal');
  if (lower.includes('legume') || lower.includes('bean'))  tags.push('leguminosa');
  if (lower.includes('nut') || lower.includes('seed'))     tags.push('oleaginosa');

  return [...new Set(tags)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
