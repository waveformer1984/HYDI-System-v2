/**
 * Deep Life Architect API Routes
 * 
 * This file provides REST API endpoints for the Deep Life Architect system,
 * allowing external applications to interact with life-flow analysis functionality.
 */

const HYDISystem = require('../../src/HYDISystem');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('../../lib/auth/requireAuth');
const logger = require('../../lib/structured-logger').child({ component: 'api/life-flow/route' });

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

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
hydiSystem.start().catch((error) => logger.error('HYDI system start failed', { error }));

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const auth = await requireAuth(req, res, supabase, { permission: 'life_flow:manage', routeName: 'life-flow-route' });
  if (!auth.ok) return;

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
        userId: req.headers['x-user-id'] || 'anonymous',
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
    logger.error('Life-flow API error', { error: error.message });
    
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
