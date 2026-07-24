/**
 * POST /api/self-improvement/orchestrate - Run complete HEIDI self-improvement cycle
 *
 * Phases 4-8: Version Control → Validation → Deployment → Approval → Orchestration
 *
 * Query params:
 *   - hours: Time period for analysis (default: 24)
 *   - autoApprove: Auto-approve recommendations with high confidence (default: false)
 *   - dryRun: Simulate without actual deployment (default: true)
 */

import ImprovementManager from '../../../src/improvement/ImprovementManager';

const manager = new ImprovementManager(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      hours = 24,
      autoApprove = false,
      dryRun = true,
    } = req.method === 'GET' ? req.query : req.body;

    console.log(`[Self-Improvement] Starting cycle: hours=${hours}, autoApprove=${autoApprove}, dryRun=${dryRun}`);

    // Run complete improvement cycle
    const cycleResult = await manager.runFullImprovementCycle(parseInt(hours) || 24);

    if (!cycleResult.success) {
      return res.status(400).json({
        success: false,
        error: cycleResult.error,
        cycleId: cycleResult.cycleId,
      });
    }

    return res.status(200).json({
      success: true,
      cycle: cycleResult,
      timestamp: new Date().toISOString(),
      dryRun,
      autoApprove,
    });
  } catch (err) {
    console.error('[Self-Improvement] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
