import { FastifyInstance } from 'fastify';
import {
  AppError,
  CreatePatientSchema,
  UpdatePatientSchema,
  AddConsultationSchema,
} from '@nutriplan/shared';
import { RegisterPatientUseCase }   from '@nutriplan/domain';
import { PgPatientRepository }      from '../../infrastructure/repositories/PgPatientRepository';
import { PgNutritionistRepository, PgUserRepository } from '../../infrastructure/repositories/PgUserRepository';
import { PgConsultationRepository } from '../../infrastructure/repositories/PgConsultationRepository';
import { PgDietPlanRepository }     from '../../infrastructure/repositories/PgDietPlanRepository';
import { BcryptPasswordHasher }     from '../../infrastructure/services/BcryptPasswordHasher';
import { authenticate }             from '../middlewares/authenticate';

// ─── Schemas reutilizáveis ─────────────────────────────────────────────────────

const restrictionSchema = {
  type: 'object',
  properties: {
    type:        { type: 'string', enum: ['allergy', 'intolerance', 'clinical', 'preference'] },
    description: { type: 'string' },
  },
} as const;

const patientSchema = {
  type: 'object',
  properties: {
    id:                  { type: 'string' },
    nutritionistId:      { type: 'string' },
    userId:              { type: 'string' },
    name:                { type: 'string' },
    birthDate:           { type: 'string' },
    sex:                 { type: 'string' },
    heightCm:            { type: 'integer' },
    activityLevel:       { type: 'string' },
    restrictions:        { type: 'array', items: restrictionSchema },
    culturalPreferences: { type: 'string' },
    routineNotes:        { type: 'string' },
    dislikedFoods:       { type: 'array', items: { type: 'string' } },
  },
} as const;

const consultationSchema = {
  type: 'object',
  properties: {
    id:            { type: 'string' },
    patientId:     { type: 'string' },
    nutritionistId:{ type: 'string' },
    date:          { type: 'string' },
    weightKg:      { type: 'number' },
    bodyFatPct:    { type: 'number' },
    muscleMassKg:  { type: 'number' },
    notes:         { type: 'string' },
    createdAt:     { type: 'string' },
  },
} as const;

// ─── Body schemas ──────────────────────────────────────────────────────────────

const createPatientBody = {
  type: 'object',
  required: ['name', 'birthDate', 'sex', 'heightCm', 'activityLevel'],
  properties: {
    name:                { type: 'string', minLength: 2, maxLength: 150 },
    birthDate:           { type: 'string', description: 'ISO date: YYYY-MM-DD' },
    sex:                 { type: 'string', enum: ['M', 'F'] },
    heightCm:            { type: 'integer', minimum: 50, maximum: 250 },
    activityLevel:       { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
    restrictions:        { type: 'array', items: restrictionSchema },
    culturalPreferences: { type: 'string', maxLength: 300 },
    routineNotes:        { type: 'string', maxLength: 500 },
    dislikedFoods:       { type: 'array', items: { type: 'string' } },
    email:               { type: 'string', format: 'email', description: 'Quando fornecido, cria conta de acesso ao app mobile' },
    password:            { type: 'string', minLength: 8, maxLength: 100, description: 'Obrigatório se email for informado' },
  },
} as const;

const updatePatientBody = {
  type: 'object',
  properties: {
    name:                { type: 'string', minLength: 2, maxLength: 150 },
    birthDate:           { type: 'string', description: 'ISO date: YYYY-MM-DD' },
    sex:                 { type: 'string', enum: ['M', 'F'] },
    heightCm:            { type: 'integer', minimum: 50, maximum: 250 },
    activityLevel:       { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
    restrictions:        { type: 'array', items: restrictionSchema },
    culturalPreferences: { type: 'string', maxLength: 300 },
    routineNotes:        { type: 'string', maxLength: 500 },
    dislikedFoods:       { type: 'array', items: { type: 'string' } },
  },
} as const;

const addConsultationBody = {
  type: 'object',
  required: ['weightKg'],
  properties: {
    date:          { type: 'string', description: 'ISO datetime (opcional, padrão: agora)' },
    weightKg:      { type: 'number', minimum: 20, maximum: 300 },
    bodyFatPct:    { type: 'number', minimum: 1, maximum: 70 },
    muscleMassKg:  { type: 'number', minimum: 5, maximum: 150 },
    notes:         { type: 'string', maxLength: 1000 },
  },
} as const;

export async function patientRoutes(app: FastifyInstance): Promise<void> {
  const patientRepo      = new PgPatientRepository();
  const nutritionistRepo = new PgNutritionistRepository();
  const userRepo         = new PgUserRepository();
  const consultationRepo = new PgConsultationRepository();
  const dietPlanRepo     = new PgDietPlanRepository();
  const passwordHasher   = new BcryptPasswordHasher();

  const registerPatientUseCase = new RegisterPatientUseCase(patientRepo, userRepo, passwordHasher);

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
      body:    createPatientBody,
      response: {
        201: { description: 'Paciente criado',    type: 'object', properties: { data: patientSchema } },
        400: { description: 'Erro de validação',  type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const parsed = CreatePatientSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Erro de validação', details: parsed.error.flatten() });
    }

    const nutritionistId = await getNutritionistId(request.user.sub);

    const { patient } = await registerPatientUseCase.execute({
      nutritionistId,
      name:                parsed.data.name,
      birthDate:           parsed.data.birthDate,
      sex:                 parsed.data.sex,
      heightCm:            parsed.data.heightCm,
      activityLevel:       parsed.data.activityLevel,
      restrictions:        parsed.data.restrictions,
      culturalPreferences: parsed.data.culturalPreferences,
      routineNotes:        parsed.data.routineNotes,
      dislikedFoods:       parsed.data.dislikedFoods,
      email:               parsed.data.email,
      password:            parsed.data.password,
    });

    return reply.status(201).send({ data: patient });
  });

  // ─── GET /patients ────────────────────────────────────────────────────────

  app.get('/', {
    schema: {
      tags:    ['Patients'],
      summary: 'Listar pacientes do nutricionista',
      response: {
        200: { description: 'Lista de pacientes', type: 'object', properties: { data: { type: 'array', items: patientSchema }, meta: { type: 'object', properties: { total: { type: 'integer' } } } } },
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
        200: { description: 'Paciente',         type: 'object', properties: { data: patientSchema } },
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
      body:    updatePatientBody,
      response: {
        200: { description: 'Paciente atualizado', type: 'object', properties: { data: patientSchema } },
        400: { description: 'Erro de validação',   type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } },
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
      body:    addConsultationBody,
      response: {
        201: { description: 'Consulta criada',   type: 'object', properties: { data: consultationSchema } },
        400: { description: 'Erro de validação', type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } },
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
        200: { description: 'Lista de consultas', type: 'object', properties: { data: { type: 'array', items: consultationSchema }, meta: { type: 'object', properties: { total: { type: 'integer' } } } } },
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
        200: { description: 'Lista de planos', type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { type: 'object', properties: { total: { type: 'integer' } } } } },
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
