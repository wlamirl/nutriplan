/**
 * Seed inicial com ~200 alimentos brasileiros comuns.
 *
 * Uso: pnpm --filter api db:seed
 *
 * Após inserir os alimentos, gera embeddings via GenerateFoodEmbeddingsUseCase.
 */
import { PgFoodRepository }       from '../infrastructure/repositories/PgFoodRepository';
import { ClaudeEmbeddingService }  from '../infrastructure/ai/ClaudeEmbeddingService';
import { GenerateFoodEmbeddingsUseCase } from '@nutriplan/domain';
import { Food, FoodSource }        from '@nutriplan/domain';
import { createHash }              from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(seed: string): string {
  const hash = createHash('sha256').update(`SEED:${seed}`).digest('hex');
  return [
    hash.slice(0, 8), hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    (parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

function food(
  name: string,
  category: string,
  kcal: number, protein: number, carbs: number, fat: number,
  extra: Partial<Omit<Food, 'id' | 'namePt' | 'category' | 'nutrients' | 'primarySource' | 'tags'>> & {
    fiber?: number; sodium?: number; calcium?: number; iron?: number; zinc?: number;
    vitC?: number; vitB12?: number; tags?: string[]; subcategory?: string;
  } = {},
  source: FoodSource = 'TBCA',
): Food {
  return {
    id:            uuid(name),
    externalId:    `SEED_${name.replace(/\s+/g, '_').toUpperCase()}`,
    namePt:        name,
    category,
    subcategory:   extra.subcategory,
    tags:          extra.tags ?? [],
    primarySource: source,
    nutrients: {
      kcalPer100g: kcal,
      proteinG:    protein,
      carbsG:      carbs,
      fatG:        fat,
      fiberG:      extra.fiber,
      sodiumMg:    extra.sodium,
      calciumMg:   extra.calcium,
      ironMg:      extra.iron,
      zincMg:      extra.zinc,
      vitCMg:      extra.vitC,
      vitB12Mcg:   extra.vitB12,
    },
  };
}

// ─── Catálogo de alimentos ────────────────────────────────────────────────────

const FOODS: Food[] = [
  // ── Cereais e derivados ──────────────────────────────────────────────────
  food('Arroz branco cozido',        'Cereais', 128, 2.5, 28.1, 0.2, { fiber: 1.6, subcategory: 'Arroz', tags: ['cereal', 'gluten-free'] }),
  food('Arroz integral cozido',      'Cereais', 124, 2.6, 25.8, 1.0, { fiber: 3.5, subcategory: 'Arroz', tags: ['cereal', 'gluten-free', 'integral'] }),
  food('Pão francês',                'Cereais', 300, 8.0, 58.6, 3.1, { fiber: 2.3, sodium: 620, subcategory: 'Pão', tags: ['cereal', 'gluten'] }),
  food('Pão integral',               'Cereais', 253, 9.4, 46.7, 3.2, { fiber: 6.9, sodium: 430, subcategory: 'Pão', tags: ['cereal', 'gluten', 'integral'] }),
  food('Macarrão cozido',            'Cereais', 149, 5.0, 29.4, 1.1, { fiber: 1.8, subcategory: 'Massa', tags: ['cereal', 'gluten'] }),
  food('Farinha de trigo',           'Cereais', 360, 9.8, 75.1, 1.4, { fiber: 2.3, subcategory: 'Farinha', tags: ['cereal', 'gluten'] }),
  food('Aveia em flocos',            'Cereais', 394, 13.9, 66.6, 8.5, { fiber: 9.1, subcategory: 'Aveia', tags: ['cereal', 'gluten', 'integral'] }),
  food('Granola',                    'Cereais', 404, 9.2, 65.2, 11.8, { fiber: 7.0, subcategory: 'Granola', tags: ['cereal', 'integral'] }),
  food('Tapioca (goma)',             'Cereais', 129, 0.2, 31.8, 0.0, { subcategory: 'Tapioca', tags: ['cereal', 'gluten-free'] }),
  food('Cuscuz de milho cozido',     'Cereais', 130, 2.3, 27.9, 0.5, { fiber: 1.5, subcategory: 'Milho', tags: ['cereal', 'gluten-free'] }),

  // ── Leguminosas ──────────────────────────────────────────────────────────
  food('Feijão carioca cozido',      'Leguminosas', 77,  4.8, 13.6, 0.5, { fiber: 8.5, iron: 1.5, tags: ['leguminosa', 'gluten-free'] }),
  food('Feijão preto cozido',        'Leguminosas', 77,  5.0, 14.0, 0.5, { fiber: 8.4, iron: 1.5, tags: ['leguminosa', 'gluten-free'] }),
  food('Feijão branco cozido',       'Leguminosas', 100, 6.9, 17.5, 0.3, { fiber: 6.3, calcium: 90, iron: 2.2, tags: ['leguminosa', 'gluten-free'] }),
  food('Lentilha cozida',            'Leguminosas', 116, 9.0, 20.1, 0.4, { fiber: 7.9, iron: 3.3, tags: ['leguminosa', 'gluten-free'] }),
  food('Grão-de-bico cozido',        'Leguminosas', 164, 8.9, 27.4, 2.6, { fiber: 7.6, iron: 2.9, calcium: 49, tags: ['leguminosa', 'gluten-free'] }),
  food('Soja cozida',                'Leguminosas', 141, 16.6, 11.5, 6.0, { fiber: 6.0, calcium: 102, iron: 5.1, tags: ['leguminosa', 'gluten-free'] }),
  food('Ervilha cozida',             'Leguminosas', 84,  5.4, 14.5, 0.4, { fiber: 5.1, vitC: 14, tags: ['leguminosa', 'gluten-free'] }),

  // ── Carnes e aves ────────────────────────────────────────────────────────
  food('Frango (peito) grelhado',    'Carnes', 159, 32.0, 0.0, 3.2, { sodium: 72, vitB12: 0.3, tags: ['proteina-animal', 'gluten-free'] }),
  food('Frango (coxa) assada',       'Carnes', 187, 25.5, 0.0, 9.5, { sodium: 89, vitB12: 0.3, tags: ['proteina-animal', 'gluten-free'] }),
  food('Carne bovina (patinho) cozida', 'Carnes', 219, 30.7, 0.0, 10.5, { iron: 3.6, zinc: 7.0, vitB12: 2.6, tags: ['proteina-animal', 'gluten-free'] }),
  food('Carne bovina (acém) cozida', 'Carnes', 246, 28.9, 0.0, 13.8, { iron: 3.5, zinc: 6.5, vitB12: 2.4, tags: ['proteina-animal', 'gluten-free'] }),
  food('Carne suína (lombo) assado', 'Carnes', 207, 29.4, 0.0, 9.7,  { zinc: 3.4, vitB12: 0.8, tags: ['proteina-animal', 'gluten-free'] }),
  food('Atum em lata (ao natural)',  'Carnes', 119, 26.4, 0.0, 1.3,  { sodium: 310, vitB12: 2.5, tags: ['proteina-animal', 'gluten-free', 'peixe'] }),
  food('Sardinha em lata',           'Carnes', 208, 24.4, 0.0, 11.5, { sodium: 460, calcium: 382, vitB12: 8.9, tags: ['proteina-animal', 'gluten-free', 'peixe'] }),
  food('Tilápia grelhada',           'Carnes', 128, 26.2, 0.0, 2.7,  { vitB12: 1.9, tags: ['proteina-animal', 'gluten-free', 'peixe'] }),
  food('Salmão assado',              'Carnes', 206, 27.3, 0.0, 10.4, { vitB12: 3.2, tags: ['proteina-animal', 'gluten-free', 'peixe'] }),

  // ── Ovos ─────────────────────────────────────────────────────────────────
  food('Ovo cozido (inteiro)',       'Ovos', 155, 13.0, 1.1, 10.6, { vitB12: 1.1, iron: 1.8, tags: ['proteina-animal', 'gluten-free'] }),
  food('Ovo estrelado',              'Ovos', 196, 13.6, 0.4, 15.0, { vitB12: 1.1, tags: ['proteina-animal', 'gluten-free'] }),
  food('Clara de ovo cozida',        'Ovos', 52,  11.1, 0.7, 0.2,  { tags: ['proteina-animal', 'gluten-free'] }),

  // ── Laticínios ───────────────────────────────────────────────────────────
  food('Leite integral',             'Laticínios', 61, 3.2, 4.7, 3.3, { calcium: 113, vitB12: 0.4, tags: ['laticinio', 'lactose'] }),
  food('Leite desnatado',            'Laticínios', 35, 3.4, 4.9, 0.1, { calcium: 119, vitB12: 0.4, tags: ['laticinio', 'lactose'] }),
  food('Iogurte natural integral',   'Laticínios', 61, 3.5, 4.7, 3.3, { calcium: 121, tags: ['laticinio', 'lactose'] }),
  food('Iogurte grego',              'Laticínios', 97, 9.0, 3.6, 5.0, { calcium: 111, tags: ['laticinio', 'lactose'] }),
  food('Queijo minas frescal',       'Laticínios', 264, 17.4, 3.2, 20.2, { calcium: 579, sodium: 390, tags: ['laticinio', 'lactose'] }),
  food('Queijo cottage',             'Laticínios', 98, 11.1, 3.4, 4.3, { calcium: 83, sodium: 372, tags: ['laticinio', 'lactose'] }),
  food('Requeijão cremoso',          'Laticínios', 255, 7.8, 3.2, 23.7, { calcium: 128, sodium: 476, tags: ['laticinio', 'lactose'] }),
  food('Manteiga',                   'Laticínios', 726, 0.9, 0.1, 80.5, { sodium: 576, tags: ['laticinio', 'lactose'] }),
  food('Cream cheese',               'Laticínios', 342, 5.0, 4.1, 34.0, { calcium: 98, sodium: 321, tags: ['laticinio', 'lactose'] }),

  // ── Frutas ───────────────────────────────────────────────────────────────
  food('Banana prata',               'Frutas', 92, 1.3, 23.8, 0.1, { fiber: 2.0, vitC: 9, tags: ['fruta', 'gluten-free'] }),
  food('Banana da terra',            'Frutas', 122, 1.3, 31.9, 0.1, { fiber: 2.3, vitC: 18, tags: ['fruta', 'gluten-free'] }),
  food('Maçã',                       'Frutas', 56, 0.3, 15.2, 0.1, { fiber: 1.3, vitC: 3, tags: ['fruta', 'gluten-free'] }),
  food('Laranja pera',               'Frutas', 46, 0.9, 11.5, 0.1, { fiber: 0.8, vitC: 53, tags: ['fruta', 'gluten-free'] }),
  food('Mamão papaia',               'Frutas', 40, 0.5, 10.4, 0.1, { fiber: 1.8, vitC: 62, tags: ['fruta', 'gluten-free'] }),
  food('Manga Tommy',                'Frutas', 67, 0.7, 17.3, 0.3, { fiber: 1.8, vitC: 31, tags: ['fruta', 'gluten-free'] }),
  food('Abacaxi',                    'Frutas', 48, 0.9, 12.3, 0.1, { fiber: 1.0, vitC: 25, tags: ['fruta', 'gluten-free'] }),
  food('Uva Itália',                 'Frutas', 69, 0.6, 18.1, 0.4, { vitC: 4, tags: ['fruta', 'gluten-free'] }),
  food('Morango',                    'Frutas', 30, 0.8, 6.7, 0.3, { fiber: 2.0, vitC: 60, tags: ['fruta', 'gluten-free'] }),
  food('Melancia',                   'Frutas', 28, 0.6, 6.9, 0.1, { vitC: 8, tags: ['fruta', 'gluten-free'] }),
  food('Melão',                      'Frutas', 30, 0.7, 7.5, 0.2, { vitC: 18, tags: ['fruta', 'gluten-free'] }),
  food('Goiaba',                     'Frutas', 54, 2.6, 12.2, 0.9, { fiber: 6.2, vitC: 228, tags: ['fruta', 'gluten-free'] }),
  food('Caju',                       'Frutas', 43, 1.0, 9.8, 0.3, { fiber: 1.5, vitC: 219, tags: ['fruta', 'gluten-free'] }),
  food('Abacate',                    'Frutas', 96, 1.2, 6.0, 8.4, { fiber: 6.3, vitC: 13, tags: ['fruta', 'gluten-free'] }),
  food('Coco seco (polpa)',          'Frutas', 354, 3.4, 15.2, 32.9, { fiber: 9.6, tags: ['fruta', 'gluten-free'] }),
  food('Pêssego',                    'Frutas', 37, 0.8, 9.4, 0.1, { vitC: 9, tags: ['fruta', 'gluten-free'] }),

  // ── Hortaliças ────────────────────────────────────────────────────────────
  food('Alface (folhas)',            'Hortaliças', 11, 1.3, 1.4, 0.2, { vitC: 9, calcium: 35, tags: ['vegetal', 'gluten-free'] }),
  food('Tomate',                     'Hortaliças', 15, 1.1, 3.1, 0.2, { vitC: 21, tags: ['vegetal', 'gluten-free'] }),
  food('Cebola',                     'Hortaliças', 40, 1.1, 9.2, 0.1, { vitC: 7, tags: ['vegetal', 'gluten-free'] }),
  food('Alho',                       'Hortaliças', 149, 6.4, 32.5, 0.5, { calcium: 67, tags: ['vegetal', 'gluten-free'] }),
  food('Cenoura crua',               'Hortaliças', 34, 1.3, 7.7, 0.2, { fiber: 3.2, vitC: 5, tags: ['vegetal', 'gluten-free'] }),
  food('Beterraba cozida',           'Hortaliças', 45, 1.5, 10.0, 0.1, { fiber: 2.8, vitC: 6, tags: ['vegetal', 'gluten-free'] }),
  food('Brócolis cozido',            'Hortaliças', 34, 2.2, 5.5, 0.5, { fiber: 3.3, vitC: 44, calcium: 47, iron: 1.0, tags: ['vegetal', 'gluten-free'] }),
  food('Couve-flor cozida',          'Hortaliças', 22, 1.8, 3.8, 0.2, { fiber: 2.1, vitC: 44, tags: ['vegetal', 'gluten-free'] }),
  food('Couve manteiga refogada',    'Hortaliças', 31, 2.2, 4.5, 0.7, { vitC: 60, calcium: 254, iron: 1.1, tags: ['vegetal', 'gluten-free'] }),
  food('Espinafre refogado',         'Hortaliças', 20, 2.5, 2.0, 0.5, { iron: 2.7, calcium: 99, vitC: 28, tags: ['vegetal', 'gluten-free'] }),
  food('Abobrinha cozida',           'Hortaliças', 17, 1.2, 3.1, 0.2, { vitC: 8, tags: ['vegetal', 'gluten-free'] }),
  food('Berinjela cozida',           'Hortaliças', 24, 0.9, 5.1, 0.2, { fiber: 2.5, tags: ['vegetal', 'gluten-free'] }),
  food('Pimentão vermelho',          'Hortaliças', 27, 1.2, 5.3, 0.3, { vitC: 127, tags: ['vegetal', 'gluten-free'] }),
  food('Pepino',                     'Hortaliças', 15, 0.8, 2.9, 0.1, { vitC: 3, tags: ['vegetal', 'gluten-free'] }),
  food('Quiabo cozido',              'Hortaliças', 25, 2.0, 4.6, 0.1, { fiber: 3.2, calcium: 77, vitC: 16, tags: ['vegetal', 'gluten-free'] }),
  food('Inhame cozido',              'Hortaliças', 116, 1.5, 27.5, 0.1, { tags: ['vegetal', 'gluten-free'] }),
  food('Mandioca cozida',            'Hortaliças', 125, 0.7, 30.1, 0.3, { fiber: 1.9, tags: ['vegetal', 'gluten-free'] }),
  food('Batata doce cozida',         'Hortaliças', 77, 1.4, 18.4, 0.1, { fiber: 2.4, vitC: 20, tags: ['vegetal', 'gluten-free'] }),
  food('Batata inglesa cozida',      'Hortaliças', 52, 1.2, 11.9, 0.1, { fiber: 1.8, vitC: 15, tags: ['vegetal', 'gluten-free'] }),

  // ── Oleaginosas e sementes ────────────────────────────────────────────────
  food('Castanha-do-pará',           'Oleaginosas', 656, 14.5, 12.3, 63.5, { fiber: 7.9, selenium: 1917, tags: ['oleaginosa', 'gluten-free'] } as Parameters<typeof food>[6]),
  food('Amendoim torrado',           'Oleaginosas', 567, 26.2, 19.5, 45.3, { fiber: 9.4, iron: 2.0, zinc: 3.5, tags: ['oleaginosa', 'gluten-free'] }),
  food('Pasta de amendoim integral', 'Oleaginosas', 614, 25.1, 19.7, 50.4, { fiber: 6.0, tags: ['oleaginosa', 'gluten-free'] }),
  food('Amêndoas',                   'Oleaginosas', 579, 21.2, 21.6, 49.9, { fiber: 12.5, calcium: 264, iron: 3.7, vitE: 26, tags: ['oleaginosa', 'gluten-free'] } as Parameters<typeof food>[6]),
  food('Nozes',                      'Oleaginosas', 654, 15.2, 13.7, 65.2, { fiber: 6.7, tags: ['oleaginosa', 'gluten-free'] }),
  food('Chia (semente)',             'Oleaginosas', 486, 16.5, 42.1, 30.7, { fiber: 34.4, calcium: 631, iron: 7.7, tags: ['oleaginosa', 'gluten-free'] }),
  food('Linhaça (semente)',          'Oleaginosas', 495, 18.3, 28.9, 42.2, { fiber: 27.3, calcium: 255, iron: 5.7, tags: ['oleaginosa', 'gluten-free'] }),
  food('Gergelim (semente)',         'Oleaginosas', 573, 17.0, 23.4, 49.7, { fiber: 11.8, calcium: 975, iron: 14.6, tags: ['oleaginosa', 'gluten-free'] }),

  // ── Óleos e gorduras ──────────────────────────────────────────────────────
  food('Azeite de oliva',            'Óleos e gorduras', 884, 0.0, 0.0, 100.0, { tags: ['gluten-free'] }),
  food('Óleo de soja',               'Óleos e gorduras', 884, 0.0, 0.0, 100.0, { tags: ['gluten-free'] }),
  food('Óleo de coco',               'Óleos e gorduras', 862, 0.0, 0.0, 100.0, { tags: ['gluten-free'] }),

  // ── Bebidas ───────────────────────────────────────────────────────────────
  food('Água de coco',               'Bebidas', 19, 0.7, 3.7, 0.2, { sodium: 105, vitC: 2, tags: ['gluten-free'] }),
  food('Suco de laranja natural',    'Bebidas', 45, 0.7, 10.4, 0.2, { vitC: 50, tags: ['gluten-free'] }),
  food('Café (sem açúcar)',          'Bebidas', 2, 0.3, 0.0, 0.0, { tags: ['gluten-free'] }),

  // ── Proteínas vegetais processadas ────────────────────────────────────────
  food('Tofu',                       'Proteínas vegetais', 76, 8.1, 1.9, 4.8, { calcium: 350, iron: 5.4, tags: ['proteina-vegetal', 'gluten-free', 'vegano'] }),
  food('Proteína de soja texturizada (hidratada)', 'Proteínas vegetais', 70, 10.6, 5.5, 0.3, { iron: 2.0, tags: ['proteina-vegetal', 'gluten-free', 'vegano'] }),
  food('Creme de ricota',            'Laticínios', 174, 11.3, 3.4, 13.2, { calcium: 207, tags: ['laticinio', 'lactose'] }),

  // ── Outros itens comuns ───────────────────────────────────────────────────
  food('Mel',                        'Outros', 309, 0.4, 84.0, 0.0, { tags: ['gluten-free'] }),
  food('Açúcar refinado',            'Outros', 387, 0.0, 99.7, 0.0, { tags: ['gluten-free'] }),
  food('Açúcar demerara',            'Outros', 380, 0.3, 97.9, 0.0, { tags: ['gluten-free'] }),
  food('Adoçante de stevia',         'Outros', 0, 0.0, 0.0, 0.0, { tags: ['gluten-free', 'zero-caloria'] }),
  food('Cacau em pó (sem açúcar)',   'Outros', 228, 19.6, 57.9, 13.7, { fiber: 33.2, iron: 13.9, tags: ['gluten-free'] }),
  food('Chocolate 70% cacau',        'Outros', 598, 8.5, 43.1, 42.7, { fiber: 10.9, iron: 11.9, tags: ['gluten-free'] }),
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Inserindo ${FOODS.length} alimentos...`);

  const foodRepo = new PgFoodRepository();
  let inserted   = 0;
  let updated    = 0;

  for (const f of FOODS) {
    const result = await foodRepo.upsert(f);
    if (result.created) inserted++; else updated++;
  }

  console.log(`Seed concluído: ${inserted} inseridos, ${updated} atualizados.`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY não definido — embeddings não gerados. Execute manualmente: POST /foods/sync com generate-embeddings.');
    process.exit(0);
  }

  console.log('Gerando embeddings...');
  const embedSvc    = new ClaudeEmbeddingService(apiKey);
  const embedUseCase = new GenerateFoodEmbeddingsUseCase(foodRepo, embedSvc);
  const embedResult  = await embedUseCase.execute({});
  console.log(`Embeddings: ${embedResult.processed} gerados, ${embedResult.failed} falhas.`);
  if (embedResult.errors.length) console.error('Erros:', embedResult.errors);

  process.exit(0);
}

main().catch(err => {
  console.error('Seed falhou:', err);
  process.exit(1);
});
