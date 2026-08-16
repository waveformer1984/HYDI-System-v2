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
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSessionState as getSharedSessionState, updateSessionState as updateSharedSessionState, SessionState } from './session-state';
import { getMetricsService, type PartialInferenceMetric } from './metrics';
import { checkPrompt, createSafeResponse } from './prompt-guard';

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

// Lazy client: a missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// must surface as a normal caught error inside processChat's try/catch (which
// degrades to a friendly fallback reply), not a crash at construction time
// that skips straight past it. Same pattern as api/chat/route.js's getSupabase().
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabaseProxy = new Proxy({}, { get: (_, prop) => (getSupabase() as any)[prop] }) as SupabaseClient;

export class ModelManager {
  // Static state survives across per-request ModelManager instances.
  private static consecutiveFailures = 0;
  private static circuitBreakerUntil = 0;
  private static localReachable: boolean | null = null;
  private static localReachableCheckedAt = 0;
  private static readonly LOCAL_REACHABILITY_TTL_MS = 30000;

  private supabase: SupabaseClient;

  constructor() {
    this.supabase = supabaseProxy;
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
   * Supports LOCAL_MODEL_PROVIDER=mock for deterministic, state-aware local
   * responses without requiring Ollama or cloud credentials.
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
    const guard = checkPrompt(prompt);
    if (!guard.safe) {
      console.warn('[ModelManager] Prompt rejected by guard:', guard.reason);
      return {
        content: createSafeResponse(),
        model: 'guard',
        latency: 0,
        success: true,
        metadata: { provider: 'local', selectedModel: 'prompt-guard' },
      };
    }

    const startTime = Date.now();
    const requestId = context?.requestId || randomUUID();
    let response: ModelResponse;
    let fallbackReason: string | null = null;

    const useMock = process.env.LOCAL_MODEL_PROVIDER === 'mock';

    if (this.isCircuitBreakerActive() && !useMock) {
      console.log('[ModelManager] Circuit breaker active - using API fallback');
      fallbackReason = 'circuit-breaker';
      response = await this.generateAPIResponse(prompt, sessionId);
    } else if (useMock) {
      const mockResponse = await this.generateMockResponse(prompt);
      const latency = Date.now() - startTime;
      await this.updateSessionState(sessionId, 'mock', 'success');
      response = {
        content: mockResponse,
        model: 'local-mock',
        latency,
        success: true,
        metadata: {
          provider: 'local',
          selectedModel: process.env.LOCAL_MODEL_NAME || 'mock-grounding',
        },
      };
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
            num_predict: 300,
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
   * Deterministic local mock provider for qualification and environments where
   * Ollama is not available.  It extracts Photo Forge state from the prompt and
   * produces a concise, grounded JSON answer.  It never invents facts not
   * present in the prompt and it never returns the content as non-JSON.
   */
  private async generateMockResponse(prompt: string): Promise<string> {
    const lines = prompt.split('\n');
    const state: Record<string, string | undefined> = {};
    let inContext = false;
    let userQuestion = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('[Photo Forge Context]') && !line.includes('[/Photo Forge Context]')) {
        inContext = true;
        continue;
      }
      if (line.includes('[/Photo Forge Context]')) {
        inContext = false;
        continue;
      }
      if (inContext) {
        const imageMatch = line.match(/^Image:\s*(.+)$/);
        if (imageMatch) state.image = imageMatch[1].trim();

        const toolMatch = line.match(/^Tool:\s*(.+)$/);
        if (toolMatch) state.tool = toolMatch[1].trim();

        const selectionMatch = line.match(/^Selection:\s*(.+)$/);
        if (selectionMatch) state.selection = selectionMatch[1].trim();

        const lastActionMatch = line.match(/^Last action:\s*(.+)$/);
        if (lastActionMatch) state.lastAction = lastActionMatch[1].trim();
      } else if (line.startsWith('User question:')) {
        userQuestion = line.replace(/^User question:\s*/, '').trim();
      }
    }

    if (!userQuestion) {
      // Fallback: take the last non-empty line before the final JSON marker.
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (l && l !== 'Respond with JSON:') {
          userQuestion = l;
          break;
        }
      }
    }

    const q = userQuestion.toLowerCase();
    let text = '';

    if (q.includes('tool') && (q.includes('what') || q.includes('which') || q.includes('using') || q.includes('active'))) {
      text = state.tool
        ? `The active tool is ${state.tool}.`
        : 'No active tool is set in the current workspace.';
    } else if (q.includes('image') && (q.includes('what') || q.includes('which') || q.includes('working') || q.includes('current'))) {
      text = state.image
        ? `The current image is ${state.image}.`
        : 'No image is currently selected in the workspace.';
    } else if (q.includes('selection') && (q.includes('what') || q.includes('which') || q.includes('active') || q.includes('current'))) {
      text = state.selection
        ? `The current selection is ${state.selection}.`
        : 'No selection is currently set in the workspace.';
    } else if (q.includes('last action') || q.includes('last photo forge action') || q.includes('last operation')) {
      text = state.lastAction
        ? `The last action was ${state.lastAction}.`
        : 'No last action is recorded in the current workspace.';
    } else if (state.tool || state.image || state.selection) {
      const parts: string[] = [];
      if (state.image) parts.push(`image ${state.image}`);
      if (state.tool) parts.push(`tool ${state.tool}`);
      if (state.selection) parts.push(`selection ${state.selection}`);
      text = `The current Photo Forge workspace has ${parts.join(', ')}.`;
    } else {
      text = "I don't have any current Photo Forge state to answer from.";
    }

    return JSON.stringify({ response: text, actions: [] });
  }

  /**
   * API fallback generation. Prefers Anthropic, then OpenAI, but only when a
   * non-placeholder key is actually configured.
   */
  private async generateAPIResponse(prompt: string, _sessionId: string): Promise<ApiResponse> {
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
      return Object.prototype.hasOwnProperty.call(parsed, 'response') && Array.isArray(parsed.actions);
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
   * Session state management — delegates to the shared session-state module
   * so ModelManager isn't one of several independent `sessions` writers.
   */
  private async updateSessionState(sessionId: string, activeModel: 'local' | 'api' | 'mock', status: 'success' | 'failure'): Promise<void> {
    await updateSharedSessionState(this.supabase, sessionId, {
      active_model: activeModel,
      last_action_status: status,
    });
  }

  /**
   * Get current session state
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    return getSharedSessionState(this.supabase, sessionId);
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
