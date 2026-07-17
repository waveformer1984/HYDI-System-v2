/**
 * MODEL ORCHESTRATION LAYER (CRITICAL)
 *
 * Responsibilities:
 * - Default to LOCAL inference via Ollama (Llama 3 / Mistral / etc.)
 * - Allow a realistic inference budget (cold model load can take 30-60 s)
 * - If local is unreachable, times out, returns malformed output -> trigger API fallback
 * - Fallback = OpenAI or Anthropic, but only when a real key is configured
 * - Emit per-request metrics to the central MetricsService
 *
 * Routing Rule:
 * if (localModel.success && outputValid)
 *     use local response
 * else
 *     use API fallback (if a valid key is available) or safe degradation
 *
 * Circuit Breaker:
 * - Persists across requests via static class state (ModelManager is recreated per request).
 * - Counts consecutive local failures.
 * - If failures >= 3 -> force API/degradation mode for 60 seconds, then auto-recover.
 */

import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getMetricsService, type PartialInferenceMetric } from './metrics';

export interface InferenceMetadata {
  provider: string;
  selectedModel: string;
  loadDurationMs?: number | null;
  evalDurationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface ModelResponse {
  content: string;
  model: string;
  latency: number;
  success: boolean;
  error?: string;
  metadata?: InferenceMetadata;
}

interface LocalResponse {
  content: string;
  success: boolean;
  error?: string;
  metadata?: InferenceMetadata;
}

interface ApiResponse {
  content: string;
  success: boolean;
  error?: string;
  model: string;
  latency: number;
  metadata?: InferenceMetadata;
}

interface SessionState {
  session_id: string;
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery';
  active_model: 'local' | 'api';
  last_action_status: 'success' | 'failure' | 'pending';
}

export class ModelManager {
  // Static state survives across per-request ModelManager instances.
  private static consecutiveFailures = 0;
  private static circuitBreakerUntil = 0;
  private static localReachable: boolean | null = null;
  private static localReachableCheckedAt = 0;
  private static readonly LOCAL_REACHABILITY_TTL_MS = 30000;

  private supabase: any;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Max local inference budget (ms). Defaults to 60 s so a cold Ollama model load
   * (often 30-50 s on integrated GPUs) does not abort. Override with
   * LOCAL_MODEL_TIMEOUT_MS for faster/slower hardware. This timeout guards against
   * a stuck runner; the routing decision no longer discards a slow-but-valid response.
   */
  private getLocalTimeoutMs(): number {
    const parsed = parseInt(process.env.LOCAL_MODEL_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
  }

  /**
   * Resolve the Ollama/base URL from env, respecting common conventions.
   */
  private getLocalBaseURL(): string {
    return (
      process.env.LOCAL_MODEL_URL ||
      process.env.OLLAMA_URL ||
      process.env.OLLAMA_HOST ||
      'http://localhost:11434'
    );
  }

  /**
   * Resolve the model name from env. LOCAL_MODEL_NAME wins, then OLLAMA_MODEL,
   * then a safe default.
   */
  private getLocalModelName(): string {
    return (
      process.env.LOCAL_MODEL_NAME ||
      process.env.OLLAMA_MODEL ||
      'llama3.2:3b'
    );
  }

  /**
   * Determine whether local inference should even be attempted.
   * - Explicitly disabled via ENABLE_LOCAL_MODEL=false -> skip.
   * - Explicitly enabled via ENABLE_LOCAL_MODEL=true or LOCAL_MODEL_URL/OLLAMA_URL -> try.
   * - Otherwise probe the default Ollama endpoint once per TTL so a running Ollama
   *   is auto-detected without needing env vars.
   */
  private async isLocalModelEnabled(): Promise<boolean> {
    if (process.env.ENABLE_LOCAL_MODEL === 'false') return false;
    if (
      process.env.ENABLE_LOCAL_MODEL === 'true' ||
      process.env.LOCAL_MODEL_URL ||
      process.env.OLLAMA_URL ||
      process.env.OLLAMA_HOST
    ) {
      return true;
    }
    return this.probeLocalReachability();
  }

  /**
   * Lightweight reachability probe. A hung or zombie Ollama server will fail here
   * quickly (2 s) instead of blocking the full inference timeout.
   */
  private async probeLocalReachability(): Promise<boolean> {
    const now = Date.now();
    if (
      ModelManager.localReachable !== null &&
      now - ModelManager.localReachableCheckedAt < ModelManager.LOCAL_REACHABILITY_TTL_MS
    ) {
      return ModelManager.localReachable;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.getLocalBaseURL()}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      ModelManager.localReachable = response.ok;
    } catch (error) {
      ModelManager.localReachable = false;
    }

    ModelManager.localReachableCheckedAt = now;
    return ModelManager.localReachable;
  }

  /**
   * Main routing method. Prefers local, falls back to API only on real failure.
   */
  async generateResponse(
    prompt: string,
    sessionId: string,
    context?: {
      requestId?: string;
      memoryLookupDurationMs?: number;
      actionExecutionDurationMs?: number;
      recordMetrics?: boolean;
    }
  ): Promise<ModelResponse> {
    const startTime = Date.now();
    const requestId = context?.requestId || randomUUID();
    let response: ModelResponse;
    let fallbackReason: string | null = null;

    if (this.isCircuitBreakerActive()) {
      console.log('[ModelManager] Circuit breaker active - using API fallback');
      fallbackReason = 'circuit-breaker';
      response = await this.generateAPIResponse(prompt, sessionId);
    } else if (!(await this.isLocalModelEnabled())) {
      console.log('[ModelManager] Local model not enabled or unreachable - using API fallback');
      fallbackReason = 'local-unreachable';
      response = await this.generateAPIResponse(prompt, sessionId);
    } else {
      const localResponse = await this.generateLocalResponse(prompt);

      if (localResponse.success && this.validateOutput(localResponse.content)) {
        const latency = Date.now() - startTime;
        await this.updateSessionState(sessionId, 'local', 'success');
        ModelManager.consecutiveFailures = 0;
        response = {
          content: localResponse.content,
          model: 'local',
          latency,
          success: true,
          metadata: localResponse.metadata,
        };
      } else {
        console.log('[ModelManager] Local model failed, triggering fallback');
        ModelManager.consecutiveFailures++;

        if (ModelManager.consecutiveFailures >= 3) {
          this.activateCircuitBreaker();
        }

        fallbackReason = localResponse.error || 'local-invalid-output';
        response = await this.generateAPIResponse(prompt, sessionId);
      }
    }

    const totalLatency = Date.now() - startTime;
    response.latency = totalLatency;

    await this.updateSessionState(
      sessionId,
      response.model === 'local' ? 'local' : 'api',
      response.success ? 'success' : 'failure'
    );

    const metadata = response.metadata;
    const errors = response.error ? [response.error] : undefined;

    if (context?.recordMetrics !== false) {
      getMetricsService().record({
        requestId,
        conversationId: sessionId,
        provider: metadata?.provider ?? response.model,
        selectedModel: metadata?.selectedModel ?? 'unknown',
        promptLength: prompt.length,
        responseLength: response.content.length,
        latencyMs: totalLatency,
        loadDurationMs: metadata?.loadDurationMs,
        evalDurationMs: metadata?.evalDurationMs,
        memoryLookupDurationMs: context?.memoryLookupDurationMs,
        actionExecutionDurationMs: context?.actionExecutionDurationMs,
        promptTokens: metadata?.promptTokens,
        completionTokens: metadata?.completionTokens,
        totalTokens: metadata?.totalTokens,
        errors,
        retryCount: fallbackReason ? 1 : 0,
        fallbackReason,
      });
    }

    return response;
  }

  /**
   * Local model generation via Ollama.
   * Uses `format: 'json'` and `num_predict` so the output is predictable,
   * and keeps the model alive for 30 minutes to avoid repeated cold loads.
   */
  private async generateLocalResponse(prompt: string): Promise<LocalResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.getLocalTimeoutMs());

    try {
      const response = await fetch(`${this.getLocalBaseURL()}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.getLocalModelName(),
          prompt,
          stream: false,
          keep_alive: '30m',
          format: 'json',
          options: {
            temperature: 0.1,
            num_predict: 1000,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        response?: string;
        load_duration?: number;
        eval_duration?: number;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const modelName = this.getLocalModelName();
      const loadDurationMs = data.load_duration ? data.load_duration / 1e6 : null;
      const evalDurationMs = data.eval_duration ? data.eval_duration / 1e6 : null;
      const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : null;
      const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : null;
      const totalTokens =
        promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null;

      return {
        content: data.response || '',
        success: true,
        metadata: {
          provider: 'local',
          selectedModel: modelName,
          loadDurationMs,
          evalDurationMs,
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ModelManager] Local model error:', message);
      return {
        content: '',
        success: false,
        error: message,
      };
    }
  }

  /**
   * API fallback generation. Prefers Anthropic, then OpenAI, but only when a
   * non-placeholder key is actually configured.
   */
  private async generateAPIResponse(prompt: string, sessionId: string): Promise<ApiResponse> {
    const fallbackText = this.getFallbackText();

    if (!this.hasAnyRealApiKey()) {
      return {
        content: fallbackText,
        success: false,
        error: 'No valid cloud API key configured (set a real ANTHROPIC_API_KEY or OPENAI_API_KEY)',
        model: 'api',
        latency: 0,
      };
    }

    const start = Date.now();

    try {
      if (this.isRealApiKey(process.env.ANTHROPIC_API_KEY)) {
        const anthropic = await this.generateAnthropicResponse(prompt);
        if (anthropic.success) return anthropic;
        console.warn('[ModelManager] Anthropic failed, trying OpenAI:', anthropic.error);
      }

      if (this.isRealApiKey(process.env.OPENAI_API_KEY)) {
        return await this.generateOpenAIResponse(prompt);
      }

      throw new Error('All configured cloud providers failed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud API error';
      console.error('[ModelManager] API fallback error:', message);
      return {
        content: fallbackText,
        success: false,
        error: message,
        model: 'api',
        latency: Date.now() - start,
      };
    }
  }

  private getFallbackText(): string {
    return "I apologize, but I'm having trouble processing your request right now.";
  }

  private hasAnyRealApiKey(): boolean {
    return (
      this.isRealApiKey(process.env.ANTHROPIC_API_KEY) ||
      this.isRealApiKey(process.env.OPENAI_API_KEY)
    );
  }

  /**
   * Reject obvious placeholder keys (e.g. "your-anthropic-key", "sk-your-openai-key")
   * so HYDI does not waste time and quota on bogus credentials.
   */
  private isRealApiKey(key: string | undefined): boolean {
    if (!key || key.trim().length < 20) return false;
    const normalized = key.toLowerCase();
    if (normalized.includes('your') || normalized.includes('placeholder') || normalized.includes('example')) return false;
    if (normalized.startsWith('sk-ant') && key.length > 30) return true;
    if (normalized.startsWith('sk-') && key.length > 30) return true;
    return true;
  }

  private async generateOpenAIResponse(prompt: string): Promise<ApiResponse> {
    const start = Date.now();
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are Heidi, a production-grade conversational AI assistant. Always respond with valid JSON in the format: {"response": "string", "actions": []}',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const usage = data.usage;
      const promptTokens = usage?.prompt_tokens ?? null;
      const completionTokens = usage?.completion_tokens ?? null;
      const totalTokens = usage?.total_tokens ?? null;

      return {
        content: data.choices[0]?.message?.content || '',
        success: true,
        model: 'openai',
        latency: Date.now() - start,
        metadata: {
          provider: 'openai',
          selectedModel: model,
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } catch (error) {
      return {
        content: '',
        success: false,
        error: error instanceof Error ? error.message : 'OpenAI API error',
        model: 'openai',
        latency: Date.now() - start,
      };
    }
  }

  private async generateAnthropicResponse(prompt: string): Promise<ApiResponse> {
    const start = Date.now();
    const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          system:
            'You are Heidi, a production-grade conversational AI assistant. Always respond with valid JSON: {"response": "string", "actions": []}',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const usage = data.usage;
      const promptTokens = usage?.input_tokens ?? null;
      const completionTokens = usage?.output_tokens ?? null;
      const totalTokens =
        promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null;

      return {
        content: data.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        success: true,
        model: 'anthropic',
        latency: Date.now() - start,
        metadata: {
          provider: 'anthropic',
          selectedModel: model,
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } catch (error) {
      return {
        content: '',
        success: false,
        error: error instanceof Error ? error.message : 'Anthropic API error',
        model: 'anthropic',
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Validate output format. Expects a JSON object with `response` and `actions` array.
   */
  private validateOutput(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    try {
      const parsed = JSON.parse(content);
      return parsed.hasOwnProperty('response') && Array.isArray(parsed.actions);
    } catch {
      return false;
    }
  }

  /**
   * Circuit breaker management. Static state persists across per-request instances.
   */
  private isCircuitBreakerActive(): boolean {
    return Date.now() < ModelManager.circuitBreakerUntil;
  }

  private activateCircuitBreaker(): void {
    console.log('[ModelManager] Activating circuit breaker for 60 seconds');
    ModelManager.circuitBreakerUntil = Date.now() + 60000;
  }

  /**
   * Session state management
   */
  private async updateSessionState(
    sessionId: string,
    activeModel: 'local' | 'api',
    status: 'success' | 'failure'
  ): Promise<void> {
    try {
      await this.supabase.from('sessions').upsert({
        session_id: sessionId,
        active_model: activeModel,
        last_action_status: status,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[ModelManager] Failed to update session state:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Get current session state
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    try {
      const { data } = await this.supabase
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .single();

      return data;
    } catch (error) {
      console.error('[ModelManager] Failed to get session state:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * System observability
   */
  getModelStatus(): {
    consecutiveFailures: number;
    circuitBreakerActive: boolean;
    circuitBreakerCooldown: number;
  } {
    return {
      consecutiveFailures: ModelManager.consecutiveFailures,
      circuitBreakerActive: this.isCircuitBreakerActive(),
      circuitBreakerCooldown: Math.max(0, ModelManager.circuitBreakerUntil - Date.now()),
    };
  }
}
