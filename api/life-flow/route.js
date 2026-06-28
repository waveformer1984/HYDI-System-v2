/**
 * Deep Life Architect API Routes
 *
 * This file provides REST API endpoints for the Deep Life Architect system,
 * allowing external applications to interact with life-flow analysis functionality.
 */

const HYDISystem = require('../../src/HYDISystem');
const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken');

// Initialize HYDI system with Deep Life Architect enabled
const hydiSystem = new HYDISystem({
  enableLifeFlowAnalysis: true,
  enableRevenueMode: false,
  enableSelfAwareness: true,
  hardwareInterval: 5000,
  softwareInterval: 10000,
  analysisInterval: 60000
});

// Start the system
hydiSystem.start().catch(console.error);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-hydi-service-token');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify service token — callers must present x-hydi-service-token.
  const tokenResult = verifyServiceToken(req.headers['x-hydi-service-token']);
  if (!tokenResult.valid) {
    return res.status(401).json({ success: false, error: 'Unauthorized', reason: tokenResult.reason });
  }

  try {
    const { type, subtype, params } = req.body || {};

    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'Missing request type'
      });
    }

    // Process request through HYDI system
    const result = await hydiSystem.processRequest({
      type,
      subtype,
      params,
      context: {
        userId: tokenResult.service,
        sessionId: req.headers['x-session-id'] || 'default',
        tier: req.headers['x-tier'] || 'starter'
      }
    });
    
    return res.status(200).json({
      success: true,
      data: result.result,
      requestId: result.requestId,
      duration: result.duration
    });
    
  } catch (error) {
    console.error('[LIFE-FLOW API] Error:', error.message);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * API ENDPOINT EXAMPLES:
 * 
 * Start a life-flow session:
 * POST /api/life-flow
 * {
 *   "type": "life_flow",
 *   "subtype": "start_session",
 *   "params": {
 *     "intent": "Deep Work: Coding"
 *   }
 * }
 * 
 * End current session:
 * POST /api/life-flow
 * {
 *   "type": "life_flow",
 *   "subtype": "end_session"
 * }
 * 
 * Get real-time analysis:
 * POST /api/life-flow
 * {
 *   "type": "life_flow",
 *   "subtype": "real_time_analysis"
 * }
 * 
 * Get hardware telemetry:
 * POST /api/life-flow
 * {
 *   "type": "life_flow",
 *   "subtype": "hardware_telemetry"
 * }
 * 
 * Get weekly report:
 * POST /api/life-flow
 * {
 *   "type": "life_flow",
 *   "subtype": "weekly_report"
 * }
 * 
 * Get system status:
 * POST /api/life-flow
 * {
 *   "type": "system",
 *   "subtype": "status"
 * }
 */
