import { createHash } from 'crypto';
import { IEmbeddingService } from '@nutriplan/domain';
import { Food } from '@nutriplan/domain';

const CLAUDE_API_URL    = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL      = 'claude-sonnet-4-20250514';
const EMBEDDING_DIM     = 1536;

/**
 * ClaudeEmbeddingService
 *
 * Implementação de IEmbeddingService que usa o Claude API para enriquecer
 * semanticamente o texto do alimento e depois deriva um vetor 1536-dimensional.
 *
 * NOTA: A Anthropic não expõe endpoint público de embeddings nativos.
 * Esta implementação usa Claude para enriquecer a descrição e então aplica
 * uma expansão determinística via hash SHA-512 encadeado para gerar o vetor.
 *
 * Para produção com busca semântica de alta qualidade, substitua `toVector()`
 * por uma chamada à API de embeddings dedicada (ex: text-embedding-3-small da OpenAI
 * ou modelo local como all-MiniLM-L6-v2) mantendo a dimensão de 1536.
 */
export class ClaudeEmbeddingService implements IEmbeddingService {
  constructor(private readonly apiKey: string) {}

  async embed(text: string): Promise<number[]> {
    const enriched = await this.enrichWithClaude(text);
    return toVector(enriched, EMBEDDING_DIM);
  }

  // embedFoodCatalogue é orquestrado pelo GenerateFoodEmbeddingsUseCase
  async embedFoodCatalogue(_foods: Food[]): Promise<void> {
    throw new Error('Use GenerateFoodEmbeddingsUseCase para processar o catálogo em lote.');
  }

  private async enrichWithClaude(text: string): Promise<string> {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':          this.apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: 150,
        messages: [{
          role:    'user',
          content: `Expanda esta descrição de alimento com contexto semântico nutricional para indexação (categorias, macronutrientes dominantes, uso culinário): "${text}". Responda apenas com a descrição expandida, sem explicações.`,
        }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API error ${response.status}: ${body}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    return data.content[0]?.text ?? text;
  }
}

/**
 * Converte texto em vetor L2-normalizado de `dimensions` floats.
 * Usa SHA-512 encadeado para preencher o espaço de forma determinística.
 */
function toVector(text: string, dimensions: number): number[] {
  const vector: number[] = [];
  let seed = text;

  while (vector.length < dimensions) {
    const hash = createHash('sha512').update(seed).digest();
    for (let i = 0; i < hash.length && vector.length < dimensions; i++) {
      vector.push((hash[i]! - 128) / 128);
    }
    seed = createHash('sha256').update(seed).digest('hex');
  }

  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return vector.map(v => v / (norm || 1));
}
