/**
 * API LAYER — /api/cognitive
 *
 * Production entry point for the governed HEIDI Cognitive Core.
 *
 * Endpoints:
 *   GET  /api/cognitive                        — CognitiveCore + loop status
 *   POST /api/cognitive                        — Run a single governed cognitive cycle
 *   POST /api/cognitive?action=resume          — Resume goals after restart
 *   POST /api/cognitive?action=loop_start      — Start bounded continuous loop
 *   POST /api/cognitive?action=loop_stop       — Stop continuous loop
 *   POST /api/cognitive?action=loop_pause      — Pause continuous loop
 *   POST /api/cognitive?action=loop_resume     — Resume paused loop
 *   POST /api/cognitive?action=kill_switch     — Activate kill switch
 *   POST /api/cognitive?action=kill_switch_off — Deactivate kill switch
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
import type { LoopStatus } from '../../lib/heidi/CognitiveCore';

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
  loop: LoopStatus | null;
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

type LoopActionResponse = {
  action: string;
  success: boolean;
  loop: LoopStatus | null;
  message: string;
  timestamp: string;
};

type ErrorResponse = {
  error: string;
  timestamp: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CognitiveStatusResponse | CognitiveCycleResponse | LoopActionResponse | ErrorResponse>,
) {
  if (req.method === 'GET') {
    // ─── Status ──────────────────────────────────────────────────────
    try {
      const orchestrator = new HeidiOrchestrator();
      const status = orchestrator.getCognitiveStatus();
      const loopStatus = orchestrator.getCognitiveLoopStatus();
      res.status(200).json({
        cognitiveCore: status,
        loop: loopStatus,
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

      // ─── Loop control actions ────────────────────────────────────────
      if (action === 'loop_start') {
        const intervalMs = typeof req.body?.intervalMs === 'number' ? req.body.intervalMs : undefined;
        await orchestrator.startCognitiveLoop(intervalMs);
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'loop_start',
          success: true,
          loop,
          message: 'Cognitive loop started. R0/R1 only. R2+ requires human authorization.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'loop_stop') {
        orchestrator.stopCognitiveLoop();
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'loop_stop',
          success: true,
          loop,
          message: 'Cognitive loop stopped.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'loop_pause') {
        orchestrator.pauseCognitiveLoop();
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'loop_pause',
          success: true,
          loop,
          message: 'Cognitive loop paused.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'loop_resume') {
        orchestrator.resumeCognitiveLoop();
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'loop_resume',
          success: true,
          loop,
          message: 'Cognitive loop resumed.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'kill_switch') {
        const reason = (req.body?.reason as string) || 'manual activation';
        orchestrator.activateCognitiveKillSwitch(reason);
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'kill_switch',
          success: true,
          loop,
          message: `Kill switch activated: ${reason}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'kill_switch_off') {
        orchestrator.deactivateCognitiveKillSwitch();
        const loop = orchestrator.getCognitiveLoopStatus();
        res.status(200).json({
          action: 'kill_switch_off',
          success: true,
          loop,
          message: 'Kill switch deactivated.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (action === 'resume') {
        const result = await orchestrator.resumeCognitiveGoals();
        res.status(200).json({
          action: 'resume',
          success: true,
          loop: null,
          message: `Resumed ${result.resumedGoals} goals.`,
          timestamp: new Date().toISOString(),
        });
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
        error: `Cognitive operation failed: ${error instanceof Error ? error.message : 'unknown'}`,
        timestamp: new Date().toISOString(),
      });
    }
    return;
  }

  res.status(405).json({
    error: 'Method not allowed. Use GET for status or POST for cycle/loop operations.',
    timestamp: new Date().toISOString(),
  });
}
