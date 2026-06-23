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
 */

import { ModelManager } from './ModelManager';
import { ActionParser, ParsedResponse } from './ActionParser';
import { ActionExecutor } from './action-executor';
import { retrieveMemory, storeMemory, getRecentHistory, formatHistory } from './heidi-memory';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
    
    try {
      // 1. Retrieve memory context (semantic) + recent in-session history
      const [memoryContext, history] = await Promise.all([
        this.retrieveMemory(request.message, request.user_id),
        getRecentHistory(this.supabase, request.session_id),
      ]);
      
      // 2. Build prompt with memory + conversation history
      const prompt = this.buildPrompt(request.message, memoryContext, formatHistory(history));
      
      // 3. Generate response via ModelManager
      const modelResponse = await this.modelManager.generateResponse(prompt, request.session_id);
      
      // 4. Parse and validate response
      const parseResult = ActionParser.parseResponse(modelResponse.content);
      
      let finalResponse: ParsedResponse;
      
      if (parseResult.success && parseResult.response) {
        finalResponse = parseResult.response;
      } else {
        // Self-correction loop - retry once
        console.log('[Orchestrator] Invalid response, retrying with corrected prompt');
        const correctedPrompt = ActionParser.generateCorrectedPrompt(prompt, parseResult.error || 'Unknown error');
        const retryResponse = await this.modelManager.generateResponse(correctedPrompt, request.session_id);
        
        const retryParse = ActionParser.parseResponse(retryResponse.content);
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
      await this.executeActions(finalResponse.actions, request.session_id);
      
      // 7. Store conversation in memory
      await this.storeMemory(request.session_id, request.user_id, request.message, finalResponse.response);
      
      // 8. Get updated session state
      const sessionState = await this.modelManager.getSessionState(request.session_id);
      
      const totalLatency = Date.now() - startTime;
      
      return {
        response: finalResponse.response,
        actions: finalResponse.actions,
        model_used: modelResponse.model,
        latency: totalLatency,
        session_state: sessionState
      };
      
    } catch (error) {
      console.error('[Orchestrator] Chat processing failed:', error);
      
      // Return safe fallback on any error
      return {
        response: "I apologize, but I'm experiencing technical difficulties. Please try again.",
        actions: [],
        model_used: 'fallback',
        latency: Date.now() - startTime,
        session_state: null
      };
    }
  }

  /**
   * Retrieve memory context from Supabase via semantic search over the
   * user's current message. Skips retrieval when embeddings are unavailable.
   */
  private async retrieveMemory(message: string, userId: string): Promise<string> {
    return retrieveMemory(this.supabase, message, userId);
  }

  /**
   * Build prompt with memory context
   */
  private buildPrompt(userMessage: string, memoryContext: string, historyContext: string = ''): string {
    const systemPrompt = `You are Heidi, a production-grade conversational AI assistant.

Rules:
1. Always respond with valid JSON
2. Use this exact structure: {"response": "your response", "actions": [{"type": "action_type", "payload": {}}]}
3. Keep responses concise and helpful
4. Only suggest actions that are genuinely useful
5. Use the recent conversation to resolve follow-up references before answering

Available actions: ${this.allowedActionTypes.join(', ')}

${memoryContext ? `Context: ${memoryContext}\n` : ''}${historyContext ? `${historyContext}\n` : ''}
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
