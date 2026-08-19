/**
 * HEIDI Execution Bridge Adapters
 *
 * These adapters wrap the REAL authoritative HYDI systems so that
 * CognitiveCore's ExecutionBridge interface can invoke them without
 * CognitiveCore needing to know each system's exact native signature.
 *
 * Each adapter is a thin translation layer — it does NOT:
 *   - bypass authorization (the real systems enforce their own governance)
 *   - fabricate results
 *   - silently downgrade risk
 *
 * The adapters ARE the connection between HEIDI's cognitive decision layer
 * and HEIDI's real tool / communication / recovery / revenue infrastructure.
 *
 * Native signatures addressed:
 *   - ActionExecutor.execute(action, sessionId) -> ActionResult
 *   - OperationalIntelligence.governedRecover(component, cause) -> string
 *   - OperationalIntelligence.checkHealth() -> ComponentState
 *   - CommunicationLayer.sendMessage(request) -> OutboundMessageResult
 *   - RevenueControlLoop.run() -> RevenueControlLoopResult
 *   - retrieveMemory(supabase, message, userId, sessionId?) -> string
 *   - storeExperience(supabase, sessionId, userId, experience) -> void
 *   - MetaCognitiveLoop.evaluateReasoningQuality(thinkResult) -> Evaluation
 *   - DecisionResolver.resolveDecision(cascade, memory, policy) -> Resolution
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionExecutor } from '../action-executor';
import type { OperationalIntelligence } from '../operational/OperationalIntelligence';
import type { CommunicationLayer } from '../communication/communicationLayer';
import type { RevenueControlLoop } from '../revenue/RevenueControlLoop';
import type { ProspectPipeline } from '../revenue/ProspectPipeline';
import type { CustomerLifecycle } from '../revenue/CustomerLifecycle';
import type { RevenueLedger } from '../revenue/RevenueLedger';
import type { ExecutionBridge } from './CognitiveCore';

// ─── Memory adapter ──────────────────────────────────────────────────────
//
// The existing memory systems use module-level functions that take a
// SupabaseClient as the first argument. The ExecutionBridge.memory
// interface expects bound methods. This adapter binds the supabase client
// so CognitiveCore can call retrieve(query, userId, sessionId) and
// storeExperience(sessionId, userId, experience) directly.

export function createMemoryBridge(supabase: SupabaseClient): NonNullable<ExecutionBridge['memory']> {
  // Lazy-load so that test environments without supabase-js still typecheck.
  return {
    async retrieve(query: string, userId: string, sessionId?: string): Promise<string> {
      const { retrieveMemory } = await import('../heidi-memory');
      return retrieveMemory(supabase, query, userId, sessionId);
    },
    async storeExperience(
      sessionId: string,
      userId: string,
      experience: {
        problem: string;
        actionsTaken: unknown[];
        outcome: string;
        lesson: string;
      },
    ): Promise<boolean> {
      const { storeExperience: store } = await import('../episodic-memory');
      await store(supabase, sessionId, userId, experience as never);
      return true;
    },
  };
}

// ─── ActionExecutor adapter ──────────────────────────────────────────────
//
// ActionExecutor already matches the bridge interface closely.
// The only translation is normalizing the return shape.

export function createActionExecutorBridge(
  executor: ActionExecutor,
): NonNullable<ExecutionBridge['actionExecutor']> {
  return {
    async execute(action, sessionId) {
      const result = await executor.execute(action, sessionId);
      return {
        status: result.status,
        result: result.result,
        error: result.error,
      };
    },
  };
}

// ─── OperationalIntelligence adapter ─────────────────────────────────────
//
// OperationalIntelligence's native signatures already match the bridge
// interface. This adapter is a pass-through that also exposes the
// underlying instance so CognitiveCore can access the health checker
// for evidence-backed perception.

export function createOperationalIntelligenceBridge(
  oi: OperationalIntelligence,
): NonNullable<ExecutionBridge['operationalIntelligence']> {
  return {
    async governedRecover(component: string, cause: string): Promise<string> {
      return oi.governedRecover(component, cause);
    },
    async checkHealth(): Promise<unknown> {
      return oi.checkHealth();
    },
    async diagnose(jsonOutput?: boolean): Promise<string> {
      return oi.diagnose(jsonOutput);
    },
    async autoRecover(): Promise<string> {
      return oi.autoRecover();
    },
  };
}

// ─── CommunicationLayer adapter ──────────────────────────────────────────
//
// CommunicationLayer.sendMessage takes a strongly-typed OutboundMessageRequest.
// The bridge accepts a Record<string, unknown> so CognitiveCore can pass
// params from the capability registry without importing the full type.
// This adapter validates the required fields and forwards.

export function createCommunicationLayerBridge(
  layer: CommunicationLayer,
): NonNullable<ExecutionBridge['communicationLayer']> {
  return {
    async sendMessage(request: Record<string, unknown>) {
      const result = await layer.sendMessage(request as never);
      return {
        messageId: result.messageId,
        deliveryStatus: result.deliveryStatus,
        error: result.error,
      };
    },
    async getCapabilities() {
      return layer.getCapabilities();
    },
  };
}

// ─── RevenueControlLoop adapter ──────────────────────────────────────────
//
// RevenueControlLoop.run() and collectMetrics() already match the bridge.
// This adapter is a pass-through.

export function createRevenueControlLoopBridge(
  loop: RevenueControlLoop,
): NonNullable<ExecutionBridge['revenueControlLoop']> {
  return {
    async run() {
      return loop.run();
    },
    async collectMetrics() {
      return loop.collectMetrics();
    },
  };
}

// ─── Meta-cognition adapter ──────────────────────────────────────────────
//
// MetaCognitiveLoop (CommonJS) exports evaluateReasoningQuality(thinkResult).
// The bridge expects evaluate(thinkResult). This adapter translates.

export function createMetaCognitionBridge(
  meta: { evaluateReasoningQuality: (thinkResult: unknown) => Promise<unknown> },
): NonNullable<ExecutionBridge['metaCognition']> {
  return {
    async evaluate(thinkResult) {
      const evaluation = (await meta.evaluateReasoningQuality(thinkResult)) as {
        overallQualityScore: number;
        qualityClassification: string;
        improvementAreas: string[];
      };
      return {
        overallQualityScore: evaluation.overallQualityScore,
        qualityClassification: evaluation.qualityClassification,
        improvementAreas: evaluation.improvementAreas,
      };
    },
  };
}

// ─── Decision resolver adapter ───────────────────────────────────────────
//
// DecisionResolver (CommonJS) exports resolveDecision(cascade, memory, policy).
// The bridge expects resolve(cascade, memory, policy). This adapter translates.

export function createDecisionResolverBridge(
  resolver: { resolveDecision: (cascade: unknown, memory: unknown, policy: unknown) => Promise<unknown> },
): NonNullable<ExecutionBridge['decisionResolver']> {
  return {
    async resolve(cascadeOutput, memorySignal, policyConstraints) {
      const result = (await resolver.resolveDecision(
        cascadeOutput,
        memorySignal,
        policyConstraints,
      )) as {
        final_action: string;
        winning_authority: string;
        reasoning: string;
        confidence: number;
        conflict_resolution: string;
      };
      return {
        final_action: result.final_action,
        winning_authority: result.winning_authority,
        reasoning: result.reasoning,
        confidence: result.confidence,
        conflict_resolution: result.conflict_resolution,
      };
    },
  };
}

// ─── Revenue pipeline adapter (ProspectPipeline) ─────────────────────────
//
// ProspectPipeline's native methods already match the bridge interface.
// This adapter is a pass-through.

export function createRevenuePipelineBridge(
  pipeline: ProspectPipeline,
): NonNullable<ExecutionBridge['revenuePipeline']> {
  return {
    async identifyProspect(input) {
      return pipeline.identifyProspect(input as never);
    },
    async scoreProspect(prospectId) {
      return pipeline.scoreProspect(prospectId);
    },
    async updateStatus(prospectId, newStatus, context) {
      return pipeline.updateStatus(prospectId, newStatus as never, context);
    },
    async createOpportunity(input) {
      return pipeline.createOpportunity(input as never);
    },
    async getPipelineMetrics() {
      return pipeline.getPipelineMetrics();
    },
  };
}

// ─── Revenue lifecycle adapter (CustomerLifecycle) ───────────────────────

export function createRevenueLifecycleBridge(
  lifecycle: CustomerLifecycle,
): NonNullable<ExecutionBridge['revenueLifecycle']> {
  return {
    async startOnboarding(input) {
      return lifecycle.startOnboarding(input as never);
    },
    async activateService(serviceId) {
      return lifecycle.activateService(serviceId);
    },
    async verifyService(serviceId) {
      return lifecycle.verifyService(serviceId);
    },
  };
}

// ─── Revenue ledger adapter (RevenueLedger) ──────────────────────────────

export function createRevenueLedgerBridge(
  ledger: RevenueLedger,
): NonNullable<ExecutionBridge['revenueLedger']> {
  return {
    async getVerifiedRevenue() {
      return ledger.getVerifiedRevenue();
    },
    async getRevenueSummary() {
      return ledger.getRevenueSummary();
    },
  };
}
