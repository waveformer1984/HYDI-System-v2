import { generateEmbedding } from '../../lib/embeddings';

interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * LLMService — real model + embedding access for PAO agents.
 *
 * Uses Anthropic (preferred) or OpenAI when an API key is configured.
 * Throws an explicit error when no provider is available rather than
 * returning simulated output.
 */
export class LLMService {
  async generateText(prompt: string, options?: LLMOptions): Promise<string> {
    const maxTokens = options?.maxTokens ?? 1000;

    if (process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
      const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
      return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }

    if (process.env.OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: options?.temperature ?? 0.7,
        }),
      });
      if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content ?? '';
    }

    throw new Error('No LLM provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }

  async generateJSON<T = unknown>(prompt: string, options?: LLMOptions): Promise<T> {
    const text = await this.generateText(
      `${prompt}\n\nRespond ONLY with valid JSON, no prose.`,
      options,
    );
    try {
      return JSON.parse(text) as T;
    } catch {
      // Extract the first JSON object/array if the model wrapped it in text.
      const match = text.match(/[[{][\s\S]*[\]}]/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error('LLM did not return valid JSON');
    }
  }

  async embedText(text: string): Promise<number[]> {
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      throw new Error('No embedding provider configured (set OPENAI_API_KEY)');
    }
    return embedding;
  }
}
