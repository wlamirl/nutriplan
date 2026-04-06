import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DietPlanController } from '../DietPlanController';
import { DomainError } from '@nutriplan/domain';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { GenerateDietPlanUseCase } from '@nutriplan/domain';
import type { DietPlan } from '@nutriplan/domain';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReply(): FastifyReply {
  const reply = {
    status: vi.fn(),
    send:   vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply as unknown as FastifyReply;
}

function makeRequest(body: unknown): FastifyRequest {
  return { body } as unknown as FastifyRequest;
}

const validBody = {
  patientId:    '00000000-0000-0000-0000-000000000001',
  objectives:   'Perda de peso saudável',
  durationDays: 30,
};

const mockPlan: DietPlan = {
  id:                  'plan-1',
  patientId:           '00000000-0000-0000-0000-000000000001',
  startDate:           new Date('2026-04-01'),
  endDate:             new Date('2026-05-01'),
  objectives:          'Perda de peso saudável',
  macroTargets:        { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 67, proteinPct: 30, carbsPct: 40, fatPct: 30 },
  meals:               [],
  totalDailyKcal:      2000,
  totalDailyProteinG:  150,
  totalDailyCarbsG:    200,
  totalDailyFatG:      67,
  aiGenerationMeta: {
    model:            'claude-sonnet-4-20250514',
    promptTokens:     1200,
    completionTokens: 800,
    foodSourcesUsed:  ['TBCA', 'USDA'],
    generatedAt:      new Date('2026-04-02T10:00:00Z'),
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DietPlanController', () => {
  let useCase: { execute: ReturnType<typeof vi.fn> };
  let controller: DietPlanController;

  beforeEach(() => {
    useCase = { execute: vi.fn() };
    controller = new DietPlanController(
      useCase as unknown as GenerateDietPlanUseCase,
    );
  });

  describe('generate', () => {
    it('deve retornar 201 com data e meta quando o body é válido', async () => {
      useCase.execute.mockResolvedValue({ plan: mockPlan, warnings: [] });
      const req   = makeRequest(validBody);
      const reply = makeReply();

      await controller.generate(req, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith({
        data: mockPlan,
        meta: {
          warnings:         [],
          generatedAt:      mockPlan.aiGenerationMeta?.generatedAt,
          model:            mockPlan.aiGenerationMeta?.model,
          foodSources:      mockPlan.aiGenerationMeta?.foodSourcesUsed,
          promptTokens:     mockPlan.aiGenerationMeta?.promptTokens,
          completionTokens: mockPlan.aiGenerationMeta?.completionTokens,
        },
      });
    });

    it('deve passar os dados validados ao use-case', async () => {
      useCase.execute.mockResolvedValue({ plan: mockPlan, warnings: [] });
      const body = { ...validBody, customKcalTarget: 1800 };
      await controller.generate(makeRequest(body), makeReply());

      expect(useCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: validBody.patientId, customKcalTarget: 1800 }),
      );
    });

    it('deve retornar 400 com details quando o body é inválido', async () => {
      const req   = makeRequest({ objectives: 'ok' }); // patientId ausente
      const reply = makeReply();

      await controller.generate(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Erro de validação', details: expect.any(Object) }),
      );
      expect(useCase.execute).not.toHaveBeenCalled();
    });

    it('deve retornar 400 quando objectives é curto demais', async () => {
      const req   = makeRequest({ ...validBody, objectives: 'ok' }); // < 5 chars
      const reply = makeReply();

      await controller.generate(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it('deve retornar 400 quando macroSplit não soma 100', async () => {
      const req = makeRequest({
        ...validBody,
        macroSplit: { proteinPct: 30, carbsPct: 30, fatPct: 30 }, // soma 90
      });
      const reply = makeReply();

      await controller.generate(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it('deve propagar DomainError para o errorHandler (sem capturar)', async () => {
      useCase.execute.mockRejectedValue(new DomainError('Paciente não encontrado'));
      const req   = makeRequest(validBody);
      const reply = makeReply();

      await expect(controller.generate(req, reply)).rejects.toThrow(
        new DomainError('Paciente não encontrado'),
      );
    });

    it('deve propagar erros inesperados para o errorHandler', async () => {
      useCase.execute.mockRejectedValue(new Error('Falha no banco'));
      const req   = makeRequest(validBody);
      const reply = makeReply();

      await expect(controller.generate(req, reply)).rejects.toThrow('Falha no banco');
    });
  });
});
