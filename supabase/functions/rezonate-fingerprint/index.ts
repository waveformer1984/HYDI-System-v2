/**
 * rezonate-fingerprint — Deno Edge Function
 *
 * Audio fingerprinting service for the Rezonate DAW node.  Accepts a base64-
 * encoded audio sample, computes a deterministic SHA-256 hash and stub spectral
 * descriptors, then upserts the fingerprint into `rezonate_fingerprints`.
 * Duplicate submissions (same hash) return the existing row rather than an error.
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
// Request body shape
// ---------------------------------------------------------------------------
interface FingerprintRequest {
  audio_base64: string
  project_id?: string
  audio_file_id?: string
  submitted_by?: string
}

// ---------------------------------------------------------------------------
// Helper: convert an ArrayBuffer to a lowercase hex string
// ---------------------------------------------------------------------------
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Compute fingerprint descriptors from raw audio bytes
//
// - hash:          full SHA-256 of the raw bytes, hex-encoded
// - spectral_hash: first 16 chars of the SHA-256 reversed (stub placeholder
//                  for a real spectral centroid hash)
// - chroma_vector: 12 float values in [0,1] derived by sampling every
//                  floor(N/12)-th byte and dividing by 255, representing the
//                  12 pitch classes (stub — real impl uses FFT chroma analysis)
// ---------------------------------------------------------------------------
async function computeFingerprint(bytes: Uint8Array): Promise<{
  hash: string
  spectral_hash: string
  chroma_vector: number[]
}> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hash = bufferToHex(hashBuffer)

  // Stub spectral hash: first 16 characters of the SHA-256 reversed
  const spectral_hash = hash.slice(0, 16).split('').reverse().join('')

  // Stub chroma vector: 12 values sampled uniformly from the byte array
  const step = Math.max(1, Math.floor(bytes.length / 12))
  const chroma_vector: number[] = []
  for (let i = 0; i < 12; i++) {
    const byteIndex = i * step
    const sample = byteIndex < bytes.length ? bytes[byteIndex] : 0
    chroma_vector.push(Number((sample / 255).toFixed(4)))
  }

  return { hash, spectral_hash, chroma_vector }
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
        service: 'rezonate-fingerprint',
        version: '1.0.0',
        description: 'Audio fingerprinting service for the Rezonate DAW node',
        timestamp: new Date().toISOString(),
      },
      200,
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { headers: corsHeaders, status: 405 })
  }

  // Initialize the Supabase client with the service role key so we can write
  // to the fingerprints table without RLS constraints from user JWTs.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let body: FingerprintRequest

  try {
    body = await req.json() as FingerprintRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { audio_base64, project_id, audio_file_id, submitted_by } = body

  // ------------------------------------------------------------------
  // Input validation
  // ------------------------------------------------------------------
  if (!audio_base64 || typeof audio_base64 !== 'string') {
    return jsonResponse({ error: 'audio_base64 is required and must be a string' }, 400)
  }

  // ------------------------------------------------------------------
  // Step 1: Decode base64 to raw bytes
  // ------------------------------------------------------------------
  let bytes: Uint8Array
  try {
    const binaryString = atob(audio_base64)
    bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
  } catch (decodeErr) {
    console.error('[REZONATE-FINGERPRINT] Base64 decode error:', decodeErr)
    return jsonResponse({ error: 'audio_base64 is not valid base64-encoded data' }, 400)
  }

  // ------------------------------------------------------------------
  // Steps 2-4: Compute hash, spectral_hash, and chroma_vector
  // ------------------------------------------------------------------
  let hash: string
  let spectral_hash: string
  let chroma_vector: number[]

  try {
    ;({ hash, spectral_hash, chroma_vector } = await computeFingerprint(bytes))
  } catch (computeErr) {
    console.error('[REZONATE-FINGERPRINT] Fingerprint computation error:', computeErr)
    return jsonResponse({ error: 'Failed to compute audio fingerprint' }, 500)
  }

  // ------------------------------------------------------------------
  // Step 5: Upsert into rezonate_fingerprints
  // On conflict (hash already exists), return the existing row.
  // ------------------------------------------------------------------
  const { data: rows, error: upsertError } = await supabase
    .from('rezonate_fingerprints')
    .upsert(
      {
        hash,
        spectral_hash,
        chroma_vector,
        project_id: project_id ?? null,
        audio_file_id: audio_file_id ?? null,
        submitted_by: submitted_by ?? null,
      },
      { onConflict: 'hash', ignoreDuplicates: false },
    )
    .select()

  if (upsertError) {
    console.error('[REZONATE-FINGERPRINT] DB upsert error:', upsertError.message)
    return jsonResponse({ error: 'Failed to store fingerprint', detail: upsertError.message }, 500)
  }

  const row = rows?.[0]

  // ------------------------------------------------------------------
  // Step 6: Return fingerprint summary
  // ------------------------------------------------------------------
  return jsonResponse(
    {
      fingerprint_id: row?.id ?? null,
      hash,
      spectral_hash,
      status: 'submitted',
    },
    200,
  )
})
