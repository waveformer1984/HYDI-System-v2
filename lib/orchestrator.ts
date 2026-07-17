/**
 * MAIN ORCHESTRATOR - Heidi Production Agent
 * 
 * This is the core routing engine with memory, tools, and enforced output contracts.
 * 
 * Responsibilities:
 * - Retrieve memory context
 * - Route to ModelManager
 * - Parse and validate responses
 * - Execute actions
 * - Maintain session state
 * - Record per-request metrics to the MetricsService
 */

import { randomUUID } from 'crypto';
import { ModelManager, type ModelResponse } from './ModelManager';
import { ActionParser, ParsedResponse } from './ActionParser';
import { ActionExecutor } from './action-executor';
import { retrieveMemory, storeMemory } from './heidi-memory';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getMetricsService, type PartialInferenceMetric } from './metrics';

interface ChatRequest {
  message: string;
  session_id: string;
  user_id: string;
}

interface ChatResponse {
  response: string;
  actions: any[];
  model_used: string;
  latency: number;
  session_state: any;
}

export class HeidiOrchestrator {
  private modelManager: ModelManager;
  private supabase: SupabaseClient;
  private actionExecutor: ActionExecutor;
  private allowedActionTypes: string[] = [
    'send_email',
    'create_task',
    'update_database',
    'fetch_data',
    'schedule_event'
  ];

  constructor() {
    this.modelManager = new ModelManager();
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    this.actionExecutor = new ActionExecutor(this.supabase);
  }

  /**
   * Main chat processing method
   */
  async processChat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const requestId = randomUUID();
    let memoryLookupDurationMs: number | undefined;
    let actionExecutionDurationMs: number | undefined;
    let modelResponse: ModelResponse | undefined;
    let finalResponse: ParsedResponse | undefined;
    let parseRetry = false;
    
    try {
      // 1. Retrieve memory context
      const memoryStart = Date.now();
      const memoryContext = await this.retrieveMemory(request.message, request.user_id, request.session_id);
      memoryLookupDurationMs = Date.now() - memoryStart;
      
      // 2. Build prompt with memory
      const prompt = this.buildPrompt(request.message, memoryContext);
      
      // 3. Generate response via ModelManager (metrics recorded here by orchestrator later)
      modelResponse = await this.modelManager.generateResponse(prompt, request.session_id, {
        requestId,
        memoryLookupDurationMs,
        recordMetrics: false,
      });
      
      // 4. Parse and validate response
      const parseResult = ActionParser.parseResponse(modelResponse.content);
      
      if (parseResult.success && parseResult.response) {
        finalResponse = parseResult.response;
      } else {
        // Self-correction loop - retry once
        parseRetry = true;
        console.log('[Orchestrator] Invalid response, retrying with corrected prompt');
        const correctedPrompt = ActionParser.generateCorrectedPrompt(prompt, parseResult.error || 'Unknown error');
        modelResponse = await this.modelManager.generateResponse(correctedPrompt, request.session_id, {
          requestId: `${requestId}-retry`,
          memoryLookupDurationMs,
          recordMetrics: false,
        });
        
        const retryParse = ActionParser.parseResponse(modelResponse.content);
        if (retryParse.success && retryParse.response) {
          finalResponse = retryParse.response;
        } else {
          // Still invalid - use safe fallback
          console.log('[Orchestrator] Retry failed, using safe fallback');
          finalResponse = ActionParser.generateSafeFallback();
        }
      }
      
      // 5. Validate actions
      const actionValidation = ActionParser.validateActions(finalResponse.actions, this.allowedActionTypes);
      if (!actionValidation.valid) {
        console.log('[Orchestrator] Invalid actions detected, filtering');
        finalResponse.actions = finalResponse.actions.filter(action => 
          this.allowedActionTypes.includes(action.type)
        );
      }
      
      // 6. Execute actions
      const actionStart = Date.now();
      await this.executeActions(finalResponse.actions, request.session_id);
      actionExecutionDurationMs = Date.now() - actionStart;
      
      // 7. Store conversation in memory
      await this.storeMemory(request.session_id, request.user_id, request.message, finalResponse.response);
      
      // 8. Get updated session state
      const sessionState = await this.modelManager.getSessionState(request.session_id);
      
      const totalLatency = Date.now() - startTime;

      // Record the comprehensive per-request metric
      this.recordRequestMetric({
        requestId,
        conversationId: request.session_id,
        modelResponse,
        prompt,
        finalResponse,
        totalLatency,
        memoryLookupDurationMs,
        actionExecutionDurationMs,
        parseRetry,
      });
      
      return {
        response: finalResponse.response,
        actions: finalResponse.actions,
        model_used: modelResponse.model,
        latency: totalLatency,
        session_state: sessionState
      };
      
    } catch (error) {
      console.error('[Orchestrator] Chat processing failed:', error);
      const totalLatency = Date.now() - startTime;

      if (modelResponse) {
        this.recordRequestMetric({
          requestId,
          conversationId: request.session_id,
          modelResponse,
          prompt: request.message,
          finalResponse,
          totalLatency,
          memoryLookupDurationMs,
          actionExecutionDurationMs,
          parseRetry,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
      
      // Return safe fallback on any error
      return {
        response: "I apologize, but I'm experiencing technical difficulties. Please try again.",
        actions: [],
        model_used: modelResponse?.model ?? 'fallback',
        latency: totalLatency,
        session_state: null
      };
    }
  }

  private recordRequestMetric(args: {
    requestId: string;
    conversationId: string;
    modelResponse: ModelResponse;
    prompt: string;
    finalResponse?: ParsedResponse;
    totalLatency: number;
    memoryLookupDurationMs?: number;
    actionExecutionDurationMs?: number;
    parseRetry: boolean;
    errors?: string[];
  }): void {
    const metadata = args.modelResponse.metadata;
    const metric: PartialInferenceMetric = {
      requestId: args.requestId,
      conversationId: args.conversationId,
      provider: metadata?.provider ?? args.modelResponse.model,
      selectedModel: metadata?.selectedModel ?? 'unknown',
      promptLength: args.prompt.length,
      responseLength: args.finalResponse?.response?.length ?? args.modelResponse.content.length,
      latencyMs: args.totalLatency,
      loadDurationMs: metadata?.loadDurationMs,
      evalDurationMs: metadata?.evalDurationMs,
      memoryLookupDurationMs: args.memoryLookupDurationMs,
      actionExecutionDurationMs: args.actionExecutionDurationMs,
      promptTokens: metadata?.promptTokens,
      completionTokens: metadata?.completionTokens,
      totalTokens: metadata?.totalTokens,
      errors: args.errors,
      retryCount: args.parseRetry ? 1 : 0,
    };

    getMetricsService().record(metric);
  }

  /**
   * Retrieve memory context from Supabase via semantic search over the
   * user's current message. Skips retrieval when embeddings are unavailable.
   */
  private async retrieveMemory(message: string, userId: string, sessionId: string): Promise<string> {
    return retrieveMemory(this.supabase, message, userId, sessionId);
  }

  /**
   * Build prompt with memory context
   */
  private buildPrompt(userMessage: string, memoryContext: string): string {
    const systemPrompt = `You are Heidi, a production-grade conversational AI assistant.

Rules:
1. Always respond with valid JSON
2. Use this exact structure: {"response": "your response", "actions": [{"type": "action_type", "payload": {}}]}
3. Keep responses concise and helpful
4. Only suggest actions that are genuinely useful

Available actions: ${this.allowedActionTypes.join(', ')}

${memoryContext ? `Context: ${memoryContext}` : ''}

User message: ${userMessage}

Respond with JSON:`;

    return systemPrompt;
  }

  /**
   * Store conversation in memory
   */
  private async storeMemory(sessionId: string, userId: string, userMessage: string, assistantResponse: string): Promise<void> {
    return storeMemory(this.supabase, sessionId, userId, userMessage, assistantResponse);
  }

  /**
   * Execute actions for real and record truthful outcomes in the `actions`
   * audit log (status reflects the actual handler result).
   */
  private async executeActions(actions: ParsedResponse['actions'], sessionId: string): Promise<void> {
    for (const action of actions) {
      try {
        const outcome = await this.actionExecutor.execute(action, sessionId);
        console.log(`[Orchestrator] Executed action: ${action.type} -> ${outcome.status}`);

        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: outcome.status,
          payload: { ...action.payload, result: outcome.result, error: outcome.error },
        });
      } catch (error) {
        console.error(`[Orchestrator] Action execution failed for ${action.type}:`, error);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, error: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    }
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string) {
    return await this.modelManager.getSessionState(sessionId);
  }

  /**
   * Get system status
   */
  async getSystemStatus() {
    return {
      model_status: this.modelManager.getModelStatus(),
      memory_connected: !!this.supabase,
      allowed_actions: this.allowedActionTypes
    };
  }
}
