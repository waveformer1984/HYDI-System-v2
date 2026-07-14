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
import { retrieveMemory, storeMemory } from './heidi-memory';
import { gateActions, isEnforcing } from './protoforge/action-gate';
import { buildExperience, storeExperience } from './episodic-memory';
import { AgentRegistry, createDefaultAgentRegistry } from './agents/registry';
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
  private agentRegistry: AgentRegistry;
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
    this.agentRegistry = createDefaultAgentRegistry(this.actionExecutor);
  }

  /**
   * Main chat processing method
   */
  async processChat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    
    try {
      // 1. Retrieve memory context
      const memoryContext = await this.retrieveMemory(request.message, request.user_id);
      
      // 2. Build prompt with memory
      const prompt = this.buildPrompt(request.message, memoryContext);
      
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
      const actionResults = await this.executeActions(finalResponse.actions, request.session_id);

      // 6b. Record an episodic experience for this turn — accumulate what
      // was attempted and what happened, not just raw conversation.
      if (actionResults.length > 0) {
        await storeExperience(
          this.supabase,
          request.session_id,
          request.user_id,
          buildExperience(request.message, actionResults),
        );
      }

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
   * audit log (status reflects the actual handler result). Returns a
   * summary per action so the caller can build an episodic-memory record
   * of the turn.
   *
   * Every action is first run through KILO -> ProtoForge (lib/protoforge/
   * action-gate.ts), which records a real decision to the `decisions`
   * table. Enforcement is opt-in (PROTOFORGE_ENFORCE_ACTIONS=true) — see
   * action-gate.ts for why blind enforcement would silently reject
   * everything today. The `actions` table's status column is constrained
   * to pending/completed/failed (supabase/heidi-init.sql), so a
   * reject/escalate verdict is recorded as 'failed' with the real
   * ProtoForge decision in the payload, not as a new status value.
   *
   * When an action actually executes, its outcome is backfilled onto the
   * same ProtoForge decision row via recordOutcome() — the self-evaluation
   * feedback loop: did the thing ProtoForge approved actually succeed?
   * Skipped when the action was blocked (there's no execution outcome to
   * backfill; the decision itself is the terminal state) or when gating
   * degraded to 'skipped' (no decisionId to backfill against).
   *
   * Approved actions execute through `agentRegistry` — the Phase 3
   * specialist roster (lib/agents/) — which delegates to `actionExecutor`
   * internally while tracking per-agent metrics. Falls back to calling
   * `actionExecutor` directly for any action type without a registered
   * agent, so adding a 6th action type doesn't require touching this
   * method.
   */
  private async executeActions(
    actions: ParsedResponse['actions'],
    sessionId: string,
  ): Promise<Array<{ type: string; status: 'completed' | 'failed'; error?: string }>> {
    const verdicts = await gateActions(actions, sessionId);
    const enforcing = isEnforcing();
    const results: Array<{ type: string; status: 'completed' | 'failed'; error?: string }> = [];

    for (const { action, decision, confidence, hypotheses, reasoning, decisionId } of verdicts) {
      const gateMeta = {
        protoforge_decision: decision,
        protoforge_confidence: confidence,
        protoforge_hypotheses: hypotheses,
        protoforge_reasoning: reasoning,
        protoforge_enforced: enforcing,
      };

      if (enforcing && (decision === 'reject' || decision === 'escalate')) {
        console.log(`[Orchestrator] Action ${action.type} ${decision} by ProtoForge — not executed`);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, ...gateMeta },
        });
        results.push({ type: action.type, status: 'failed', error: `blocked by ProtoForge (${decision})` });
        continue;
      }

      try {
        const agent = this.agentRegistry.getAgentFor(action.type);
        const outcome = agent
          ? await agent.execute(action, sessionId)
          : await this.actionExecutor.execute(action, sessionId);
        console.log(`[Orchestrator] Executed action: ${action.type} -> ${outcome.status} (${agent ? agent.id : 'actionExecutor (no registered agent)'})`);

        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: outcome.status,
          payload: { ...action.payload, result: outcome.result, error: outcome.error, ...gateMeta },
        });
        await this.recordActionOutcome(decisionId, outcome.status === 'completed' ? 'success' : 'failure', {
          error: outcome.error,
        });
        results.push({ type: action.type, status: outcome.status, error: outcome.error });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Orchestrator] Action execution failed for ${action.type}:`, error);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, error: message, ...gateMeta },
        });
        await this.recordActionOutcome(decisionId, 'failure', { error: message });
        results.push({ type: action.type, status: 'failed', error: message });
      }
    }

    return results;
  }

  /**
   * Backfill a ProtoForge decision's outcome after execution — the
   * self-evaluation feedback loop. Never throws: a failure here shouldn't
   * fail chat processing, it's an audit-trail nicety, not load-bearing.
   */
  private async recordActionOutcome(
    decisionId: string | undefined,
    outcome: 'success' | 'failure',
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (!decisionId) return;
    try {
      const { recordOutcome } = (await import('./protoforge/policy-engine.js')) as unknown as {
        recordOutcome: (id: string, outcome: string, detail?: Record<string, unknown>) => Promise<void>;
      };
      await recordOutcome(decisionId, outcome, detail);
    } catch (error) {
      console.error('[Orchestrator] Failed to record ProtoForge outcome:', error instanceof Error ? error.message : 'Unknown error');
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
      allowed_actions: this.allowedActionTypes,
      agent_metrics: this.agentRegistry.getMetricsSnapshot()
    };
  }
}
