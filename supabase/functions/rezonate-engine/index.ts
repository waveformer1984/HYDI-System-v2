/**
 * rezonate-engine — Deno Edge Function
 *
 * Async task processor for the Rezonate DAW node.  Accepts a task via POST,
 * routes it to the appropriate stub handler, updates the `actions` table, and
 * returns a structured result.
 *
 * JWT enforcement: this file previously claimed enforcement was "disabled
 * here so the function can be invoked by internal service-role callers
 * without a user token" -- but this function has never actually had an
 * entry in supabase/config.toml, so the platform default of
 * `verify_jwt = true` has been silently enforced all along (a service-role
 * key is itself a valid JWT, so internal callers were never actually
 * blocked by this). Set explicitly to true in config.toml (2026-07 JWT
 * audit) to match the behavior that's actually been running and stop this
 * comment contradicting it.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// CORS headers — mirroring the convention used across this function suite
// ---------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Valid task types drawn from agents/rezonate_node/config.json
// ---------------------------------------------------------------------------
const VALID_TASK_TYPES = [
  'stem_analysis',
  'mix_analysis',
  'audio_export',
  'nft_mint',
  'rights_verify',
  'session_recall',
  'hardware_map',
  'beat_generate',
] as const

type TaskType = typeof VALID_TASK_TYPES[number]

// ---------------------------------------------------------------------------
// Request body shape
// ---------------------------------------------------------------------------
interface TaskRequest {
  task_id: string
  task_type: TaskType
  project_id: string
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Per-task handler stubs
// Each returns a plain object that is stored as the task result and forwarded
// to the caller.  Replace stub bodies with real logic as capabilities mature.
// ---------------------------------------------------------------------------

function handleStemAnalysis(_payload: Record<string, unknown>) {
  // Stub: real implementation will invoke stem-separation pipeline
  return { stems: [], bpm: null, key: null }
}

function handleMixAnalysis(_payload: Record<string, unknown>) {
  // Stub: real implementation will run loudness / spectral analysis
  return { levels: {}, clipping: false, suggestions: [] }
}

function handleAudioExport(payload: Record<string, unknown>) {
  // Stub: real implementation will queue a render job
  return {
    format: (payload.format as string) || 'wav',
    status: 'queued',
    file_path: null,
  }
}

function handleNftMint(_payload: Record<string, unknown>) {
  // Stub: real implementation will call the on-chain minting contract
  return { token_id: null, status: 'pending', chain: 'ethereum' }
}

function handleRightsVerify(_payload: Record<string, unknown>) {
  // Stub: real implementation will check rights registry / PRO databases
  return { rights_holder: null, status: 'unverified', metadata: {} }
}

function handleSessionRecall(project_id: string, _payload: Record<string, unknown>) {
  // Stub: real implementation will hydrate session state from the ledger
  return { session_id: project_id, state: 'restored', tracks: [] }
}

function handleHardwareMap(_payload: Record<string, unknown>) {
  // Stub: real implementation will enumerate MIDI / HID devices
  return { devices: [], mapping: {} }
}

function handleBeatGenerate(_payload: Record<string, unknown>) {
  // Stub: real implementation will invoke the beat-generation model
  return { pattern: [], bars: 4, bpm: 120 }
}

// ---------------------------------------------------------------------------
// Route a validated task_type to its handler
// ---------------------------------------------------------------------------
function routeTask(
  task_type: TaskType,
  project_id: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (task_type) {
    case 'stem_analysis':
      return handleStemAnalysis(payload)
    case 'mix_analysis':
      return handleMixAnalysis(payload)
    case 'audio_export':
      return handleAudioExport(payload)
    case 'nft_mint':
      return handleNftMint(payload)
    case 'rights_verify':
      return handleRightsVerify(payload)
    case 'session_recall':
      return handleSessionRecall(project_id, payload)
    case 'hardware_map':
      return handleHardwareMap(payload)
    case 'beat_generate':
      return handleBeatGenerate(payload)
  }
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------
function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Health-check — GET returns service metadata without touching the DB
  if (req.method === 'GET') {
    return jsonResponse(
      {
        status: 'active',
        service: 'rezonate-engine',
        version: '1.0.0',
        description: 'Async task processor for the Rezonate DAW node',
        accepted_task_types: VALID_TASK_TYPES,
        timestamp: new Date().toISOString(),
      },
      200,
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { headers: corsHeaders, status: 405 })
  }

  // Initialize the Supabase client with the service role key so we can write
  // to the actions table without RLS constraints from user JWTs.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let body: TaskRequest

  try {
    body = await req.json() as TaskRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { task_id, task_type, project_id, payload } = body

  // ------------------------------------------------------------------
  // Input validation
  // ------------------------------------------------------------------
  if (!task_id || typeof task_id !== 'string') {
    return jsonResponse({ error: 'task_id is required and must be a string' }, 400)
  }

  if (!task_type || !(VALID_TASK_TYPES as readonly string[]).includes(task_type)) {
    return jsonResponse(
      {
        error: `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}`,
        received: task_type ?? null,
      },
      400,
    )
  }

  if (!project_id || typeof project_id !== 'string') {
    return jsonResponse({ error: 'project_id is required and must be a string' }, 400)
  }

  const safePayload: Record<string, unknown> = payload && typeof payload === 'object'
    ? payload
    : {}

  // ------------------------------------------------------------------
  // Execute the task handler
  // ------------------------------------------------------------------
  let result: Record<string, unknown>

  try {
    result = routeTask(task_type as TaskType, project_id, safePayload)
  } catch (handlerErr) {
    console.error(`[REZONATE-ENGINE] Handler error for task ${task_id}:`, handlerErr)

    // Mark the action row as failed; best-effort — don't throw if update fails
    await supabase
      .from('actions')
      .update({
        status: 'failed',
        payload: {
          ...safePayload,
          _rezonate: {
            task_id,
            task_type,
            project_id,
            error: (handlerErr as Error).message ?? String(handlerErr),
            processed_at: new Date().toISOString(),
          },
        },
      })
      .eq('id', task_id)

    return jsonResponse(
      {
        task_id,
        task_type,
        status: 'failed',
        error: (handlerErr as Error).message ?? 'Task handler threw an unexpected error',
      },
      500,
    )
  }

  // ------------------------------------------------------------------
  // Persist result to the actions table
  //
  // The core `actions` table stores results inside the `payload` jsonb
  // column (no dedicated `result` or `completed_at` column exists in the
  // current schema).  The processed metadata is namespaced under `_rezonate`
  // to avoid colliding with caller-supplied fields.
  // ------------------------------------------------------------------
  const { error: updateError } = await supabase
    .from('actions')
    .update({
      status: 'completed',
      payload: {
        ...safePayload,
        _rezonate: {
          task_id,
          task_type,
          project_id,
          result,
          processed_at: new Date().toISOString(),
        },
      },
    })
    .eq('id', task_id)

  if (updateError) {
    // Log the failure but do not surface it as a 500 to the caller — the task
    // itself succeeded.  The caller should treat a missing DB update as a
    // reconciliation concern, not a processing failure.
    console.error(
      `[REZONATE-ENGINE] Failed to update actions row for task ${task_id}:`,
      updateError.message,
    )
  }

  // ------------------------------------------------------------------
  // Return structured success response
  // ------------------------------------------------------------------
  return jsonResponse(
    {
      task_id,
      task_type,
      result,
      status: 'completed',
    },
    200,
  )
})
