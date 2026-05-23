/**
 * rezonate-ai-assist — Deno Edge Function
 *
 * AI production assist for the Rezonate DAW node.  Accepts a POST with a
 * request_type and context, returns a bounded structured suggestion object for
 * the requested audio-production concern.  Actual DSP runs client-side or in
 * a future WASM layer; this function handles routing, validation, and logging.
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
// Valid request types for AI production assist
// ---------------------------------------------------------------------------
const VALID_REQUEST_TYPES = [
  'tighten_timing',
  'remove_noise',
  'find_key',
  'suggest_bassline',
  'detect_clipping',
  'generate_drum_layer',
  'generate_melody',
  'generate_vocal_line',
  'generate_full_track',
] as const

type RequestType = typeof VALID_REQUEST_TYPES[number]

// ---------------------------------------------------------------------------
// Request body shape
// ---------------------------------------------------------------------------
interface AssistRequest {
  project_id: string
  request_type: RequestType
  context?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Per-request-type suggestion stubs
// Each returns a structured object describing the suggestion.  Replace stub
// bodies with real DSP model calls as capabilities mature.
// ---------------------------------------------------------------------------

function handleFindKey(_context: Record<string, unknown>) {
  // Stub: real implementation will run chromagram analysis on the project audio
  return {
    key: 'C major',
    confidence: 0.85,
    alternatives: ['A minor'],
  }
}

function handleDetectClipping(_context: Record<string, unknown>) {
  // Stub: real implementation will scan peak levels across all tracks
  return {
    detected: false,
    peak_db: -2.1,
    recommendation: 'headroom is adequate',
  }
}

function handleTightenTiming(_context: Record<string, unknown>) {
  // Stub: real implementation will compute offset via onset detection
  return {
    offset_ms: 12,
    suggested_quantize: '1/16',
    groove_template: 'straight',
  }
}

function handleSuggestBassline(_context: Record<string, unknown>) {
  // Stub: real implementation will derive a root note from the detected key
  return {
    root_note: 'C2',
    pattern: [1, 0, 0, 1, 0, 1, 0, 0],
    style: 'four-on-floor',
  }
}

function handleRemoveNoise(_context: Record<string, unknown>) {
  // Stub: real implementation will run spectral gating analysis
  return {
    threshold_db: -45,
    estimated_snr_db: 18,
    method: 'spectral_gate',
  }
}

function handleGenerateDrumLayer(_context: Record<string, unknown>) {
  // Stub: real implementation will align a generated pattern to the project BPM
  return {
    pattern: [1, 0, 0, 1, 0, 0, 1, 0],
    instrument: 'kick',
    bpm_aligned: true,
  }
}

function handleGenerateMelody(context: Record<string, unknown>) {
  const key = (context.key as string) ?? 'C major';
  const bars = Math.min(8, Math.max(1, (context.bars as number) ?? 4));
  const style = (context.style as string) ?? 'pop';
  // Returns a note sequence: [{note, octave, duration_beats, velocity}]
  // Real implementation: call a music generation model or rule-based composer
  const scales: Record<string, number[]> = {
    'C major': [60, 62, 64, 65, 67, 69, 71],
    'A minor': [57, 59, 60, 62, 64, 65, 67],
  };
  const midiRoot = scales[key] ?? scales['C major'];
  // Stub 8-note melodic phrase repeated per bar
  const phrase = [
    { note: midiRoot[0], octave: 4, duration_beats: 1, velocity: 90 },
    { note: midiRoot[2], octave: 4, duration_beats: 0.5, velocity: 75 },
    { note: midiRoot[4], octave: 4, duration_beats: 0.5, velocity: 80 },
    { note: midiRoot[3], octave: 4, duration_beats: 1, velocity: 70 },
    { note: midiRoot[6], octave: 4, duration_beats: 0.5, velocity: 85 },
    { note: midiRoot[4], octave: 4, duration_beats: 0.5, velocity: 75 },
    { note: midiRoot[2], octave: 4, duration_beats: 1, velocity: 80 },
    { note: midiRoot[0], octave: 4, duration_beats: 1, velocity: 90 },
  ];
  return {
    key,
    bars,
    style,
    notes: Array.from({ length: bars }, () => phrase).flat(),
    render_hint: 'oscillator:sine',
  };
}

function handleGenerateVocalLine(context: Record<string, unknown>) {
  const key = (context.key as string) ?? 'C major';
  const style = (context.style as string) ?? 'pop';
  const syllables = (context.syllables as string[]) ?? ['oh', 'ah', 'hey', 'yeah'];
  // Returns phoneme timing for synthesis
  // Real implementation: TTS/singing model API call
  return {
    key,
    style,
    phonemes: syllables.map((syl, i) => ({
      syllable: syl,
      time_beats: i * 1.0,
      duration_beats: 0.75,
      pitch_midi: 60 + [0, 2, 4, 5][i % 4],
      velocity: 85,
    })),
    render_hint: 'oscillator:sawtooth',
    note: 'Replace with your own vocal recording via sample substitution',
  };
}

function handleGenerateFullTrack(context: Record<string, unknown>) {
  const bpm = (context.bpm as number) ?? 120;
  const key = (context.key as string) ?? 'C major';
  const style = (context.style as string) ?? 'pop';
  // Composes drum + bass + melody layers together
  return {
    bpm,
    key,
    style,
    bars: 4,
    layers: {
      drums: { pattern: [1,0,0,1,1,0,0,1,1,0,0,1,1,0,1,0], instrument: 'kit' },
      bass:  { root_note: 60, pattern: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] },
      melody: { notes: [60,64,67,65,64,62,60], rhythm: [1,0.5,0.5,1,0.5,0.5,1] },
    },
    render_hint: 'composite',
    note: 'Each layer can be replaced with your own sample via sample substitution',
  };
}

// ---------------------------------------------------------------------------
// Route a validated request_type to its handler
// ---------------------------------------------------------------------------
function routeRequest(
  request_type: RequestType,
  context: Record<string, unknown>,
): Record<string, unknown> {
  switch (request_type) {
    case 'find_key':
      return handleFindKey(context)
    case 'detect_clipping':
      return handleDetectClipping(context)
    case 'tighten_timing':
      return handleTightenTiming(context)
    case 'suggest_bassline':
      return handleSuggestBassline(context)
    case 'remove_noise':
      return handleRemoveNoise(context)
    case 'generate_drum_layer':
      return handleGenerateDrumLayer(context)
    case 'generate_melody':
      return handleGenerateMelody(context)
    case 'generate_vocal_line':
      return handleGenerateVocalLine(context)
    case 'generate_full_track':
      return handleGenerateFullTrack(context)
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
        service: 'rezonate-ai-assist',
        version: '1.0.0',
        description: 'AI production assist for the Rezonate DAW node',
        accepted_request_types: VALID_REQUEST_TYPES,
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

  let body: AssistRequest

  try {
    body = await req.json() as AssistRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { project_id, request_type, context } = body

  // ------------------------------------------------------------------
  // Input validation
  // ------------------------------------------------------------------
  if (!project_id || typeof project_id !== 'string') {
    return jsonResponse({ error: 'project_id is required and must be a string' }, 400)
  }

  if (!request_type || !(VALID_REQUEST_TYPES as readonly string[]).includes(request_type)) {
    return jsonResponse(
      {
        error: `request_type must be one of: ${VALID_REQUEST_TYPES.join(', ')}`,
        received: request_type ?? null,
      },
      400,
    )
  }

  const safeContext: Record<string, unknown> = context && typeof context === 'object'
    ? context
    : {}

  // ------------------------------------------------------------------
  // Execute the suggestion handler
  // ------------------------------------------------------------------
  let result: Record<string, unknown>

  try {
    result = routeRequest(request_type as RequestType, safeContext)
  } catch (handlerErr) {
    console.error(`[REZONATE-AI-ASSIST] Handler error for request_type ${request_type}:`, handlerErr)
    return jsonResponse(
      {
        error: (handlerErr as Error).message ?? 'Suggestion handler threw an unexpected error',
        request_type,
        project_id,
      },
      500,
    )
  }

  // ------------------------------------------------------------------
  // Log the completed request to the actions table for audit / replay
  // ------------------------------------------------------------------
  const { error: insertError } = await supabase
    .from('actions')
    .insert({
      task_name: 'ai_assist',
      status: 'completed',
      payload: { project_id, request_type },
    })

  if (insertError) {
    // Log the failure but do not surface it as a 500 — the suggestion itself
    // succeeded and is being returned to the caller.
    console.error(
      `[REZONATE-AI-ASSIST] Failed to insert actions row for project ${project_id}:`,
      insertError.message,
    )
  }

  // ------------------------------------------------------------------
  // Return structured success response
  // ------------------------------------------------------------------
  return jsonResponse(
    {
      result,
      request_type,
      project_id,
    },
    200,
  )
})
