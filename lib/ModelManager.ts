/**
 * MODEL ORCHESTRATION LAYER (CRITICAL)
 * 
 * Responsibilities:
 * - Default to LOCAL inference via Ollama (Llama 3 or Mistral)
 * - Enforce strict timeout: 5 seconds max local inference
 * - If timeout OR error OR malformed output → trigger fallback
 * - Fallback = API model (OpenAI or Anthropic)
 * 
 * Routing Rule (NON-NEGOTIABLE):
 * if (localModel.success && latency < 5000ms && outputValid)
 *     use local response
 * else
 *     use API fallback
 * 
 * Circuit Breaker:
 * Track consecutive local failures
 * If failures ≥ 3 → force API mode for 60 seconds
 * Auto-recover after cooldown
 */

import { createClient } from '@supabase/supabase-js';

interface ModelResponse {
  content: string;
  model: string;
  latency: number;
  success: boolean;
  error?: string;
}

interface SessionState {
  session_id: string;
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery';
  active_model: 'local' | 'api';
  last_action_status: 'success' | 'failure' | 'pending';
}

export class ModelManager {
  private consecutiveFailures: number = 0;
  private circuitBreakerUntil: number = 0;
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Max local inference budget (ms). Defaults to 5000 (the documented strict
   * limit); override with LOCAL_MODEL_TIMEOUT_MS for slower local hardware.
   * Governs both the abort timeout and the success-routing latency gate.
   */
  private getLocalTimeoutMs(): number {
    const parsed = parseInt(process.env.LOCAL_MODEL_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
  }

  /**
   * Main routing method - NON-NEGOTIABLE routing logic
   */
  async generateResponse(prompt: string, sessionId: string): Promise<ModelResponse> {
    const startTime = Date.now();

    // Skip local inference entirely unless a local model is configured.
    // On serverless hosts (e.g. Vercel) localhost Ollama is unreachable, so
    // attempting it just burns the 5s timeout on every request.
    if (!this.isLocalModelEnabled()) {
      const apiResponse = await this.generateAPIResponse(prompt, sessionId);
      await this.updateSessionState(sessionId, 'api', apiResponse.success ? 'success' : 'failure');
      return {
        content: apiResponse.content,
        model: apiResponse.model,
        latency: Date.now() - startTime,
        success: apiResponse.success,
        error: apiResponse.error,
      };
    }

    // Check circuit breaker
    if (this.isCircuitBreakerActive()) {
      console.log('[ModelManager] Circuit breaker active - using API fallback');
      return await this.generateAPIResponse(prompt, sessionId);
    }

    // Try local model first
    const localResponse = await this.generateLocalResponse(prompt);
    const latency = Date.now() - startTime;

    // Apply routing rule (NON-NEGOTIABLE)
    if (localResponse.success && latency < this.getLocalTimeoutMs() && this.validateOutput(localResponse.content)) {
      // Success - use local response
      await this.updateSessionState(sessionId, 'local', 'success');
      this.consecutiveFailures = 0;
      
      return {
        content: localResponse.content,
        model: 'local',
        latency,
        success: true
      };
    } else {
      // Failure - trigger fallback
      console.log('[ModelManager] Local model failed, triggering fallback');
      this.consecutiveFailures++;
      
      // Check circuit breaker condition
      if (this.consecutiveFailures >= 3) {
        this.activateCircuitBreaker();
      }

      const apiResponse = await this.generateAPIResponse(prompt, sessionId);
      const totalLatency = Date.now() - startTime;

      await this.updateSessionState(sessionId, 'api', apiResponse.success ? 'success' : 'failure');

      return {
        content: apiResponse.content,
        model: 'api',
        latency: totalLatency,
        success: apiResponse.success,
        error: apiResponse.error
      };
    }
  }

  /**
   * Whether a local inference endpoint is configured.
   */
  private isLocalModelEnabled(): boolean {
    return process.env.ENABLE_LOCAL_MODEL === 'true' || !!process.env.LOCAL_MODEL_URL;
  }

  /**
   * Local model generation via Ollama
   */
  private async generateLocalResponse(prompt: string): Promise<{ content: string; success: boolean }> {
    try {
      const baseURL = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
      const model = process.env.LOCAL_MODEL_NAME || 'llama3';
      const response = await fetch(`${baseURL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model, // e.g. llama3 or mistral
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.1,
            max_tokens: 1000
          }
        }),
        signal: AbortSignal.timeout(this.getLocalTimeoutMs()) // default 5s; override via LOCAL_MODEL_TIMEOUT_MS
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        content: data.response,
        success: true
      };

    } catch (error) {
      console.error('[ModelManager] Local model error:', error);
      return {
        content: '',
        success: false
      };
    }
  }

  /**
   * API fallback generation (OpenAI or Anthropic)
   */
  private async generateAPIResponse(prompt: string, sessionId: string): Promise<{ content: string; success: boolean; error?: string; model: string; latency: number }> {
    try {
      // Prefer Anthropic (the repo's primary provider), then OpenAI.
      if (process.env.ANTHROPIC_API_KEY) {
        return await this.generateAnthropicResponse(prompt);
      } else if (process.env.OPENAI_API_KEY) {
        return await this.generateOpenAIResponse(prompt);
      } else {
        throw new Error('No API keys configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)');
      }
    } catch (error) {
      console.error('[ModelManager] API fallback error:', error);
      return {
        content: 'I apologize, but I\'m experiencing technical difficulties. Please try again.',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        model: 'api',
        latency: 0
      };
    }
  }

  private async generateOpenAIResponse(prompt: string): Promise<{ content: string; success: boolean; error?: string; model: string; latency: number }> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are Heidi, a production-grade conversational AI assistant. Always respond with valid JSON in the format: {"response": "string", "actions": []}'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        content: data.choices[0].message.content,
        success: true,
        model: 'openai',
        latency: 0
      };

    } catch (error) {
      return {
        content: '',
        success: false,
        error: error instanceof Error ? error.message : 'OpenAI API error',
        model: 'openai',
        latency: 0
      };
    }
  }

  private async generateAnthropicResponse(prompt: string): Promise<{ content: string; success: boolean; error?: string; model: string; latency: number }> {
    const start = Date.now();
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: 'You are Heidi, a production-grade conversational AI assistant. Always respond with valid JSON: {"response": "string", "actions": []}',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
      const data = await response.json() as { content: Array<{ type: string; text: string }> };

      return {
        content: data.content.filter(b => b.type === 'text').map(b => b.text).join(''),
        success: true,
        model: 'claude-sonnet-4-6',
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        content: '',
        success: false,
        error: error instanceof Error ? error.message : 'Anthropic API error',
        model: 'claude-sonnet-4-6',
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Validate output format
   */
  private validateOutput(content: string): boolean {
    try {
      const parsed = JSON.parse(content);
      return parsed.hasOwnProperty('response') && Array.isArray(parsed.actions);
    } catch {
      return false;
    }
  }

  /**
   * Circuit breaker management
   */
  private isCircuitBreakerActive(): boolean {
    return Date.now() < this.circuitBreakerUntil;
  }

  private activateCircuitBreaker(): void {
    console.log('[ModelManager] Activating circuit breaker for 60 seconds');
    this.circuitBreakerUntil = Date.now() + 60000; // 60 seconds
  }

  /**
   * Session state management
   */
  private async updateSessionState(sessionId: string, activeModel: 'local' | 'api', status: 'success' | 'failure'): Promise<void> {
    try {
      await this.supabase
        .from('sessions')
        .upsert({
          session_id: sessionId,
          active_model: activeModel,
          last_action_status: status,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('[ModelManager] Failed to update session state:', error);
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
      console.error('[ModelManager] Failed to get session state:', error);
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
      consecutiveFailures: this.consecutiveFailures,
      circuitBreakerActive: this.isCircuitBreakerActive(),
      circuitBreakerCooldown: Math.max(0, this.circuitBreakerUntil - Date.now())
    };
  }
}
