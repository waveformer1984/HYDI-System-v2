import type { HealthCollector, HealthSnapshot, OllamaHealth } from '../types';

const DEFAULT_BASE_URL = process.env.LOCAL_MODEL_URL ||
  process.env.OLLAMA_URL ||
  'http://127.0.0.1:11434';

interface OllamaPsResponse {
  models?: Array<{
    name: string;
    model: string;
    size?: number;
    details?: { parameter_size?: string };
    context_length?: number;
    expires_at?: string;
  }>;
}

export class OllamaHealthCollector implements HealthCollector {
  readonly name = 'ollama';
  private readonly baseURL: string;

  constructor(baseURL = DEFAULT_BASE_URL) {
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  async collect(): Promise<Partial<HealthSnapshot>> {
    const ollama = await this.buildOllamaHealth();
    return { ollama };
  }

  private async buildOllamaHealth(): Promise<OllamaHealth> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseURL}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const latency = Date.now() - start;
      const loadedModels = await this.getLoadedModels();

      return {
        status: latency < 2000 ? 'healthy' : 'degraded',
        baseURL: this.baseURL,
        reachable: true,
        loadedModels,
        modelLoadTimeMs: null,
        averageInferenceLatencyMs: null,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        baseURL: this.baseURL,
        reachable: false,
        loadedModels: [],
        modelLoadTimeMs: null,
        averageInferenceLatencyMs: null,
        error: error instanceof Error ? error.message : 'Ollama unreachable',
      };
    }
  }

  private async getLoadedModels(): Promise<OllamaHealth['loadedModels']> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseURL}/api/ps`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return [];

      const data = (await response.json()) as OllamaPsResponse;
      return (data.models ?? []).map((m) => ({
        name: m.name || m.model,
        size: m.size,
        contextLength: m.context_length,
        expiresAt: m.expires_at,
      }));
    } catch {
      return [];
    }
  }
}
