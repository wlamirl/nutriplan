import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncFoodSourceUseCase } from '../SyncFoodSourceUseCase';
import { IFoodRepository, ISyncLogRepository, UpsertFoodResult, SyncLogEntry } from '../../repositories/interfaces';
import { IFoodSyncAdapter } from '../../services/interfaces';
import { Food } from '../../entities/Food';
import { DomainError } from '../../errors/DomainError';

// ─── Fábricas de mocks ────────────────────────────────────────────────────────

function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id:            'food-uuid-1',
    externalId:    'EXT001',
    namePt:        'Arroz branco cozido',
    category:      'Cereais',
    tags:          ['cereal'],
    primarySource: 'TBCA',
    nutrients: {
      kcalPer100g: 128, proteinG: 2.5, carbsG: 28.1, fatG: 0.2,
    },
    ...overrides,
  };
}

function makeSyncLogEntry(overrides: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id:             'log-uuid-1',
    source:         'TBCA',
    status:         'pending',
    totalProcessed: 0,
    totalInserted:  0,
    totalUpdated:   0,
    totalFailed:    0,
    startedAt:      new Date(),
    createdAt:      new Date(),
    ...overrides,
  };
}

function makeFoodRepo(): IFoodRepository {
  return {
    searchBySimilarity:   vi.fn(),
    findById:             vi.fn(),
    findByName:           vi.fn(),
    upsert:               vi.fn().mockResolvedValue({ food: makeFood(), created: true } satisfies UpsertFoodResult),
    findAll:              vi.fn(),
    findWithoutEmbeddings: vi.fn(),
    saveEmbedding:        vi.fn(),
    countAll:             vi.fn(),
  };
}

function makeSyncLogRepo(): ISyncLogRepository {
  const entry = makeSyncLogEntry();
  return {
    create: vi.fn().mockResolvedValue(entry),
    update: vi.fn().mockResolvedValue(entry),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
}

async function* makeFoodsGenerator(foods: Food[]) {
  for (const f of foods) yield f;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('SyncFoodSourceUseCase', () => {
  let foodRepo:    IFoodRepository;
  let syncLogRepo: ISyncLogRepository;
  let useCase:     SyncFoodSourceUseCase;

  beforeEach(() => {
    foodRepo    = makeFoodRepo();
    syncLogRepo = makeSyncLogRepo();
    useCase     = new SyncFoodSourceUseCase(foodRepo, syncLogRepo);
  });

  it('deve inserir alimentos e retornar contagens corretas', async () => {
    const foods = [makeFood(), makeFood({ id: 'food-2', externalId: 'EXT002', namePt: 'Feijão cozido' })];

    const adapter: IFoodSyncAdapter = {
      source: 'TBCA',
      syncAll: () => makeFoodsGenerator(foods),
    };

    const result = await useCase.execute({ adapter });

    expect(result.source).toBe('TBCA');
    expect(result.totalProcessed).toBe(2);
    expect(result.totalInserted).toBe(2);
    expect(result.totalUpdated).toBe(0);
    expect(result.totalFailed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('deve registrar atualização quando upsert retornar created=false', async () => {
    vi.mocked(foodRepo.upsert).mockResolvedValue({ food: makeFood(), created: false });

    const adapter: IFoodSyncAdapter = {
      source: 'USDA',
      syncAll: () => makeFoodsGenerator([makeFood()]),
    };

    const result = await useCase.execute({ adapter });

    expect(result.totalInserted).toBe(0);
    expect(result.totalUpdated).toBe(1);
  });

  it('deve contabilizar falhas sem abortar a sincronização', async () => {
    vi.mocked(foodRepo.upsert)
      .mockResolvedValueOnce({ food: makeFood(), created: true })
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce({ food: makeFood(), created: true });

    const foods = [
      makeFood({ id: '1' }),
      makeFood({ id: '2' }),
      makeFood({ id: '3' }),
    ];

    const adapter: IFoodSyncAdapter = {
      source: 'TBCA',
      syncAll: () => makeFoodsGenerator(foods),
    };

    const result = await useCase.execute({ adapter });

    expect(result.totalProcessed).toBe(3);
    expect(result.totalInserted).toBe(2);
    expect(result.totalFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('DB timeout');
  });

  it('deve marcar log como running ao iniciar e completed ao finalizar', async () => {
    const adapter: IFoodSyncAdapter = {
      source: 'TBCA',
      syncAll: () => makeFoodsGenerator([]),
    };

    await useCase.execute({ adapter });

    expect(syncLogRepo.update).toHaveBeenCalledWith(
      'log-uuid-1',
      expect.objectContaining({ status: 'running' }),
    );
    expect(syncLogRepo.update).toHaveBeenCalledWith(
      'log-uuid-1',
      expect.objectContaining({ status: 'completed', finishedAt: expect.any(Date) }),
    );
  });

  it('deve lançar DomainError e marcar log como failed quando adapter falhar', async () => {
    const adapter: IFoodSyncAdapter = {
      source: 'USDA',
      async *syncAll() {
        throw new Error('Network error');
        yield makeFood(); // never reached
      },
    };

    await expect(useCase.execute({ adapter })).rejects.toThrow(DomainError);

    expect(syncLogRepo.update).toHaveBeenCalledWith(
      'log-uuid-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('Network error') }),
    );
  });

  it('deve criar log com a fonte correta do adapter', async () => {
    const adapter: IFoodSyncAdapter = {
      source: 'OFF',
      syncAll: () => makeFoodsGenerator([]),
    };

    await useCase.execute({ adapter });

    expect(syncLogRepo.create).toHaveBeenCalledWith('OFF');
  });
});
