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
import {
  buildPlanPrompt,
  createWorkSession,
  getWorkSession,
  nextPendingStep,
  PlanParser,
  updateWorkSession,
  WorkSession,
} from './work-sessions';
import { getDecisionStats, getMemoryRetrievalStats, getRetryStats, getTaskSuccessRates, getWorkSessionStats } from './metrics';
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
      await this.recordMemoryRetrieval(request.session_id, memoryContext.length > 0);

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
        await this.recordRetry(request.session_id, 'chat_response', retryParse.success, parseResult.error);
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
        actions: actionResults,
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
   *
   * A 'reject' verdict (enforcing only) blocks the action outright — it
   * never executes and there is nothing to review later. An 'escalate'
   * verdict does NOT block: it parks the action as a `pending` row carrying
   * everything lib/action-approval.ts needs to run it later (action type,
   * payload, decisionId), and returns status 'pending_approval' instead of
   * executing or failing. The chat UI surfaces these as approve/reject
   * cards; resolving one calls lib/action-approval.ts directly, not this
   * method, so a human decision is never re-gated through KILO/ProtoForge.
   */
  private async executeActions(
    actions: ParsedResponse['actions'],
    sessionId: string,
  ): Promise<Array<{ type: string; status: 'completed' | 'failed' | 'pending_approval'; error?: string; actionId?: string }>> {
    const verdicts = await gateActions(actions, sessionId);
    const enforcing = isEnforcing();
    const results: Array<{ type: string; status: 'completed' | 'failed' | 'pending_approval'; error?: string; actionId?: string }> = [];

    for (const { action, decision, confidence, hypotheses, reasoning, decisionId } of verdicts) {
      const gateMeta = {
        protoforge_decision: decision,
        protoforge_confidence: confidence,
        protoforge_hypotheses: hypotheses,
        protoforge_reasoning: reasoning,
        protoforge_enforced: enforcing,
      };

      if (enforcing && decision === 'reject') {
        console.log(`[Orchestrator] Action ${action.type} rejected by ProtoForge — not executed`);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, ...gateMeta },
        });
        results.push({ type: action.type, status: 'failed', error: `blocked by ProtoForge (${decision})` });
        continue;
      }

      if (enforcing && decision === 'escalate') {
        console.log(`[Orchestrator] Action ${action.type} escalated by ProtoForge — awaiting human approval`);
        const { data, error } = await this.supabase
          .from('actions')
          .insert({
            session_id: sessionId,
            task_name: action.type,
            status: 'pending',
            payload: {
              ...gateMeta,
              protoforge_pending_approval: true,
              protoforge_action_type: action.type,
              protoforge_action_payload: action.payload,
              protoforge_decision_id: decisionId,
            },
          })
          .select('id')
          .single();
        if (error) {
          console.error('[Orchestrator] Failed to queue escalated action:', error.message);
          results.push({ type: action.type, status: 'failed', error: `escalation queue failed: ${error.message}` });
          continue;
        }
        results.push({ type: action.type, status: 'pending_approval', actionId: data?.id });
        continue;
      }

      try {
        const agent = this.agentRegistry.getAgentFor(action.type);
        const outcome = agent
          ? await agent.execute(action, sessionId)
          : await this.actionExecutor.execute(action, sessionId);
        console.log(`[Orchestrator] Executed action: ${action.type} -> ${outcome.status} (${agent ? agent.id : 'actionExecutor (no registered agent)'})`);

        const { data } = await this.supabase
          .from('actions')
          .insert({
            session_id: sessionId,
            task_name: action.type,
            status: outcome.status,
            payload: { ...action.payload, result: outcome.result, error: outcome.error, ...gateMeta },
          })
          .select('id')
          .single();
        await this.recordActionOutcome(decisionId, outcome.status === 'completed' ? 'success' : 'failure', {
          error: outcome.error,
        });
        results.push({ type: action.type, status: outcome.status, error: outcome.error, actionId: data?.id });
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
        recordOutcome: (_id: string, _outcome: string, _detail?: Record<string, unknown>) => Promise<void>;
      };
      await recordOutcome(decisionId, outcome, detail);
    } catch (error) {
      console.error('[Orchestrator] Failed to record ProtoForge outcome:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Records whether the self-correction retry loop (ActionParser's chat
   * JSON contract, PlanParser's plan JSON contract) succeeded after a
   * malformed first attempt — Phase 5's "retry counts" metric. Reuses the
   * `actions` table (task_name = 'llm_retry') rather than a new table;
   * `task_name` has no CHECK constraint restricting it to real action
   * types. Never throws.
   */
  private async recordRetry(
    sessionId: string,
    stage: 'chat_response' | 'work_session_plan',
    succeeded: boolean,
    originalError?: string,
  ): Promise<void> {
    try {
      await this.supabase.from('actions').insert({
        session_id: sessionId,
        task_name: 'llm_retry',
        status: succeeded ? 'completed' : 'failed',
        payload: { stage, original_error: originalError },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to record retry:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Records whether semantic memory retrieval found relevant context for
   * this turn — retrieval *coverage*, not *quality* (there's no feedback
   * signal for whether retrieved context was actually useful, only
   * whether anything was found; see lib/metrics.ts's header comment).
   * Reuses the `actions` table (task_name = 'memory_retrieval'). Never
   * throws.
   */
  private async recordMemoryRetrieval(sessionId: string, hadContext: boolean): Promise<void> {
    try {
      await this.supabase.from('actions').insert({
        session_id: sessionId,
        task_name: 'memory_retrieval',
        status: 'completed',
        payload: { had_context: hadContext },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to record memory retrieval:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Start a Phase 4 work session (see HYDI_KERNEL_ARCHITECTURE_ROADMAP.md):
   * decompose `goal` into an ordered plan using only the existing action
   * vocabulary (this.allowedActionTypes — no new code-editing/test-running/
   * git capability), persist it, then run steps until the plan completes,
   * a step fails or is ProtoForge-blocked, or `maxSteps` is reached.
   */
  async startWorkSession(goal: string, sessionId: string, userId: string, maxSteps = 5): Promise<WorkSession | null> {
    const prompt = buildPlanPrompt(goal, this.allowedActionTypes);
    const modelResponse = await this.modelManager.generateResponse(prompt, sessionId);

    let parseResult = PlanParser.parsePlan(modelResponse.content);
    if (!parseResult.success || !parseResult.plan) {
      console.log('[Orchestrator] Invalid plan, retrying with corrected prompt');
      const originalError = parseResult.error;
      const correctedPrompt = PlanParser.generateCorrectedPrompt(prompt, parseResult.error || 'Unknown error');
      const retryResponse = await this.modelManager.generateResponse(correctedPrompt, sessionId);
      parseResult = PlanParser.parsePlan(retryResponse.content);
      await this.recordRetry(sessionId, 'work_session_plan', parseResult.success, originalError);
    }

    const rawSteps = parseResult.success && parseResult.plan ? parseResult.plan.steps : [];
    const steps = PlanParser.filterAllowedSteps(rawSteps, this.allowedActionTypes);

    const session = await createWorkSession(this.supabase, { session_id: sessionId, user_id: userId, goal, steps });
    if (!session) return null;

    return this.runWorkSession(session.id, sessionId, maxSteps);
  }

  /**
   * Run pending steps of an existing work session, one at a time, through
   * the same gating pipeline as ordinary chat actions (executeActions —
   * KILO -> ProtoForge -> agent registry). Stops on the first
   * failed/blocked step, when the plan completes, or after `maxSteps` —
   * bounded per call, not an unbounded loop, per "reliability before
   * autonomy."
   */
  async runWorkSession(workSessionId: string, sessionId: string, maxSteps = 5): Promise<WorkSession | null> {
    let session = await getWorkSession(this.supabase, workSessionId);
    if (!session) return null;

    let stepsRun = 0;
    while (stepsRun < maxSteps) {
      const step = nextPendingStep(session);
      if (!step) {
        session =
          (await updateWorkSession(this.supabase, workSessionId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
          })) ?? session;
        break;
      }

      const [result] = await this.executeActions([{ type: step.type, payload: step.payload }], sessionId);
      step.status = result.status;
      step.error = result.error;
      stepsRun++;

      if (step.status === 'pending_approval') {
        console.log(`[Orchestrator] Work session ${workSessionId} paused — step ${step.type} awaiting human approval`);
        session =
          (await updateWorkSession(this.supabase, workSessionId, { status: 'needs_approval', steps: session.steps })) ?? session;
        break;
      }

      if (step.status === 'failed') {
        console.log(`[Orchestrator] Work session ${workSessionId} paused — step ${step.type} failed: ${step.error}`);
        session =
          (await updateWorkSession(this.supabase, workSessionId, { status: 'failed', steps: session.steps })) ?? session;
        break;
      }

      session =
        (await updateWorkSession(this.supabase, workSessionId, { status: 'in_progress', steps: session.steps })) ?? session;
    }

    return session;
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string) {
    return await this.modelManager.getSessionState(sessionId);
  }

  /**
   * Get system status
   *
   * agent_metrics is per-process (resets every request — see
   * lib/metrics.ts's module comment for why); everything else is the
   * durable, Phase 5 cross-request signal, read from the
   * actions/decisions/work_sessions tables. Best-effort: a metrics query
   * failing degrades to an empty result via lib/metrics.ts's own error
   * handling, never throws here.
   */
  async getSystemStatus() {
    const [taskSuccessRates, decisionStats, workSessionStats, retryStats, memoryRetrievalStats] = await Promise.all([
      getTaskSuccessRates(this.supabase),
      getDecisionStats(this.supabase),
      getWorkSessionStats(this.supabase),
      getRetryStats(this.supabase),
      getMemoryRetrievalStats(this.supabase),
    ]);

    return {
      model_status: this.modelManager.getModelStatus(),
      memory_connected: !!this.supabase,
      allowed_actions: this.allowedActionTypes,
      agent_metrics: this.agentRegistry.getMetricsSnapshot(),
      task_success_rates: taskSuccessRates,
      decision_stats: decisionStats,
      work_session_stats: workSessionStats,
      retry_stats: retryStats,
      memory_retrieval_stats: memoryRetrievalStats,
    };
  }
}
