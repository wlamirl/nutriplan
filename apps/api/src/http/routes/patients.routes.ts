import { FastifyInstance } from 'fastify';
import {
  AppError,
  CreatePatientSchema,
  UpdatePatientSchema,
  AddConsultationSchema,
} from '@nutriplan/shared';
import { PgPatientRepository }      from '../../infrastructure/repositories/PgPatientRepository';
import { PgNutritionistRepository } from '../../infrastructure/repositories/PgUserRepository';
import { PgConsultationRepository } from '../../infrastructure/repositories/PgConsultationRepository';
import { PgDietPlanRepository }     from '../../infrastructure/repositories/PgDietPlanRepository';
import { authenticate }             from '../middlewares/authenticate';

export async function patientRoutes(app: FastifyInstance): Promise<void> {
  const patientRepo      = new PgPatientRepository();
  const nutritionistRepo = new PgNutritionistRepository();
  const consultationRepo = new PgConsultationRepository();
  const dietPlanRepo     = new PgDietPlanRepository();

  // ─── Helper: resolve nutritionistId from JWT userId ───────────────────────

  async function getNutritionistId(userId: string): Promise<string> {
    const nutritionist = await nutritionistRepo.findByUserId(userId);
    if (!nutritionist) throw AppError.notFound('Nutricionista');
    return nutritionist.id;
  }

  // ─── POST /patients ───────────────────────────────────────────────────────

  app.post('/', {
    schema: {
      tags:    ['Patients'],
      summary: 'Criar paciente',
      response: {
        201: { description: 'Paciente criado',    type: 'object', properties: { data: { type: 'object' } } },
        400: { description: 'Erro de validação',  type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const parsed = CreatePatientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const nutritionistId = await getNutritionistId(request.user.sub);

    const patient = await patientRepo.save({
      id:                  '',
      nutritionistId,
      name:                parsed.data.name,
      birthDate:           new Date(parsed.data.birthDate),
      sex:                 parsed.data.sex,
      heightCm:            parsed.data.heightCm,
      activityLevel:       parsed.data.activityLevel,
      restrictions:        parsed.data.restrictions.map(r => ({ id: '', ...r })),
      culturalPreferences: parsed.data.culturalPreferences,
      routineNotes:        parsed.data.routineNotes,
      dislikedFoods:       parsed.data.dislikedFoods,
    });

    return reply.status(201).send({ data: patient });
  });

  // ─── GET /patients ────────────────────────────────────────────────────────

  app.get('/', {
    schema: {
      tags:    ['Patients'],
      summary: 'Listar pacientes do nutricionista',
      response: {
        200: { description: 'Lista de pacientes', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const nutritionistId = await getNutritionistId(request.user.sub);
    const list = await patientRepo.findByNutritionistId(nutritionistId);
    return reply.send({ data: list, meta: { total: list.length } });
  });

  // ─── GET /patients/:id ────────────────────────────────────────────────────

  app.get('/:id', {
    schema: {
      tags:    ['Patients'],
      summary: 'Buscar paciente por ID',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Paciente',         type: 'object', properties: { data: { type: 'object' } } },
        404: { description: 'Não encontrado',   type: 'object', properties: { error: { type: 'string' } } },
        403: { description: 'Sem permissão',    type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const patient = await patientRepo.findById(id);
    if (!patient) throw AppError.notFound('Paciente');

    const nutritionistId = await getNutritionistId(request.user.sub);
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    return reply.send({ data: patient });
  });

  // ─── PATCH /patients/:id ──────────────────────────────────────────────────

  app.patch('/:id', {
    schema: {
      tags:    ['Patients'],
      summary: 'Atualizar paciente',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Paciente atualizado', type: 'object', properties: { data: { type: 'object' } } },
        400: { description: 'Erro de validação',   type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdatePatientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const patient = await patientRepo.findById(id);
    if (!patient) throw AppError.notFound('Paciente');

    const nutritionistId = await getNutritionistId(request.user.sub);
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    const d = parsed.data;
    const updateData: Parameters<typeof patientRepo.update>[1] = {};
    if (d.name              !== undefined) updateData.name              = d.name;
    if (d.birthDate         !== undefined) updateData.birthDate         = new Date(d.birthDate);
    if (d.sex               !== undefined) updateData.sex               = d.sex;
    if (d.heightCm          !== undefined) updateData.heightCm          = d.heightCm;
    if (d.activityLevel     !== undefined) updateData.activityLevel     = d.activityLevel;
    if (d.culturalPreferences !== undefined) updateData.culturalPreferences = d.culturalPreferences;
    if (d.routineNotes      !== undefined) updateData.routineNotes      = d.routineNotes;
    if (d.dislikedFoods     !== undefined) updateData.dislikedFoods     = d.dislikedFoods;
    if (d.restrictions      !== undefined) updateData.restrictions      = d.restrictions.map(r => ({ id: '', ...r }));

    const updated = await patientRepo.update(id, updateData);
    return reply.send({ data: updated });
  });

  // ─── POST /patients/:id/consultations ─────────────────────────────────────

  app.post('/:id/consultations', {
    schema: {
      tags:    ['Consultations'],
      summary: 'Adicionar consulta ao paciente',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        201: { description: 'Consulta criada',   type: 'object', properties: { data: { type: 'object' } } },
        400: { description: 'Erro de validação', type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddConsultationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const patient = await patientRepo.findById(id);
    if (!patient) throw AppError.notFound('Paciente');

    const nutritionistId = await getNutritionistId(request.user.sub);
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    const consultation = await consultationRepo.create(id, nutritionistId, {
      date:         parsed.data.date ? new Date(parsed.data.date) : undefined,
      weightKg:     parsed.data.weightKg,
      bodyFatPct:   parsed.data.bodyFatPct,
      muscleMassKg: parsed.data.muscleMassKg,
      notes:        parsed.data.notes,
    });

    return reply.status(201).send({ data: consultation });
  });

  // ─── GET /patients/:id/consultations ──────────────────────────────────────

  app.get('/:id/consultations', {
    schema: {
      tags:    ['Consultations'],
      summary: 'Listar consultas do paciente',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Lista de consultas', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const patient = await patientRepo.findById(id);
    if (!patient) throw AppError.notFound('Paciente');

    const nutritionistId = await getNutritionistId(request.user.sub);
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    const list = await consultationRepo.findByPatientId(id);
    return reply.send({ data: list, meta: { total: list.length } });
  });

  // ─── GET /patients/:id/diet-plans ─────────────────────────────────────────

  app.get('/:id/diet-plans', {
    schema: {
      tags:    ['Diet Plans'],
      summary: 'Listar planos alimentares do paciente',
      params:  { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { description: 'Lista de planos', type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const patient = await patientRepo.findById(id);
    if (!patient) throw AppError.notFound('Paciente');

    const nutritionistId = await getNutritionistId(request.user.sub);
    if (patient.nutritionistId !== nutritionistId) throw AppError.forbidden();

    const plans = await dietPlanRepo.findByPatientId(id);
    return reply.send({ data: plans, meta: { total: plans.length } });
  });
}
