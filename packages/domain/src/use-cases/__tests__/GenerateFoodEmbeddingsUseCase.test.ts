import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GenerateFoodEmbeddingsUseCase,
  buildEmbeddingText,
} from '../GenerateFoodEmbeddingsUseCase';
import { IFoodRepository } from '../../repositories/interfaces';
import { IEmbeddingService } from '../../services/interfaces';
import { Food } from '../../entities/Food';

// ─── Fábricas ─────────────────────────────────────────────────────────────────

function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id:            'food-uuid-1',
    namePt:        'Frango peito grelhado',
    category:      'Carnes',
    subcategory:   'Aves',
    tags:          ['proteina-animal'],
    primarySource: 'TBCA',
    nutrients: {
      kcalPer100g: 159, proteinG: 32.0, carbsG: 0.0, fatG: 3.2,
    },
    ...overrides,
  };
}

function makeFoodRepo(): IFoodRepository {
  return {
    searchBySimilarity:    vi.fn(),
    findById:              vi.fn(),
    findByName:            vi.fn(),
    upsert:                vi.fn(),
    findAll:               vi.fn().mockResolvedValue([]),
    findWithoutEmbeddings: vi.fn().mockResolvedValue([]),
    saveEmbedding:         vi.fn().mockResolvedValue(undefined),
    countAll:              vi.fn().mockResolvedValue(0),
  };
}

function makeEmbeddingService(): IEmbeddingService {
  const fakeVector = new Array(1536).fill(0).map((_, i) => i / 1536);
  return {
    embed:              vi.fn().mockResolvedValue(fakeVector),
    embedFoodCatalogue: vi.fn(),
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('GenerateFoodEmbeddingsUseCase', () => {
  let foodRepo:       IFoodRepository;
  let embedSvc:       IEmbeddingService;
  let useCase:        GenerateFoodEmbeddingsUseCase;

  beforeEach(() => {
    foodRepo  = makeFoodRepo();
    embedSvc  = makeEmbeddingService();
    useCase   = new GenerateFoodEmbeddingsUseCase(foodRepo, embedSvc);
  });

  it('deve processar todos os alimentos sem embeddings por padrão', async () => {
    const foods = [makeFood(), makeFood({ id: 'food-2' })];
    vi.mocked(foodRepo.findWithoutEmbeddings).mockResolvedValue(foods);

    const result = await useCase.execute({});

    expect(result.total).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(embedSvc.embed).toHaveBeenCalledTimes(2);
    expect(foodRepo.saveEmbedding).toHaveBeenCalledTimes(2);
  });

  it('deve usar findAll quando overwrite=true', async () => {
    const foods = [makeFood()];
    vi.mocked(foodRepo.findAll).mockResolvedValue(foods);

    await useCase.execute({ overwrite: true });

    expect(foodRepo.findAll).toHaveBeenCalled();
    expect(foodRepo.findWithoutEmbeddings).not.toHaveBeenCalled();
  });

  it('deve usar findById quando foodIds são fornecidos', async () => {
    vi.mocked(foodRepo.findById).mockResolvedValue(makeFood());

    await useCase.execute({ foodIds: ['food-uuid-1'] });

    expect(foodRepo.findById).toHaveBeenCalledWith('food-uuid-1');
    expect(foodRepo.findWithoutEmbeddings).not.toHaveBeenCalled();
  });

  it('deve ignorar IDs não encontrados silenciosamente', async () => {
    vi.mocked(foodRepo.findById)
      .mockResolvedValueOnce(makeFood())
      .mockResolvedValueOnce(null);

    const result = await useCase.execute({ foodIds: ['food-1', 'food-inexistente'] });

    expect(result.total).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('deve contabilizar falhas sem abortar o lote', async () => {
    const foods = [makeFood({ id: '1' }), makeFood({ id: '2' }), makeFood({ id: '3' })];
    vi.mocked(foodRepo.findWithoutEmbeddings).mockResolvedValue(foods);
    vi.mocked(embedSvc.embed)
      .mockResolvedValueOnce([0.1])
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce([0.3]);

    const result = await useCase.execute({});

    expect(result.total).toBe(3);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Timeout');
  });

  it('deve salvar o embedding retornado pelo serviço', async () => {
    const vector = [0.1, 0.2, 0.3];
    vi.mocked(foodRepo.findWithoutEmbeddings).mockResolvedValue([makeFood()]);
    vi.mocked(embedSvc.embed).mockResolvedValue(vector);

    await useCase.execute({});

    expect(foodRepo.saveEmbedding).toHaveBeenCalledWith('food-uuid-1', vector);
  });

  it('deve retornar total=0 quando não há alimentos para processar', async () => {
    vi.mocked(foodRepo.findWithoutEmbeddings).mockResolvedValue([]);

    const result = await useCase.execute({});

    expect(result.total).toBe(0);
    expect(result.processed).toBe(0);
    expect(embedSvc.embed).not.toHaveBeenCalled();
  });
});

// ─── buildEmbeddingText ───────────────────────────────────────────────────────

describe('buildEmbeddingText', () => {
  it('deve incluir namePt, category e fonte', () => {
    const food = makeFood();
    const text = buildEmbeddingText(food);
    expect(text).toContain('Frango peito grelhado');
    expect(text).toContain('Carnes');
    expect(text).toContain('fonte: TBCA');
  });

  it('deve incluir subcategoria quando presente', () => {
    const food = makeFood({ subcategory: 'Aves' });
    expect(buildEmbeddingText(food)).toContain('Aves');
  });

  it('deve incluir "rico em proteína" para alimentos proteicos', () => {
    const food = makeFood({ nutrients: { kcalPer100g: 159, proteinG: 32, carbsG: 0, fatG: 3 } });
    expect(buildEmbeddingText(food)).toContain('rico em proteína');
  });

  it('deve incluir cálcio quando relevante', () => {
    const food = makeFood({
      nutrients: { kcalPer100g: 61, proteinG: 3.2, carbsG: 4.7, fatG: 3.3, calciumMg: 113 },
    });
    expect(buildEmbeddingText(food)).toContain('cálcio');
  });

  it('não deve incluir "rico em" quando não há nutrientes destacáveis', () => {
    const food = makeFood({
      nutrients: { kcalPer100g: 30, proteinG: 0.5, carbsG: 7, fatG: 0.1 },
    });
    expect(buildEmbeddingText(food)).not.toContain('rico em');
  });
});
