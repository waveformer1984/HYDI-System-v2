/**
 * API LAYER - /api/execute
 * 
 * Executes parsed actions ONLY with schema validation before execution
 */

import { NextApiRequest, NextApiResponse } from 'next';

interface ExecuteRequest {
  session_id: string;
  actions: Array<{
    type: string;
    payload: Record<string, any>;
  }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { session_id, actions }: ExecuteRequest = req.body;

    if (!session_id || !actions) {
      return res.status(400).json({ 
        error: 'Missing required fields: session_id, actions' 
      });
    }

    if (!Array.isArray(actions)) {
      return res.status(400).json({ 
        error: 'actions must be an array' 
      });
    }

    // Validate schema for each action
    const allowedActionTypes = ['send_email', 'create_task', 'update_database', 'fetch_data', 'schedule_event'];
    const results = [];

    for (const action of actions) {
      // Validate action structure
      if (!action.type || typeof action.type !== 'string') {
        results.push({
          action,
          status: 'failed',
          error: 'Action must have a valid type string'
        });
        continue;
      }

      if (!action.payload || typeof action.payload !== 'object') {
        results.push({
          action,
          status: 'failed',
          error: 'Action must have a valid payload object'
        });
        continue;
      }

      // Validate action type
      if (!allowedActionTypes.includes(action.type)) {
        results.push({
          action,
          status: 'failed',
          error: `Action type '${action.type}' not allowed`
        });
        continue;
      }

      // Execute action (async safe, never block)
      try {
        const result = await executeAction(action.type, action.payload, session_id);
        results.push({
          action,
          status: 'completed',
          result
        });
      } catch (error) {
        console.error(`Action execution failed for ${action.type}:`, error);
        results.push({
          action,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.status(200).json({
      session_id,
      results,
      total_actions: actions.length,
      completed: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'failed').length
    });

  } catch (error) {
    console.error('Execute API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Execute individual action
 */
async function executeAction(type: string, payload: Record<string, any>, sessionId: string): Promise<any> {
  switch (type) {
    case 'send_email':
      return await sendEmail(payload, sessionId);
    case 'create_task':
      return await createTask(payload, sessionId);
    case 'update_database':
      return await updateDatabase(payload, sessionId);
    case 'fetch_data':
      return await fetchData(payload, sessionId);
    case 'schedule_event':
      return await scheduleEvent(payload, sessionId);
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

/**
 * Action implementations (simplified for demo)
 */
async function sendEmail(payload: any, _sessionId: string): Promise<any> {
  // In production, integrate with actual email service
  console.log(`[ACTION] Sending email:`, payload);
  return { sent: true, message_id: `msg_${Date.now()}` };
}

async function createTask(payload: any, _sessionId: string): Promise<any> {
  // In production, integrate with task management system
  console.log(`[ACTION] Creating task:`, payload);
  return { task_id: `task_${Date.now()}`, created: true };
}

async function updateDatabase(payload: any, _sessionId: string): Promise<any> {
  // In production, integrate with database service
  console.log(`[ACTION] Updating database:`, payload);
  return { updated: true, affected_rows: 1 };
}

async function fetchData(payload: any, _sessionId: string): Promise<any> {
  // In production, integrate with data service
  console.log(`[ACTION] Fetching data:`, payload);
  return { data: `sample_data_${Date.now()}`, count: 42 };
}

async function scheduleEvent(payload: any, _sessionId: string): Promise<any> {
  // In production, integrate with scheduling service
  console.log(`[ACTION] Scheduling event:`, payload);
  return { scheduled: true, event_id: `event_${Date.now()}` };
}
