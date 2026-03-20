import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { Food, FoodSource } from '@nutriplan/domain';
import { IFoodSyncAdapter } from '@nutriplan/domain';

// ─── TBCA 2.0 raw JSON shape ──────────────────────────────────────────────────

interface TbcaRecord {
  id_alimento:        string;
  descricao:          string;
  categoria:          string;
  subcategoria?:      string;
  energia_kcal:       number | null;
  proteina_g:         number | null;
  lipideos_g:         number | null;
  carboidrato_g:      number | null;
  fibra_alimentar_g?: number | null;
  sodio_mg?:          number | null;
  calcio_mg?:         number | null;
  ferro_mg?:          number | null;
  zinco_mg?:          number | null;
  vitamina_c_mg?:     number | null;
  vitamina_b12_mcg?:  number | null;
}

/**
 * TbcaSyncAdapter
 *
 * Lê o arquivo JSON da TBCA (download manual em tbca.insa.ufrj.br)
 * e normaliza cada registro para o schema Food do domain.
 *
 * O arquivo esperado pode ser configurado pela variável de ambiente
 * TBCA_JSON_PATH (padrão: data/tbca.json relativo ao CWD).
 */
export class TbcaSyncAdapter implements IFoodSyncAdapter {
  readonly source: FoodSource = 'TBCA';

  constructor(private readonly jsonPath: string) {}

  async *syncAll(): AsyncGenerator<Food, void, unknown> {
    const raw = await readFile(this.jsonPath, 'utf-8');
    const records: TbcaRecord[] = JSON.parse(raw);

    for (const record of records) {
      const food = this.normalize(record);
      if (food) yield food;
    }
  }

  private normalize(r: TbcaRecord): Food | null {
    // Descartar registros sem macros essenciais
    if (
      r.energia_kcal   == null ||
      r.proteina_g     == null ||
      r.lipideos_g     == null ||
      r.carboidrato_g  == null
    ) {
      return null;
    }

    return {
      id:          deterministicUuid('TBCA', r.id_alimento),
      externalId:  r.id_alimento,
      namePt:      r.descricao.trim(),
      category:    normalizeCategoryPt(r.categoria),
      subcategory: r.subcategoria?.trim(),
      tags:        inferTags(r.categoria, r.descricao),
      nutrients: {
        kcalPer100g: r.energia_kcal,
        proteinG:    r.proteina_g,
        carbsG:      r.carboidrato_g,
        fatG:        r.lipideos_g,
        fiberG:      r.fibra_alimentar_g    ?? undefined,
        sodiumMg:    r.sodio_mg             ?? undefined,
        calciumMg:   r.calcio_mg            ?? undefined,
        ironMg:      r.ferro_mg             ?? undefined,
        zincMg:      r.zinco_mg             ?? undefined,
        vitCMg:      r.vitamina_c_mg        ?? undefined,
        vitB12Mcg:   r.vitamina_b12_mcg     ?? undefined,
      },
      primarySource: 'TBCA',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deterministicUuid(source: string, externalId: string): string {
  const hash = createHash('sha256').update(`${source}:${externalId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),   // version 4
    (parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16) + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

function normalizeCategoryPt(raw: string): string {
  return raw
    .replace(/e derivados/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferTags(category: string, description: string): string[] {
  const tags: string[] = [];
  const lower = `${category} ${description}`.toLowerCase();

  if (lower.includes('leite') || lower.includes('queijo') || lower.includes('iogurte')) {
    tags.push('laticinio', 'lactose');
  }
  if (lower.includes('carne') || lower.includes('frango') || lower.includes('peixe') || lower.includes('ovo')) {
    tags.push('proteina-animal');
  }
  if (lower.includes('fruta')) tags.push('fruta');
  if (lower.includes('verdura') || lower.includes('legume') || lower.includes('hortalica')) {
    tags.push('vegetal');
  }
  if (lower.includes('cereal') || lower.includes('arroz') || lower.includes('trigo') || lower.includes('aveia')) {
    tags.push('cereal');
  }
  if (lower.includes('leguminosa') || lower.includes('feijao') || lower.includes('lentilha') || lower.includes('grao')) {
    tags.push('leguminosa');
  }
  if (lower.includes('oleaginosa') || lower.includes('nozes') || lower.includes('amendoim')) {
    tags.push('oleaginosa');
  }
  if (lower.includes('gluten') || lower.includes('trigo') || lower.includes('centeio') || lower.includes('cevada')) {
    tags.push('gluten');
  }

  return [...new Set(tags)];
}
