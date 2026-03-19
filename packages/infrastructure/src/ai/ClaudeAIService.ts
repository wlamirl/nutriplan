/**
 * ClaudeAIService
 *
 * Infrastructure implementation of IAIService.
 * Assembles the full structured prompt and calls the Claude API.
 * Parses the JSON response into DietPlan domain entities.
 */

import { IAIService, GenerateDietPlanInput, GenerateDietPlanOutput } from '../../domain/src/services/interfaces';
import { DietPlan, DietMeal, MEAL_LABELS, calculateMealTotals } from '../../domain/src/entities/DietPlan';
import { Food, scaleNutrients } from '../../domain/src/entities/Food';
import { MacroTargets, MealType } from '../../domain/src/entities/DietPlan';
import { Patient } from '../../domain/src/entities/Patient';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ─── Raw AI response schema (before domain mapping) ───────────────────────────

interface RawMealItem {
  food_id: string;
  food_name: string;
  quantity_g: number;
}

interface RawMeal {
  meal_type: MealType;
  scheduled_time?: string;
  items: RawMealItem[];
  nutritionist_note?: string;
}

interface RawDietPlan {
  meals: RawMeal[];
  total_daily_kcal: number;
  total_daily_protein_g: number;
  total_daily_carbs_g: number;
  total_daily_fat_g: number;
}

// ─── Service implementation ───────────────────────────────────────────────────

export class ClaudeAIService implements IAIService {
  async generateDietPlan(input: GenerateDietPlanInput): Promise<GenerateDietPlanOutput> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt   = this.buildUserPrompt(input);

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error ${response.status}: ${error}`);
    }

    const data = await response.json();
    const rawText: string = data.content[0]?.text ?? '';

    // Strip markdown fences if Claude wrapped the JSON
    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const raw: RawDietPlan = JSON.parse(jsonText);

    // Build a food lookup map for O(1) nutrient access
    const foodMap = new Map<string, Food>(input.candidateFoods.map(f => [f.id, f]));

    // Map raw AI output to domain entities
    const meals: DietMeal[] = raw.meals.map(rawMeal => {
      const items = rawMeal.items.map(item => {
        const food = foodMap.get(item.food_id);
        if (!food) {
          throw new Error(
            `AI referenced unknown food id "${item.food_id}" (${item.food_name}). ` +
            'This food was not in the candidate list sent to the model.'
          );
        }
        return scaleNutrients(food, item.quantity_g);
      });

      const totals = calculateMealTotals(items);

      return {
        mealType:         rawMeal.meal_type,
        scheduledTime:    rawMeal.scheduled_time,
        items,
        nutritionistNote: rawMeal.nutritionist_note,
        ...totals,
      };
    });

    const plan: Omit<DietPlan, 'id' | 'patientId' | 'consultationId' | 'startDate' | 'endDate'> = {
      objectives:          input.objectives,
      macroTargets:        input.macroTargets,
      meals,
      totalDailyKcal:     raw.total_daily_kcal,
      totalDailyProteinG: raw.total_daily_protein_g,
      totalDailyCarbsG:   raw.total_daily_carbs_g,
      totalDailyFatG:     raw.total_daily_fat_g,
    };

    return {
      plan,
      rawResponse: rawText,
      usage: {
        model:            CLAUDE_MODEL,
        promptTokens:     data.usage?.input_tokens  ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  // ─── System prompt ─────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `
Você é um assistente especializado em nutrição clínica, trabalhando em parceria com nutricionistas.

Sua função é gerar planos alimentares personalizados e clinicamente adequados com base no perfil do paciente e na lista de alimentos candidatos fornecida.

REGRAS OBRIGATÓRIAS:
1. Use APENAS alimentos da lista de candidatos fornecida. Não invente alimentos.
2. Use os food_ids exatos fornecidos — nunca altere ou invente IDs.
3. As quantidades devem ser realistas (ex: arroz 80-150g, feijão 60-100g, frango 100-200g).
4. Respeite TODAS as restrições alimentares listadas no perfil. Ignorar restrições é um erro grave.
5. Distribua os macronutrientes de forma a atingir as metas dentro de ±10% de tolerância.
6. Considere a variedade: não repita o mesmo alimento em mais de 2 refeições do mesmo dia.
7. Inclua uma nota nutricional curta (nutritionist_note) em pelo menos 2 refeições.

FORMATO DE RESPOSTA:
Responda SOMENTE com um JSON válido, sem markdown, sem texto adicional, seguindo exatamente este schema:

{
  "meals": [
    {
      "meal_type": "breakfast",
      "scheduled_time": "07:30",
      "items": [
        { "food_id": "uuid-exato", "food_name": "Nome do alimento", "quantity_g": 40 }
      ],
      "nutritionist_note": "Observação opcional"
    }
  ],
  "total_daily_kcal": 1450,
  "total_daily_protein_g": 109,
  "total_daily_carbs_g": 163,
  "total_daily_fat_g": 40
}

Tipos de refeição válidos: breakfast, morning_snack, lunch, afternoon_snack, dinner, supper.
    `.trim();
  }

  // ─── User prompt ───────────────────────────────────────────────────────────

  private buildUserPrompt(input: GenerateDietPlanInput): string {
    const { patient, macroTargets, candidateFoods, mealTypes, objectives, extraContext } = input;

    const sections: string[] = [
      this.buildPatientSection(patient),
      this.buildMacroTargetsSection(macroTargets),
      this.buildRestrictionsSection(patient),
      this.buildMealsSection(mealTypes),
      this.buildFoodCatalogueSection(candidateFoods),
    ];

    if (extraContext) {
      sections.push(`## Observações do nutricionista\n${extraContext}`);
    }

    sections.push(
      `## Objetivo\n${objectives}`,
      '\nGere o plano alimentar completo seguindo todas as regras e o formato JSON especificado no system prompt.'
    );

    return sections.join('\n\n');
  }

  private buildPatientSection(patient: Patient): string {
    const consultation = patient.lastConsultation!;
    const age = Math.floor(
      (Date.now() - patient.birthDate.getTime()) / (365.25 * 24 * 3600 * 1000)
    );
    const bmi = (consultation.weightKg / Math.pow(patient.heightCm / 100, 2)).toFixed(1);

    return [
      '## Perfil do paciente',
      `- Nome: ${patient.name}`,
      `- Idade: ${age} anos`,
      `- Sexo: ${patient.sex === 'M' ? 'Masculino' : 'Feminino'}`,
      `- Peso atual: ${consultation.weightKg} kg`,
      `- Altura: ${patient.heightCm} cm`,
      `- IMC: ${bmi}`,
      consultation.bodyFatPct ? `- Gordura corporal: ${consultation.bodyFatPct}%` : '',
      consultation.muscleMassKg ? `- Massa muscular: ${consultation.muscleMassKg} kg` : '',
      `- Nível de atividade: ${patient.activityLevel}`,
      patient.culturalPreferences ? `- Preferências culturais: ${patient.culturalPreferences}` : '',
      patient.routineNotes ? `- Rotina: ${patient.routineNotes}` : '',
      patient.dislikedFoods?.length
        ? `- Alimentos que não gosta: ${patient.dislikedFoods.join(', ')}`
        : '',
      consultation.notes ? `- Notas da última consulta: ${consultation.notes}` : '',
    ].filter(Boolean).join('\n');
  }

  private buildMacroTargetsSection(macros: MacroTargets): string {
    return [
      '## Metas nutricionais diárias',
      `- Calorias: ${macros.kcal} kcal`,
      `- Proteína: ${macros.proteinG}g (${macros.proteinPct}% das calorias)`,
      `- Carboidratos: ${macros.carbsG}g (${macros.carbsPct}% das calorias)`,
      `- Gorduras: ${macros.fatG}g (${macros.fatPct}% das calorias)`,
    ].join('\n');
  }

  private buildRestrictionsSection(patient: Patient): string {
    if (!patient.restrictions.length) {
      return '## Restrições alimentares\nNenhuma restrição cadastrada.';
    }

    const lines = patient.restrictions.map(r =>
      `- [${r.type.toUpperCase()}] ${r.description}`
    );

    return ['## Restrições alimentares (OBRIGATÓRIO respeitar)', ...lines].join('\n');
  }

  private buildMealsSection(mealTypes: MealType[]): string {
    const lines = mealTypes.map(m => `- ${m} (${MEAL_LABELS[m]})`);
    return ['## Refeições a incluir no plano', ...lines].join('\n');
  }

  private buildFoodCatalogueSection(foods: Food[]): string {
    const header = `## Catálogo de alimentos candidatos (${foods.length} itens)\nUse APENAS estes alimentos com seus food_ids exatos:\n`;

    const rows = foods.map(f =>
      `| ${f.id} | ${f.namePt} | ${f.nutrients.kcalPer100g} kcal | ` +
      `P:${f.nutrients.proteinG}g C:${f.nutrients.carbsG}g G:${f.nutrients.fatG}g ` +
      (f.nutrients.fiberG ? `Fib:${f.nutrients.fiberG}g` : '') +
      ` | ${f.primarySource} |`
    );

    const table = [
      '| food_id | nome | kcal/100g | macros | fonte |',
      '|---------|------|-----------|--------|-------|',
      ...rows,
    ].join('\n');

    return header + table;
  }
}
