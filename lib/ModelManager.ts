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
import os from 'os';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createTimedClient } from './supabase-timed';
import { getSessionState as getSharedSessionState, updateSessionState as updateSharedSessionState, SessionState } from './session-state';
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
    _supabase = createTimedClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabaseProxy = new Proxy({}, { get: (_, prop) => (getSupabase() as any)[prop] }) as SupabaseClient;

// NAMING COLLISION: there is a SEPARATE, unrelated class also named
// `ModelManager` at src/hydi-v3/ModelManager.js, used only by the HYDI V3
// reliability layer (adapter registry over Ollama/LM Studio/llama.cpp with
// its own ModelConfiguration/ModelRegistry/ModelHealth/ModelMetrics
// sub-modules). THIS class is the one actually used by the live /api/chat
// endpoint (pages/api/chat.ts -> lib/orchestrator.ts's processChat()) --
// local-first-with-API-fallback routing, circuit breaker, single-slot
// Ollama awareness. Do not confuse the two when importing "ModelManager".
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
   * Failure classes for the local path — stable tokens so callers and the
   * metrics layer can distinguish load failure from inference failure from
   * resource refusal. Never collapse these into a generic "AI failed".
   */
  static readonly LLM_FAILURE = {
    UNREACHABLE: 'LOCAL_UNREACHABLE',
    MEMORY_PRESSURED: 'MEMORY_PRESSURED',
    MODEL_LOAD_TIMEOUT: 'MODEL_LOAD_TIMEOUT',
    INFERENCE_TIMEOUT: 'INFERENCE_TIMEOUT',
    INFERENCE_ERROR: 'INFERENCE_ERROR',
  } as const;

  private static modelSelectionCache: {
    at: number;
    choice: { name: string; sizeBytes: number } | null;
    reason: string;
  } | null = null;
  private static readonly MODEL_SELECTION_TTL_MS = 60000;

  /**
   * Load-phase budget — separate from the inference budget. A cold Ollama
   * model load under memory pressure can take 30-45 s; giving it its own
   * timeout lets us classify MODEL_LOAD_TIMEOUT distinctly instead of
   * guessing which phase a single timer was in.
   */
  private getModelLoadTimeoutMs(): number {
    const parsed = parseInt(process.env.LOCAL_MODEL_LOAD_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 45000;
  }

  /**
   * Memory budget for local inference: free RAM minus a reserve for the OS,
   * the database, and HYDI's own runtimes. A model counts as affordable when
   * its on-disk size * 1.5 (runtime working-set estimate) fits in the budget.
   * Live data point 2026-09-21: 15.7 GB box with ~1.4 GB free loaded the
   * 0.59 GB tinyllama in 34.5 s of swap thrash — affordance must be checked
   * BEFORE attempting a load, not discovered through repeated 30 s cancels.
   */
  private getModelMemoryBudgetBytes(): number {
    const reserveMb = parseInt(process.env.LOCAL_MODEL_RESERVE_MB || '', 10);
    const reserveBytes = (Number.isFinite(reserveMb) && reserveMb >= 0 ? reserveMb : 768) * 1024 * 1024;
    return Math.max(0, os.freemem() - reserveBytes);
  }

  /**
   * Resource-aware model selection. Env override (LOCAL_MODEL_NAME /
   * OLLAMA_MODEL) wins only if the requested model actually fits the memory
   * budget — otherwise we downgrade to the largest installed model that does
   * fit. Returns null when nothing fits (MEMORY_PRESSURED — the truthful
   * answer on a RAM-starved box, not another doomed load attempt).
   */
  private async selectLocalModel(): Promise<{
    choice: { name: string; sizeBytes: number } | null;
    reason: string;
  }> {
    const now = Date.now();
    if (ModelManager.modelSelectionCache && now - ModelManager.modelSelectionCache.at < ModelManager.MODEL_SELECTION_TTL_MS) {
      return { choice: ModelManager.modelSelectionCache.choice, reason: ModelManager.modelSelectionCache.reason };
    }

    const budget = this.getModelMemoryBudgetBytes();
    const baseUrl = this.getLocalBaseURL();
    let models: { name: string; size: number }[] = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { models?: { name: string; size: number }[] };
      models = (data.models || []).filter((m) => typeof m.size === 'number' && m.size > 0);
    } catch (e) {
      const result = { choice: null, reason: `tags probe failed: ${e instanceof Error ? e.message : 'unknown'}` };
      ModelManager.modelSelectionCache = { at: now, ...result };
      return result;
    }

    // Exclude embedding-only models from the generative pool.
    const generative = models.filter((m) => !/embed/i.test(m.name));
    const requested = process.env.LOCAL_MODEL_NAME || process.env.OLLAMA_MODEL || null;
    const requestedEntry = requested ? generative.find((m) => m.name === requested) : undefined;
    const fits = (m: { size: number }) => m.size * 1.5 <= budget;

    let result: { choice: { name: string; sizeBytes: number } | null; reason: string };
    if (requestedEntry) {
      if (fits(requestedEntry)) {
        result = { choice: { name: requestedEntry.name, sizeBytes: requestedEntry.size }, reason: 'requested model fits budget' };
      } else {
        const smaller = generative.filter(fits).sort((a, b) => a.size - b.size)[0];
        result = smaller
          ? { choice: { name: smaller.name, sizeBytes: smaller.size }, reason: `requested ${requested} exceeds memory budget; downgraded to ${smaller.name}` }
          : { choice: null, reason: `requested ${requested} exceeds memory budget and no smaller model fits` };
      }
    } else {
      // Prefer the SMALLEST model that fits — on a RAM-constrained box the
      // largest-fitting model leaves no headroom for inference's working
      // set beyond the load estimate, so it thrashes into a timeout while
      // a small model actually answers.
      const best = generative.filter(fits).sort((a, b) => a.size - b.size)[0];
      result = best
        ? { choice: { name: best.name, sizeBytes: best.size }, reason: `smallest model fitting memory budget (headroom-first)` }
        : { choice: null, reason: 'no installed generative model fits the memory budget' };
    }

    ModelManager.modelSelectionCache = { at: now, ...result };
    return result;
  }

  /**
   * Warm/load phase: an empty-prompt generate with keep_alive loads the model
   * without running inference. Returns load telemetry for evidence.
   */
  private async warmModel(modelName: string): Promise<{ ok: boolean; loadDurationMs: number | null; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.getModelLoadTimeoutMs());
    try {
      const response = await fetch(`${this.getLocalBaseURL()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: '5m' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { ok: false, loadDurationMs: null, error: `HTTP ${response.status}` };
      const data = (await response.json()) as { load_duration?: number };
      return { ok: true, loadDurationMs: data.load_duration ? data.load_duration / 1e6 : null };
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === 'AbortError';
      return { ok: false, loadDurationMs: null, error: aborted ? ModelManager.LLM_FAILURE.MODEL_LOAD_TIMEOUT : (e instanceof Error ? e.message : 'warm failed') };
    }
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

    // When the fallback also failed, the user-facing error should name the
    // PRIMARY cause (why local inference failed — e.g. MEMORY_PRESSURED),
    // not the secondary fallback failure ('no cloud API key'), which
    // misleadingly implies a cloud dependency was expected.
    if (!response.success && fallbackReason) response.error = fallbackReason;

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
    // Phase 0: resource-aware selection. A model that cannot fit the memory
    // budget is never attempted — repeated doomed loads are worse than an
    // honest MEMORY_PRESSURED refusal.
    const selection = await this.selectLocalModel();
    if (!selection.choice) {
      const unreachable = selection.reason.startsWith('tags probe failed');
      return {
        content: '',
        success: false,
        error: unreachable ? ModelManager.LLM_FAILURE.UNREACHABLE : ModelManager.LLM_FAILURE.MEMORY_PRESSURED,
        metadata: { provider: 'local', selectedModel: 'none', loadDurationMs: null },
      };
    }
    const modelName = selection.choice.name;
    if (selection.reason.includes('downgraded')) {
      console.log(`[ModelManager] ${selection.reason}`);
    }

    // Phase 1: bounded load/warm. MODEL_LOAD_TIMEOUT is its own class.
    const warm = await this.warmModel(modelName);
    if (!warm.ok) {
      return {
        content: '',
        success: false,
        error: warm.error || ModelManager.LLM_FAILURE.MODEL_LOAD_TIMEOUT,
        metadata: { provider: 'local', selectedModel: modelName, loadDurationMs: warm.loadDurationMs },
      };
    }

    // Phase 2: bounded inference against the now-warm model.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.getLocalTimeoutMs());

    try {
      const response = await fetch(`${this.getLocalBaseURL()}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          prompt,
          stream: false,
          keep_alive: '5m',
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

      const loadDurationMs = warm.loadDurationMs ?? (data.load_duration ? data.load_duration / 1e6 : null);
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
      const aborted = error instanceof Error && error.name === 'AbortError';
      const message = aborted
        ? ModelManager.LLM_FAILURE.INFERENCE_TIMEOUT
        : error instanceof Error ? error.message : 'Unknown error';
      console.error('[ModelManager] Local model error:', message);
      // A timed-out or wedged inference can leave the model runner holding
      // RAM while serving nothing. Ask Ollama to unload it (keep_alive: 0)
      // so a failed request does not make the NEXT request less likely to
      // succeed. Best-effort, bounded, no process killing.
      void this.unloadLocalModel(modelName);
      return {
        content: '',
        success: false,
        error: message,
        metadata: { provider: 'local', selectedModel: modelName, loadDurationMs: warm.loadDurationMs },
      };
    }
  }

  /** Ask Ollama to unload a model after failure — frees the runner's RAM. */
  private async unloadLocalModel(modelName: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      await fetch(`${this.getLocalBaseURL()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0, stream: false }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      // unload is best-effort — ignore
    }
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
  private async updateSessionState(sessionId: string, activeModel: 'local' | 'api', status: 'success' | 'failure'): Promise<void> {
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
