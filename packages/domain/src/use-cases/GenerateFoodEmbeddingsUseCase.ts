import { IFoodRepository } from '../repositories/interfaces';
import { IEmbeddingService } from '../services/interfaces';
import { Food } from '../entities/Food';

const BATCH_SIZE = 50;

export interface GenerateFoodEmbeddingsRequest {
  /** Se informado, processa apenas estes food IDs */
  foodIds?: string[];
  /** Se true, regenera embeddings mesmo para alimentos que já os possuem */
  overwrite?: boolean;
}

export interface GenerateFoodEmbeddingsResponse {
  total: number;
  processed: number;
  failed: number;
  errors: string[];
}

export class GenerateFoodEmbeddingsUseCase {
  constructor(
    private readonly foodRepo: IFoodRepository,
    private readonly embeddingService: IEmbeddingService,
  ) {}

  async execute(req: GenerateFoodEmbeddingsRequest = {}): Promise<GenerateFoodEmbeddingsResponse> {
    let foods: Food[];

    if (req.foodIds?.length) {
      const results = await Promise.all(req.foodIds.map(id => this.foodRepo.findById(id)));
      foods = results.filter((f): f is Food => f !== null);
    } else if (req.overwrite) {
      foods = await this.foodRepo.findAll();
    } else {
      foods = await this.foodRepo.findWithoutEmbeddings();
    }

    const total     = foods.length;
    let processed   = 0;
    let failed      = 0;
    const errors: string[] = [];

    for (let i = 0; i < foods.length; i += BATCH_SIZE) {
      const batch = foods.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (food) => {
          try {
            const text = buildEmbeddingText(food);
            const embedding = await this.embeddingService.embed(text);
            await this.foodRepo.saveEmbedding(food.id, embedding);
            processed++;
          } catch (err) {
            failed++;
            errors.push(
              `Falha ao gerar embedding para "${food.namePt}": ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }),
      );
    }

    return { total, processed, failed, errors };
  }
}

/**
 * Texto de embedding conforme spec:
 * "${namePt} - ${category} - ${subcategory} - rico em ${topNutrients} - fonte: ${source}"
 */
export function buildEmbeddingText(food: Food): string {
  const topNutrients = getTopNutrients(food);
  const parts = [
    food.namePt,
    food.category,
    food.subcategory,
    topNutrients.length ? `rico em ${topNutrients.join(', ')}` : undefined,
    `fonte: ${food.primarySource}`,
  ].filter((p): p is string => Boolean(p));
  return parts.join(' - ');
}

function getTopNutrients(food: Food): string[] {
  const { nutrients } = food;
  const result: string[] = [];
  if (nutrients.proteinG >= 10)                               result.push('proteína');
  if (nutrients.fiberG    && nutrients.fiberG    >= 3)        result.push('fibra');
  if (nutrients.calciumMg && nutrients.calciumMg >= 100)      result.push('cálcio');
  if (nutrients.ironMg    && nutrients.ironMg    >= 2)        result.push('ferro');
  if (nutrients.vitCMg    && nutrients.vitCMg    >= 15)       result.push('vitamina C');
  if (nutrients.vitB12Mcg && nutrients.vitB12Mcg >= 0.5)      result.push('vitamina B12');
  return result.slice(0, 3);
}
