/**
 * SemanticQueryBuilder
 *
 * Responsável por converter o perfil completo do paciente em um texto
 * semântico rico, otimizado para geração de embeddings de alta qualidade.
 *
 * Princípio central: modelos de embedding são treinados em linguagem natural.
 * Quanto mais rico e contextualizado o texto, mais precisos serão os
 * alimentos recuperados via cosine similarity no pgvector.
 *
 * SOLID aplicado:
 *   - Single Responsibility: esta classe só monta queries de embedding
 *   - Open/Closed: novos objetivos clínicos são adicionados em CLINICAL_HINTS
 *     sem modificar a lógica central
 *   - Dependency Inversion: depende apenas de tipos do domain
 */

import { Patient, ActivityLevel } from '../entities/Patient';
import { MacroTargets, MealType, MEAL_LABELS } from '../entities/DietPlan';
import { PatientRestriction } from '../entities/Patient';

// ─── Tipos internos ────────────────────────────────────────────────────────────

interface SemanticQueryInput {
  patient: Patient;
  macroTargets: MacroTargets;
  objectives: string;
  mealTypes: MealType[];
  extraContext?: string;
}

interface SemanticQueryResult {
  /** Texto completo para embedding — enviado ao IEmbeddingService */
  fullText: string;
  /** Seções individuais para debug e logging */
  sections: {
    biometrics: string;
    objectives: string;
    macros: string;
    activity: string;
    restrictions: string;
    meals: string;
    cultural: string;
    clinical: string;
    micronutrients: string;
    avoidances: string;
  };
  /** Metadados sobre a query gerada */
  meta: {
    hasRestrictions: boolean;
    hasClinicalCondition: boolean;
    objectiveType: ObjectiveType;
    estimatedComplexity: 'simple' | 'moderate' | 'complex';
  };
}

type ObjectiveType =
  | 'weight_loss'
  | 'muscle_gain'
  | 'maintenance'
  | 'glycemic_control'
  | 'cardiovascular'
  | 'renal'
  | 'sports_performance'
  | 'general';

// ─── Mapa de hints clínicos ────────────────────────────────────────────────────
// Cada entrada mapeia palavras-chave do objetivo para vocabulário semântico
// que enriquece a query de embedding.

const CLINICAL_HINTS: Record<ObjectiveType, string[]> = {
  weight_loss: [
    'alimentos com alto volume e baixa densidade calórica',
    'vegetais folhosos, legumes, fibras alimentares',
    'proteína magra para saciedade: frango, peixe, claras de ovo',
    'evitar ultraprocessados, açúcar refinado, gorduras saturadas',
    'alimentos termogênicos naturais: chá verde, gengibre, pimenta',
    'carboidratos de baixo índice glicêmico: aveia, batata-doce, arroz integral',
  ],
  muscle_gain: [
    'proteína completa de alto valor biológico: whey, frango, ovo, carne magra',
    'aminoácidos essenciais e BCAAs naturais',
    'carboidratos complexos para glicogênio muscular: batata-doce, arroz, macarrão integral',
    'gorduras saudáveis para produção de testosterona: azeite, abacate, oleaginosas',
    'alimentos ricos em creatina natural: carne vermelha magra',
    'micronutrientes para síntese proteica: zinco, magnésio, vitamina D',
  ],
  maintenance: [
    'alimentação equilibrada e variada',
    'todos os grupos alimentares em proporções adequadas',
    'alimentos in natura e minimamente processados',
    'variedade de cores no prato: vegetais, frutas, legumes',
  ],
  glycemic_control: [
    'alimentos com baixo índice glicêmico e baixa carga glicêmica',
    'fibras solúveis para controle da glicemia: aveia, feijão, lentilha, maçã',
    'proteína em todas as refeições para estabilidade glicêmica',
    'evitar açúcar simples, mel, sucos de fruta, carboidratos refinados',
    'gorduras saudáveis que não elevam a glicemia',
    'canela, cromo, magnésio: micronutrientes para sensibilidade à insulina',
    'refeições fracionadas e porções moderadas de carboidrato',
  ],
  cardiovascular: [
    'alimentos cardioprotetores: ômega-3, fibras solúveis, antioxidantes',
    'peixes gordurosos: salmão, sardinha, atum, cavalinha',
    'azeite de oliva extravirgem, abacate, oleaginosas',
    'fibras solúveis para redução do LDL: aveia, psyllium, leguminosas',
    'frutas vermelhas e roxas ricas em antioxidantes',
    'redução de sódio: evitar embutidos, enlatados, ultraprocessados',
    'potássio e magnésio: banana, abacate, feijão, espinafre',
    'evitar gorduras trans e saturadas: carnes gordas, manteiga em excesso',
  ],
  renal: [
    'controle rigoroso de potássio, fósforo e sódio',
    'proteína de alto valor biológico em quantidade controlada',
    'evitar alimentos ricos em potássio: banana, laranja, tomate cru',
    'evitar alimentos ricos em fósforo: laticínios, leguminosas, nozes',
    'arroz branco, macarrão, pão francês como fontes de carboidrato',
    'cozimento prolongado para redução de potássio nos vegetais',
    'hidratação controlada conforme prescrição médica',
  ],
  sports_performance: [
    'nutrição periodizada conforme treino',
    'carboidratos de rápida absorção no pré e pós-treino',
    'proteína de rápida digestão pós-treino: ovo, frango, peixe',
    'hidratação e eletrólitos: sódio, potássio, magnésio',
    'alimentos anti-inflamatórios para recuperação muscular',
    'ferro e vitamina B12 para transporte de oxigênio',
    'antioxidantes para redução do estresse oxidativo do exercício',
  ],
  general: [
    'alimentação saudável e equilibrada',
    'variedade de nutrientes essenciais',
    'alimentos naturais e minimamente processados',
  ],
};

// ─── Mapa de restrições → vocabulário de exclusão ─────────────────────────────

const RESTRICTION_VOCABULARY: Record<string, string[]> = {
  lactose: [
    'sem lactose, evitar leite de vaca, queijo, iogurte convencional, manteiga',
    'alternativas: bebida vegetal de amêndoa, aveia, arroz, coco; iogurte de coco',
    'fontes alternativas de cálcio: brócolis, couve, sardinha com osso, tofu',
  ],
  glúten: [
    'sem glúten, evitar trigo, cevada, centeio, malte, aveia contaminada',
    'alternativas: arroz, milho, mandioca, batata, quinoa, amaranto, tapioca',
    'farinhas sem glúten: arroz, mandioca, milho, grão-de-bico, amêndoa',
  ],
  'frutos do mar': [
    'evitar camarão, lagosta, caranguejo, mariscos, ostras',
    'fontes alternativas de ômega-3: sardinha, salmão, linhaça, chia',
  ],
  amendoim: [
    'evitar amendoim e derivados: pasta de amendoim, óleo de amendoim',
    'alternativas: pasta de amêndoa, pasta de castanha de caju, tahine',
  ],
  ovo: [
    'evitar ovos e derivados em preparações',
    'alternativas proteicas: leguminosas, tofu, quinoa, frango, peixe',
  ],
  vegano: [
    'alimentação 100% plant-based, sem nenhum produto de origem animal',
    'proteína vegetal completa: combinação arroz+feijão, quinoa, tofu, tempeh, edamame',
    'vitamina B12: necessita suplementação; fontes: alimentos fortificados',
    'ferro não-heme: feijão, lentilha, espinafre + vitamina C para absorção',
    'cálcio vegetal: brócolis, couve, tofu com cálcio, bebidas vegetais fortificadas',
    'ômega-3: linhaça, chia, nozes, óleo de canola',
  ],
  vegetariano: [
    'sem carnes vermelhas, aves ou peixes',
    'proteína: ovos, laticínios, leguminosas, tofu, tempeh, quinoa',
    'ferro não-heme com vitamina C para melhor absorção',
  ],
  diabetes: [
    'controle glicêmico rigoroso, índice glicêmico baixo',
    'distribuição uniforme de carboidratos ao longo do dia',
    'fibras em todas as refeições para retardar absorção de glicose',
  ],
  hipertensão: [
    'restrição de sódio abaixo de 2g/dia',
    'evitar embutidos, enlatados, molhos prontos, fast food',
    'alimentos ricos em potássio para pressão arterial: banana, abacate, batata',
  ],
};

// ─── Descrições de nível de atividade ─────────────────────────────────────────

const ACTIVITY_DESCRIPTIONS: Record<ActivityLevel, string> = {
  sedentary:   'sedentário, trabalho em mesa, sem exercício regular',
  light:       'levemente ativo, exercício leve 1 a 3 vezes por semana',
  moderate:    'moderadamente ativo, exercício moderado 3 a 5 vezes por semana',
  active:      'muito ativo, exercício intenso 6 a 7 vezes por semana',
  very_active: 'extremamente ativo, trabalho físico intenso e treino diário',
};

// ─── Classe principal ──────────────────────────────────────────────────────────

export class SemanticQueryBuilder {

  build(input: SemanticQueryInput): SemanticQueryResult {
    const { patient, macroTargets, objectives, mealTypes, extraContext } = input;

    const objectiveType = this.detectObjectiveType(objectives);
    const consultation  = patient.lastConsultation!;

    // Montar cada seção independentemente
    const sections = {
      biometrics:     this.buildBiometrics(patient, consultation.weightKg),
      objectives:     this.buildObjectives(objectives, objectiveType),
      macros:         this.buildMacros(macroTargets),
      activity:       this.buildActivity(patient.activityLevel),
      restrictions:   this.buildRestrictions(patient.restrictions),
      meals:          this.buildMeals(mealTypes),
      cultural:       this.buildCultural(patient),
      clinical:       this.buildClinicalHints(objectiveType, patient),
      micronutrients: this.buildMicronutrientFocus(objectiveType, patient),
      avoidances:     this.buildAvoidances(patient),
    };

    // Concatenar na ordem de importância para o embedding
    const parts = [
      sections.objectives,       // objetivo primeiro — ancora o contexto semântico
      sections.biometrics,       // dados físicos
      sections.macros,           // metas nutricionais quantitativas
      sections.activity,         // nível de atividade
      sections.restrictions,     // restrições são críticas
      sections.clinical,         // hints clínicos específicos do objetivo
      sections.micronutrients,   // foco em micronutrientes
      sections.meals,            // estrutura de refeições
      sections.cultural,         // preferências culturais
      sections.avoidances,       // alimentos a evitar explicitamente
      extraContext ?? '',        // contexto livre do nutricionista
    ].filter(Boolean);

    const fullText = parts.join(' ');

    return {
      fullText,
      sections,
      meta: {
        hasRestrictions:      patient.restrictions.length > 0,
        hasClinicalCondition: this.hasClinicalCondition(patient.restrictions),
        objectiveType,
        estimatedComplexity:  this.estimateComplexity(patient, objectiveType),
      },
    };
  }

  // ─── Seção: biometria ────────────────────────────────────────────────────────

  private buildBiometrics(patient: Patient, weightKg: number): string {
    const consultation = patient.lastConsultation!;
    const age = this.calculateAge(patient.birthDate);
    const bmi = weightKg / Math.pow(patient.heightCm / 100, 2);
    const bmiCategory = this.bmiCategory(bmi);
    const sexLabel = patient.sex === 'M' ? 'masculino' : 'feminino';

    const parts = [
      `Paciente ${sexLabel}, ${age} anos, peso ${weightKg}kg, altura ${patient.heightCm}cm, IMC ${bmi.toFixed(1)} (${bmiCategory}).`,
    ];

    if (consultation.bodyFatPct) {
      const fatCategory = this.bodyFatCategory(consultation.bodyFatPct, patient.sex);
      parts.push(
        `Composição corporal: ${consultation.bodyFatPct}% de gordura corporal (${fatCategory})` +
        (consultation.muscleMassKg
          ? `, ${consultation.muscleMassKg}kg de massa muscular.`
          : '.')
      );
    }

    // Contexto menstrual relevante para mulheres (impacta necessidades de ferro)
    if (patient.sex === 'F' && age < 50) {
      parts.push('Mulher em idade fértil: necessidades aumentadas de ferro e ácido fólico.');
    }

    // Contexto para idosos (>= 60 anos)
    if (age >= 60) {
      parts.push(
        'Paciente idoso: maior necessidade de proteína para prevenção de sarcopenia, ' +
        'vitamina D, cálcio e vitamina B12.'
      );
    }

    return parts.join(' ');
  }

  // ─── Seção: objetivos ────────────────────────────────────────────────────────

  private buildObjectives(objectives: string, type: ObjectiveType): string {
    const typeLabels: Record<ObjectiveType, string> = {
      weight_loss:        'perda de peso e emagrecimento',
      muscle_gain:        'ganho de massa muscular e hipertrofia',
      maintenance:        'manutenção do peso e saúde geral',
      glycemic_control:   'controle glicêmico e manejo do diabetes',
      cardiovascular:     'saúde cardiovascular e controle de dislipidemia',
      renal:              'proteção renal e manejo da doença renal crônica',
      sports_performance: 'performance esportiva e otimização do treino',
      general:            'alimentação saudável e equilibrada',
    };

    return (
      `Objetivo principal: ${typeLabels[type]}. ` +
      `Descrição detalhada: ${objectives}.`
    );
  }

  // ─── Seção: macros ───────────────────────────────────────────────────────────

  private buildMacros(macros: MacroTargets): string {
    // Proporção proteína por kg é relevante semanticamente
    return [
      `Metas nutricionais diárias: ${macros.kcal} kcal totais.`,
      `Proteína: ${macros.proteinG}g (${macros.proteinPct}% das calorias).`,
      `Carboidratos: ${macros.carbsG}g (${macros.carbsPct}% das calorias).`,
      `Gorduras: ${macros.fatG}g (${macros.fatPct}% das calorias).`,
      `Distribuição de macros: ${
        macros.proteinPct >= 30 ? 'alto teor proteico' :
        macros.proteinPct <= 15 ? 'baixo teor proteico' : 'proteína moderada'
      }, ${
        macros.carbsPct >= 50 ? 'alto teor de carboidratos' :
        macros.carbsPct <= 30 ? 'baixo carboidrato' : 'carboidrato moderado'
      }, ${
        macros.fatPct >= 35 ? 'alto teor de gordura' :
        macros.fatPct <= 20 ? 'baixo teor de gordura' : 'gordura moderada'
      }.`,
    ].join(' ');
  }

  // ─── Seção: atividade física ─────────────────────────────────────────────────

  private buildActivity(level: ActivityLevel): string {
    const description = ACTIVITY_DESCRIPTIONS[level];
    const timingHint = this.activityTimingHint(level);
    return `Nível de atividade física: ${description}. ${timingHint}`;
  }

  private activityTimingHint(level: ActivityLevel): string {
    if (level === 'active' || level === 'very_active') {
      return (
        'Refeição pré-treino: carboidrato de fácil digestão 1-2h antes. ' +
        'Refeição pós-treino: proteína + carboidrato em até 30 min após o exercício.'
      );
    }
    if (level === 'moderate') {
      return 'Distribuição calórica equilibrada ao longo do dia.';
    }
    return 'Refeições leves e fracionadas para evitar sobrecarga digestiva.';
  }

  // ─── Seção: restrições ───────────────────────────────────────────────────────

  private buildRestrictions(restrictions: PatientRestriction[]): string {
    if (restrictions.length === 0) {
      return 'Sem restrições alimentares cadastradas.';
    }

    const parts = ['Restrições alimentares obrigatórias:'];

    for (const restriction of restrictions) {
      const key = Object.keys(RESTRICTION_VOCABULARY).find(k =>
        restriction.description.toLowerCase().includes(k)
      );

      const vocabulary = key ? (RESTRICTION_VOCABULARY[key] ?? []) : [];

      parts.push(
        `[${restriction.type.toUpperCase()}] ${restriction.description}.` +
        (vocabulary.length ? ' ' + vocabulary.join('; ') + '.' : '')
      );
    }

    return parts.join(' ');
  }

  // ─── Seção: hints clínicos ───────────────────────────────────────────────────

  private buildClinicalHints(
    objectiveType: ObjectiveType,
    patient: Patient,
  ): string {
    const baseHints = CLINICAL_HINTS[objectiveType] ?? CLINICAL_HINTS.general;

    // Adicionar hints extras baseados em condições clínicas das restrições
    const extraHints: string[] = [];

    for (const restriction of patient.restrictions) {
      if (restriction.type === 'clinical') {
        const desc = restriction.description.toLowerCase();

        if (desc.includes('síndrome do intestino irritável') || desc.includes('sii')) {
          extraHints.push(
            'dieta low FODMAP: evitar trigo, cebola, alho, leguminosas em excesso, ' +
            'lactose, frutose em excesso; preferir alimentos de baixo FODMAP'
          );
        }
        if (desc.includes('hipotireoidismo')) {
          extraHints.push(
            'evitar alimentos bociogênicos crus em excesso: brócolis, couve-flor, repolho; ' +
            'alimentos ricos em selênio e zinco: castanha-do-pará, sementes de abóbora'
          );
        }
        if (desc.includes('anemia')) {
          extraHints.push(
            'alimentos ricos em ferro heme: carne vermelha magra, fígado; ' +
            'ferro não-heme + vitamina C: feijão com laranja, lentilha com limão; ' +
            'vitamina B12: carne, ovo, peixe; ácido fólico: folhas verdes escuras'
          );
        }
        if (desc.includes('gota') || desc.includes('ácido úrico')) {
          extraHints.push(
            'baixo teor de purinas: evitar vísceras, frutos do mar, carne vermelha em excesso; ' +
            'aumentar hidratação; cerejas e frutas vermelhas têm efeito protetor'
          );
        }
        if (desc.includes('osteoporose') || desc.includes('osteopenia')) {
          extraHints.push(
            'alto teor de cálcio: laticínios, brócolis, couve, tofu, sardinha com osso; ' +
            'vitamina D: peixes gordurosos, ovos, alimentos fortificados; ' +
            'vitamina K2: fermentados, natto, queijos; proteína adequada para massa óssea'
          );
        }
      }
    }

    const allHints = [...baseHints, ...extraHints];
    return `Diretrizes clínicas para ${objectiveType}: ${allHints.join('; ')}.`;
  }

  // ─── Seção: foco em micronutrientes ─────────────────────────────────────────

  private buildMicronutrientFocus(
    objectiveType: ObjectiveType,
    patient: Patient,
  ): string {
    const age = this.calculateAge(patient.birthDate);
    const microFocus: string[] = [];

    // Por objetivo
    if (objectiveType === 'muscle_gain') {
      microFocus.push('zinco, magnésio, vitamina D, vitamina B6 para síntese proteica');
    }
    if (objectiveType === 'weight_loss') {
      microFocus.push('ferro, vitamina C, B12, ácido fólico — risco de deficiência em dietas restritivas');
    }
    if (objectiveType === 'glycemic_control') {
      microFocus.push('cromo, magnésio, vitamina D, ômega-3 para sensibilidade à insulina');
    }
    if (objectiveType === 'cardiovascular') {
      microFocus.push('ômega-3, coenzima Q10, magnésio, potássio, vitamina E, antioxidantes');
    }

    // Por faixa etária
    if (age >= 50) {
      microFocus.push('vitamina B12 (absorção reduzida), vitamina D, cálcio, magnésio');
    }
    if (patient.sex === 'F' && age < 50) {
      microFocus.push('ferro, ácido fólico, cálcio, vitamina D');
    }

    // Por restrições que criam riscos de deficiência
    const hasLactoseRestriction = patient.restrictions.some(r =>
      r.description.toLowerCase().includes('lactose')
    );
    const isVegan = patient.restrictions.some(r =>
      r.description.toLowerCase().includes('vegano')
    );

    if (hasLactoseRestriction) {
      microFocus.push('cálcio e vitamina D — risco de deficiência por restrição de laticínios');
    }
    if (isVegan) {
      microFocus.push('B12, ferro, zinco, cálcio, ômega-3, iodo, vitamina D — risco aumentado em dieta vegana');
    }

    if (microFocus.length === 0) return '';

    return `Foco em micronutrientes: ${microFocus.join('; ')}.`;
  }

  // ─── Seção: refeições ────────────────────────────────────────────────────────

  private buildMeals(mealTypes: MealType[]): string {
    const mealLabels = mealTypes.map(m => MEAL_LABELS[m]).join(', ');
    const count = mealTypes.length;
    return (
      `Estrutura de ${count} refeições diárias: ${mealLabels}. ` +
      `${count >= 5 ? 'Fracionamento adequado para controle glicêmico e saciedade.' : ''}`
    );
  }

  // ─── Seção: preferências culturais e rotina ──────────────────────────────────

  private buildCultural(patient: Patient): string {
    const parts: string[] = [];

    if (patient.culturalPreferences) {
      parts.push(`Preferências culturais e culinárias: ${patient.culturalPreferences}.`);
    }

    if (patient.routineNotes) {
      parts.push(`Rotina e estilo de vida: ${patient.routineNotes}.`);
      // Hints baseados em rotina
      const routine = patient.routineNotes.toLowerCase();
      if (routine.includes('6h') || routine.includes('cedo') || routine.includes('manhã')) {
        parts.push('Café da manhã mais substancial — maior janela de gasto energético no período matutino.');
      }
      if (routine.includes('tardio') || routine.includes('jantar tarde') || routine.includes('23h') || routine.includes('22h')) {
        parts.push('Jantar leve e de fácil digestão — menor gasto energético no período noturno.');
      }
      if (routine.includes('viagem') || routine.includes('restaurante') || routine.includes('fora de casa')) {
        parts.push('Refeições práticas e adaptáveis para consumo fora de casa.');
      }
    }

    if (patient.dislikedFoods?.length) {
      parts.push(`Alimentos que o paciente não aprecia: ${patient.dislikedFoods.join(', ')} — evitar nas sugestões.`);
    }

    return parts.join(' ');
  }

  // ─── Seção: evitações explícitas ─────────────────────────────────────────────

  private buildAvoidances(patient: Patient): string {
    const avoidances: string[] = [];

    for (const restriction of patient.restrictions) {
      const desc = restriction.description.toLowerCase();
      const key = Object.keys(RESTRICTION_VOCABULARY).find(k => desc.includes(k));
      if (key) {
        avoidances.push(`evitar ${key} e derivados`);
      }
    }

    if (patient.dislikedFoods?.length) {
      avoidances.push(`não incluir: ${patient.dislikedFoods.join(', ')}`);
    }

    return avoidances.length
      ? `Exclusões obrigatórias: ${avoidances.join('; ')}.`
      : '';
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private detectObjectiveType(objectives: string): ObjectiveType {
    const obj = objectives.toLowerCase();
    if (obj.match(/emagrecimento|perda de peso|deficit|emagrecer|gordura/))   return 'weight_loss';
    if (obj.match(/hipertrofia|massa muscular|ganho de massa|musculação/))      return 'muscle_gain';
    if (obj.match(/diabetes|glicemi|glicose|insulina|hba1c/))                  return 'glycemic_control';
    if (obj.match(/cardio|coração|colesterol|triglicerídeos|pressão|hdl|ldl/)) return 'cardiovascular';
    if (obj.match(/renal|rim|creatinina|ureia|trs|diálise/))                   return 'renal';
    if (obj.match(/esporte|atleta|performance|rendimento|competição/))          return 'sports_performance';
    if (obj.match(/manutenção|manter|equilibri/))                               return 'maintenance';
    return 'general';
  }

  private hasClinicalCondition(restrictions: PatientRestriction[]): boolean {
    return restrictions.some(r => r.type === 'clinical');
  }

  private estimateComplexity(
    patient: Patient,
    objectiveType: ObjectiveType,
  ): 'simple' | 'moderate' | 'complex' {
    const restrictionCount = patient.restrictions.length;
    const isClinical = this.hasClinicalCondition(patient.restrictions);
    const isComplexObjective = ['glycemic_control', 'renal', 'cardiovascular'].includes(objectiveType);

    if (restrictionCount >= 3 || (isClinical && isComplexObjective)) return 'complex';
    if (restrictionCount >= 1 || isClinical || isComplexObjective) return 'moderate';
    return 'simple';
  }

  private calculateAge(birthDate: Date): number {
    return Math.floor(
      (Date.now() - birthDate.getTime()) / (365.25 * 24 * 3600 * 1000)
    );
  }

  private bmiCategory(bmi: number): string {
    if (bmi < 18.5) return 'abaixo do peso';
    if (bmi < 25)   return 'peso normal';
    if (bmi < 30)   return 'sobrepeso';
    if (bmi < 35)   return 'obesidade grau I';
    if (bmi < 40)   return 'obesidade grau II';
    return 'obesidade grau III';
  }

  private bodyFatCategory(pct: number, sex: 'M' | 'F'): string {
    if (sex === 'M') {
      if (pct < 6)  return 'essencial';
      if (pct < 14) return 'atlético';
      if (pct < 18) return 'fitness';
      if (pct < 25) return 'aceitável';
      return 'obesidade';
    } else {
      if (pct < 14) return 'essencial';
      if (pct < 21) return 'atlético';
      if (pct < 25) return 'fitness';
      if (pct < 32) return 'aceitável';
      return 'obesidade';
    }
  }
}