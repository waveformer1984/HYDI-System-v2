/**
 * rezonate-export — Deno Edge Function
 *
 * Audio export pipeline for the Rezonate DAW node.  Queues an export job by
 * inserting a pending record into the `actions` table and returns the job ID so
 * the caller can poll for completion.
 *
 * POST — queue a new export job
 * GET  — poll an existing job by ?job_id=xxx
 *
 * JWT enforcement: disabled here so the function can be invoked by internal
 * service-role callers without a user token.  To enable per-user JWT
 * validation, set `verify_jwt = true` for this function in
 * `supabase/config.toml`.
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
// Valid export formats and quality levels
// ---------------------------------------------------------------------------
const VALID_FORMATS = ['wav', 'mp3', 'flac', 'stems'] as const
const VALID_QUALITIES = ['draft', 'standard', 'master'] as const

type ExportFormat = typeof VALID_FORMATS[number]
type ExportQuality = typeof VALID_QUALITIES[number]

// ---------------------------------------------------------------------------
// Request body shape
// ---------------------------------------------------------------------------
interface ExportRequest {
  project_id: string
  track_ids?: string[]
  format: ExportFormat
  quality?: ExportQuality
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

  // Initialize the Supabase client with the service role key so we can write
  // to the actions table without RLS constraints from user JWTs.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // ------------------------------------------------------------------
  // GET — health-check or job status poll
  // ------------------------------------------------------------------
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const job_id = url.searchParams.get('job_id')

    if (job_id) {
      // Poll an existing export job from the actions table
      const { data: job, error } = await supabase
        .from('actions')
        .select('id, status, payload')
        .eq('id', job_id)
        .single()

      if (error || !job) {
        return jsonResponse({ error: 'Job not found', job_id }, 404)
      }

      return jsonResponse(
        { job_id: job.id, status: job.status, payload: job.payload },
        200,
      )
    }

    // No job_id — return service metadata
    return jsonResponse(
      {
        status: 'active',
        service: 'rezonate-export',
        version: '1.0.0',
        description: 'Audio export pipeline for the Rezonate DAW node',
        accepted_formats: VALID_FORMATS,
        accepted_qualities: VALID_QUALITIES,
        timestamp: new Date().toISOString(),
      },
      200,
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { headers: corsHeaders, status: 405 })
  }

  let body: ExportRequest

  try {
    body = await req.json() as ExportRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { project_id, track_ids, format, quality = 'standard' } = body

  // ------------------------------------------------------------------
  // Step 1: Validate format and project_id
  // ------------------------------------------------------------------
  if (!project_id || typeof project_id !== 'string') {
    return jsonResponse({ error: 'project_id is required and must be a string' }, 400)
  }

  if (!format || !(VALID_FORMATS as readonly string[]).includes(format)) {
    return jsonResponse(
      {
        error: `format must be one of: ${VALID_FORMATS.join(', ')}`,
        received: format ?? null,
      },
      400,
    )
  }

  const safeQuality: ExportQuality = (VALID_QUALITIES as readonly string[]).includes(quality)
    ? quality as ExportQuality
    : 'standard'

  // ------------------------------------------------------------------
  // Step 2: Insert a pending export job into the actions table
  // ------------------------------------------------------------------
  const { data: actionRow, error: insertError } = await supabase
    .from('actions')
    .insert({
      task_name: 'rezonate_export',
      status: 'pending',
      // session_id is repurposed here to carry the project_id so the export job
      // can be correlated back to its project without a schema change.
      session_id: project_id,
      payload: {
        project_id,
        track_ids: track_ids ?? null,
        format,
        quality: safeQuality,
        queued_at: new Date().toISOString(),
      },
    })
    .select()
    .single()

  if (insertError) {
    console.error('[REZONATE-EXPORT] Failed to queue export job:', insertError.message)
    return jsonResponse({ error: 'Failed to queue export job', detail: insertError.message }, 500)
  }

  // ------------------------------------------------------------------
  // Step 3: Return the job handle to the caller
  //
  // estimated_seconds is a conservative estimate based on format complexity.
  // Stems require separate rendering passes for each track; other formats are
  // a single mix-down render.
  // ------------------------------------------------------------------
  return jsonResponse(
    {
      job_id: actionRow.id,
      format,
      quality: safeQuality,
      status: 'queued',
      estimated_seconds: format === 'stems' ? 45 : 15,
    },
    202,
  )
})
