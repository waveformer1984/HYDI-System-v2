/**
 * API LAYER - /api/execute
 *
 * Executes parsed actions with schema validation before execution.
 */

import { NextApiRequest, NextApiResponse } from 'next'

type ActionPayload = Record<string, unknown>

interface ExecuteAction {
  type: string
  payload: ActionPayload
}

interface ActionResult {
  action: ExecuteAction
  status: 'completed' | 'failed'
  result?: Record<string, unknown>
  error?: string
}

interface ExecuteRequest {
  session_id: string
  actions: ExecuteAction[]
}

const ALLOWED_ACTION_TYPES = [
  'send_email',
  'create_task',
  'update_database',
  'fetch_data',
  'schedule_event',
] as const

type AllowedActionType = typeof ALLOWED_ACTION_TYPES[number]

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { session_id, actions }: ExecuteRequest = req.body

    if (!session_id || !actions) {
      res.status(400).json({ error: 'Missing required fields: session_id, actions' })
      return
    }

    if (!Array.isArray(actions)) {
      res.status(400).json({ error: 'actions must be an array' })
      return
    }

    const results: ActionResult[] = []

    for (const action of actions) {
      if (!action.type || typeof action.type !== 'string') {
        results.push({ action, status: 'failed', error: 'Action must have a valid type string' })
        continue
      }
      if (!action.payload || typeof action.payload !== 'object') {
        results.push({ action, status: 'failed', error: 'Action must have a valid payload object' })
        continue
      }
      if (!(ALLOWED_ACTION_TYPES as readonly string[]).includes(action.type)) {
        results.push({ action, status: 'failed', error: `Action type '${action.type}' not allowed` })
        continue
      }

      try {
        const result = await executeAction(action.type as AllowedActionType, action.payload, session_id)
        results.push({ action, status: 'completed', result })
      } catch (err) {
        console.error(`Action execution failed for ${action.type}:`, err)
        results.push({
          action,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    res.status(200).json({
      session_id,
      results,
      total_actions: actions.length,
      completed: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'failed').length,
    })

  } catch (err) {
    console.error('Execute API error:', err)
    res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

async function executeAction(
  type: AllowedActionType,
  payload: ActionPayload,
  _sessionId: string
): Promise<Record<string, unknown>> {
  switch (type) {
    case 'send_email':    return sendEmail(payload)
    case 'create_task':   return createTask(payload)
    case 'update_database': return updateDatabase(payload)
    case 'fetch_data':    return fetchData(payload)
    case 'schedule_event': return scheduleEvent(payload)
  }
}

async function sendEmail(payload: ActionPayload): Promise<Record<string, unknown>> {
  console.warn('[ACTION] send_email', payload)
  return { sent: true, message_id: `msg_${Date.now()}` }
}

async function createTask(payload: ActionPayload): Promise<Record<string, unknown>> {
  console.warn('[ACTION] create_task', payload)
  return { task_id: `task_${Date.now()}`, created: true }
}

async function updateDatabase(payload: ActionPayload): Promise<Record<string, unknown>> {
  console.warn('[ACTION] update_database', payload)
  return { updated: true, affected_rows: 1 }
}

async function fetchData(payload: ActionPayload): Promise<Record<string, unknown>> {
  console.warn('[ACTION] fetch_data', payload)
  return { data: `sample_data_${Date.now()}`, count: 42 }
}

async function scheduleEvent(payload: ActionPayload): Promise<Record<string, unknown>> {
  console.warn('[ACTION] schedule_event', payload)
  return { scheduled: true, event_id: `event_${Date.now()}` }
}
