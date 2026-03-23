import { describe, it, expect } from 'vitest';
import { SemanticQueryBuilder } from '../../use-cases/SemanticQueryBuilder';
import { Patient } from '../../entities/Patient';
import { MacroTargets, MealType } from '../../entities/DietPlan';

// ─── Factories ────────────────────────────────────────────────────────────────../

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'patient-1',
    name: 'Maria Costa',
    birthDate: new Date('1992-03-15'),   // ~32 anos
    sex: 'F',
    heightCm: 165,
    activityLevel: 'moderate',
    restrictions: [],
    culturalPreferences: 'culinária brasileira',
    routineNotes: 'treina às 6h da manhã, jantar tardio às 22h',
    dislikedFoods: ['fígado', 'beterraba'],
    lastConsultation: {
      id: 'consult-1',
      date: new Date(),
      weightKg: 72,
      bodyFatPct: 28,
      muscleMassKg: 45,
      notes: 'Paciente motivada, boa adesão',
    },
    ...overrides,
  };
}

function makeMacros(overrides: Partial<MacroTargets> = {}): MacroTargets {
  return {
    kcal: 1450,
    proteinG: 109,  carbsG: 163,  fatG: 40,
    proteinPct: 30, carbsPct: 45, fatPct: 25,
    ...overrides,
  };
}

const DEFAULT_MEALS: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner'];

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('SemanticQueryBuilder', () => {
  const builder = new SemanticQueryBuilder();

  // ── Estrutura do resultado ─────────────────────────────────────────────────

  it('retorna todas as seções esperadas', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento saudável',
      mealTypes:    DEFAULT_MEALS,
    });

    expect(result.fullText).toBeTruthy();
    expect(result.sections.biometrics).toBeTruthy();
    expect(result.sections.objectives).toBeTruthy();
    expect(result.sections.macros).toBeTruthy();
    expect(result.sections.clinical).toBeTruthy();
    expect(result.meta.objectiveType).toBe('weight_loss');
  });

  it('fullText concatena todas as seções não-vazias', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });

    // Verificar que os conteúdos das seções estão no texto completo
    expect(result.fullText).toContain('emagrecimento');
    expect(result.fullText).toContain('Maria');
    expect(result.fullText).toContain('1450');
    expect(result.fullText).toContain('culinária brasileira');
  });

  // ── Detecção de objetivo ───────────────────────────────────────────────────

  it.each([
    ['emagrecimento e perda de gordura', 'weight_loss'],
    ['hipertrofia e ganho de massa muscular', 'muscle_gain'],
    ['controle glicêmico diabetes tipo 2', 'glycemic_control'],
    ['saúde cardiovascular e colesterol', 'cardiovascular'],
    ['doença renal crônica proteção renal', 'renal'],
    ['performance esportiva atleta', 'sports_performance'],
    ['manutenção do peso', 'maintenance'],
    ['alimentação saudável', 'general'],
  ])('detecta objetivo "%s" como "%s"', (objective, expected) => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   objective,
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.meta.objectiveType).toBe(expected);
  });

  // ── Biometria ──────────────────────────────────────────────────────────────

  it('inclui IMC calculado na seção de biometria', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });
    // IMC = 72 / (1.65^2) = 26.4
    expect(result.sections.biometrics).toContain('26.4');
    expect(result.sections.biometrics).toContain('sobrepeso');
  });

  it('inclui composição corporal quando disponível', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.biometrics).toContain('28%');
    expect(result.sections.biometrics).toContain('45kg de massa muscular');
  });

  it('menciona necessidades especiais para paciente idoso (>= 60 anos)', () => {
    const idoso = makePatient({ birthDate: new Date('1950-01-01') });
    const result = builder.build({
      patient:      idoso,
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.biometrics).toContain('sarcopenia');
    expect(result.sections.biometrics).toContain('vitamina D');
  });

  it('menciona ferro e ácido fólico para mulher em idade fértil', () => {
    const result = builder.build({
      patient:      makePatient({ sex: 'F', birthDate: new Date('1995-01-01') }),
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.biometrics).toContain('ferro');
    expect(result.sections.biometrics).toContain('ácido fólico');
  });

  // ── Macros ─────────────────────────────────────────────────────────────────

  it('descreve distribuição de macros em linguagem natural', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros({ proteinPct: 35, carbsPct: 40, fatPct: 25 }),
      objectives:   'hipertrofia',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.macros).toContain('alto teor proteico');
  });

  it('indica baixo carboidrato quando carbsPct <= 30%', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros({ proteinPct: 40, carbsPct: 25, fatPct: 35 }),
      objectives:   'controle glicêmico diabetes',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.macros).toContain('baixo carboidrato');
  });

  // ── Restrições ─────────────────────────────────────────────────────────────

  it('inclui vocabulário de exclusão para intolerância à lactose', () => {
    const patient = makePatient({
      restrictions: [{ id: 'r1', type: 'intolerance', description: 'Intolerância à lactose' }],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.restrictions).toContain('leite de vaca');
    expect(result.sections.restrictions).toContain('bebida vegetal');
    expect(result.sections.restrictions).toContain('cálcio');
    expect(result.sections.avoidances).toContain('lactose');
  });

  it('inclui vocabulário correto para restrição de glúten', () => {
    const patient = makePatient({
      restrictions: [{ id: 'r2', type: 'allergy', description: 'Doença celíaca — sem glúten' }],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.restrictions).toContain('trigo');
    expect(result.sections.restrictions).toContain('quinoa');
    expect(result.sections.restrictions).toContain('mandioca');
  });

  it('inclui vocabulário plant-based completo para vegano', () => {
    const patient = makePatient({
      restrictions: [{ id: 'r3', type: 'preference', description: 'Vegano — sem produtos de origem animal' }],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'hipertrofia',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.restrictions).toContain('plant-based');
    expect(result.sections.restrictions).toContain('quinoa');
    expect(result.sections.restrictions).toContain('B12');
  });

  it('indica "sem restrições" quando lista está vazia', () => {
    const result = builder.build({
      patient:      makePatient({ restrictions: [] }),
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.restrictions).toContain('Sem restrições alimentares');
    expect(result.meta.hasRestrictions).toBe(false);
  });

  // ── Hints clínicos ─────────────────────────────────────────────────────────

  it('inclui fibras solúveis para objetivo de controle glicêmico', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'controle glicêmico diabetes tipo 2',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.clinical).toContain('fibras solúveis');
    expect(result.sections.clinical).toContain('índice glicêmico');
  });

  it('inclui ômega-3 para objetivo cardiovascular', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'saúde cardiovascular e redução de colesterol LDL',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.clinical).toContain('ômega-3');
    expect(result.sections.clinical).toContain('salmão');
  });

  it('inclui hint de low FODMAP para SII', () => {
    const patient = makePatient({
      restrictions: [{
        id: 'r4', type: 'clinical',
        description: 'Síndrome do intestino irritável (SII)',
      }],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'manutenção e conforto digestivo',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.clinical).toContain('FODMAP');
  });

  // ── Micronutrientes ────────────────────────────────────────────────────────

  it('alerta sobre risco de deficiência de B12 para vegano', () => {
    const patient = makePatient({
      restrictions: [{ id: 'r5', type: 'preference', description: 'Vegano' }],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.micronutrients).toContain('B12');
    expect(result.sections.micronutrients).toContain('vegana');
  });

  it('inclui zinco e magnésio para objetivo de hipertrofia', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'hipertrofia ganho de massa muscular',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.micronutrients).toContain('zinco');
    expect(result.sections.micronutrients).toContain('magnésio');
  });

  // ── Rotina e preferências culturais ──────────────────────────────────────

  it('inclui hint de café da manhã substancial para quem treina cedo', () => {
    const result = builder.build({
      patient:      makePatient({ routineNotes: 'treina às 6h da manhã' }),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.cultural).toContain('café da manhã');
    expect(result.sections.cultural).toContain('matutino');
  });

  it('inclui hint de jantar leve para quem janta tarde', () => {
    const result = builder.build({
      patient:      makePatient({ routineNotes: 'jantar tardio às 22h' }),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.cultural).toContain('jantar leve');
  });

  it('lista alimentos que o paciente não gosta', () => {
    const result = builder.build({
      patient:      makePatient({ dislikedFoods: ['fígado', 'beterraba'] }),
      macroTargets: makeMacros(),
      objectives:   'manutenção',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.sections.cultural).toContain('fígado');
    expect(result.sections.cultural).toContain('beterraba');
    expect(result.sections.avoidances).toContain('fígado');
  });

  // ── Complexidade ───────────────────────────────────────────────────────────

  it('estima complexidade simples para paciente sem restrições e objetivo geral', () => {
    const result = builder.build({
      patient:      makePatient({ restrictions: [] }),
      macroTargets: makeMacros(),
      objectives:   'alimentação saudável',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.meta.estimatedComplexity).toBe('simple');
  });

  it('estima complexidade complexa para múltiplas restrições com condição clínica', () => {
    const patient = makePatient({
      restrictions: [
        { id: 'r1', type: 'intolerance', description: 'Intolerância à lactose' },
        { id: 'r2', type: 'clinical',    description: 'Diabetes tipo 2' },
        { id: 'r3', type: 'allergy',     description: 'Alergia a amendoim' },
      ],
    });
    const result = builder.build({
      patient,
      macroTargets: makeMacros(),
      objectives:   'controle glicêmico diabetes',
      mealTypes:    DEFAULT_MEALS,
    });
    expect(result.meta.estimatedComplexity).toBe('complex');
    expect(result.meta.hasClinicalCondition).toBe(true);
  });

  // ── Extra context ──────────────────────────────────────────────────────────

  it('inclui contexto extra do nutricionista no fullText', () => {
    const result = builder.build({
      patient:      makePatient(),
      macroTargets: makeMacros(),
      objectives:   'emagrecimento',
      mealTypes:    DEFAULT_MEALS,
      extraContext: 'Paciente relata dificuldade em comer cedo pela manhã.',
    });
    expect(result.fullText).toContain('dificuldade em comer cedo');
  });
});