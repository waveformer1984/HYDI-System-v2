/**
 * API LAYER — /api/cognitive
 *
 * Production entry point for the governed HEIDI Cognitive Core.
 *
 * This endpoint exposes the CognitiveCore that is wired with REAL providers
 * via CognitiveCoreBuilder. It does NOT use mocks or bridgeOverrides.
 *
 * Endpoints:
 *   GET  /api/cognitive          — CognitiveCore status (initialized, providers, capabilities)
 *   POST /api/cognitive          — Run a single governed cognitive cycle
 *   POST /api/cognitive?action=resume — Resume goals after restart
 *
 * Governance is enforced inside CognitiveCore:
 *   OBSERVE → VALIDATE → UNDERSTAND → PLAN → ASSESS → SELECT →
 *   AUTHORIZE → EXECUTE → VERIFY → LEARN → RECORD → REPLAN/ESCALATE
 *
 * R2+ actions remain human-required. R5 remains prohibited.
 * Autonomy level is NOT increased by this endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../lib/orchestrator';

type CognitiveStatusResponse = {
  cognitiveCore: {
    initialized: boolean;
    instanceId: string | null;
    initError: string | null;
    cycleCount: number;
    capabilitySummary: { total: number; available: number; unavailable: number } | null;
    currentPhase: string | null;
    autonomyLevel: number | null;
  };
  timestamp: string;
};

type CognitiveCycleResponse = {
  cycleId: string;
  phase: string;
  identity: { autonomyLevel: number; role: string } | null;
  perception: {
    systemHealth: string;
    componentCount: number;
    components: Array<{ name: string; status: string; evidence: string }>;
  } | null;
  selectedAction: { actionType: string; capabilityId: string | null; riskLevel: string } | null;
  authorization: { authorized: boolean; mode: string; reason: string } | null;
  execution: { executed: boolean; outcome: string; details: string } | null;
  verification: { verified: boolean; expectedState: string; actualState: string } | null;
  learning: { lessonLearned: boolean; outcomeClassification: string } | null;
  replan: { replanned: boolean; deviationReason: string | null } | null;
  errors: string[];
  durationMs: number;
  timestamp: string;
};

type ErrorResponse = {
  error: string;
  timestamp: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CognitiveStatusResponse | CognitiveCycleResponse | ErrorResponse>,
) {
  if (req.method === 'GET') {
    // ─── Status ──────────────────────────────────────────────────────
    try {
      const orchestrator = new HeidiOrchestrator();
      const status = orchestrator.getCognitiveStatus();
      res.status(200).json({
        cognitiveCore: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        error: `CognitiveCore status failed: ${error instanceof Error ? error.message : 'unknown'}`,
        timestamp: new Date().toISOString(),
      });
    }
    return;
  }

  if (req.method === 'POST') {
    const action = req.query.action as string | undefined;

    try {
      const orchestrator = new HeidiOrchestrator();

      if (action === 'resume') {
        // ─── Resume goals after restart ────────────────────────────────
        const result = await orchestrator.resumeCognitiveGoals();
        res.status(200).json({
          cycleId: 'resume',
          phase: 'resume',
          identity: null,
          perception: null,
          selectedAction: null,
          authorization: null,
          execution: null,
          verification: null,
          learning: null,
          replan: null,
          errors: [],
          durationMs: 0,
          timestamp: new Date().toISOString(),
          // Include resume result in a way the type allows
          ...(result as unknown as Record<string, unknown>),
        } as CognitiveCycleResponse);
        return;
      }

      // ─── Run a single governed cognitive cycle ──────────────────────
      const state = await orchestrator.runCognitiveCycle();

      res.status(200).json({
        cycleId: state.cycleId,
        phase: state.phase,
        identity: state.identity
          ? { autonomyLevel: state.identity.autonomyLevel, role: state.identity.role }
          : null,
        perception: state.perception
          ? {
              systemHealth: state.perception.systemHealth,
              componentCount: state.perception.components.length,
              components: state.perception.components.map((c) => ({
                name: c.name,
                status: c.status,
                evidence: c.evidence,
              })),
            }
          : null,
        selectedAction: state.selectedAction
          ? {
              actionType: state.selectedAction.actionType,
              capabilityId: state.selectedAction.capabilityId,
              riskLevel: state.selectedAction.riskLevel,
            }
          : null,
        authorization: state.authorizationResult
          ? {
              authorized: state.authorizationResult.authorized,
              mode: state.authorizationResult.authorizationMode,
              reason: state.authorizationResult.reason,
            }
          : null,
        execution: state.executionResult
          ? {
              executed: state.executionResult.executed,
              outcome: state.executionResult.outcome,
              details: state.executionResult.details,
            }
          : null,
        verification: state.verificationResult
          ? {
              verified: state.verificationResult.verified,
              expectedState: state.verificationResult.expectedState,
              actualState: state.verificationResult.actualState,
            }
          : null,
        learning: state.learningResult
          ? {
              lessonLearned: state.learningResult.lessonLearned,
              outcomeClassification: state.learningResult.outcomeClassification,
            }
          : null,
        replan: state.replanResult
          ? {
              replanned: state.replanResult.replanned,
              deviationReason: state.replanResult.deviationReason,
            }
          : null,
        errors: state.errors,
        durationMs: state.durationMs,
        timestamp: state.timestamp,
      });
    } catch (error) {
      res.status(500).json({
        error: `Cognitive cycle failed: ${error instanceof Error ? error.message : 'unknown'}`,
        timestamp: new Date().toISOString(),
      });
    }
    return;
  }

  res.status(405).json({
    error: 'Method not allowed. Use GET for status or POST for cycle execution.',
    timestamp: new Date().toISOString(),
  });
}
