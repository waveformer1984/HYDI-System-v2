/**
 * rezonate-collab — Deno Edge Function
 *
 * Collaboration session management for the Rezonate DAW node.  Routes POST
 * requests by `action` field to the appropriate session handler, and supports
 * GET for quick session lookups by query parameter.
 *
 * Actions:
 *   create_session  — create a new collab session for a project
 *   join_session    — upsert a participant contribution record
 *   leave_session   — mark a participant's contribution as ended
 *   log_event       — record a collab event and increment contribution counter
 *   get_session     — fetch session, participants, and recent events
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
// Valid action names
// ---------------------------------------------------------------------------
const VALID_ACTIONS = [
  'create_session',
  'join_session',
  'leave_session',
  'log_event',
  'get_session',
] as const

type CollabAction = typeof VALID_ACTIONS[number]

// ---------------------------------------------------------------------------
// Supabase client factory — service-role key bypasses RLS
// ---------------------------------------------------------------------------
function makeSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * create_session — insert a new session row and return it.
 */
async function handleCreateSession(
  supabase: ReturnType<typeof makeSupabase>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { project_id, name, created_by } = body

  if (!project_id || typeof project_id !== 'string') {
    return jsonResponse({ data: null, error: 'project_id is required' }, 400)
  }

  const { data, error } = await supabase
    .from('rezonate_collab_sessions')
    .insert({ project_id, name: name ?? null, created_by: created_by ?? null })
    .select()
    .single()

  if (error) {
    console.error('[REZONATE-COLLAB] create_session error:', error.message)
    return jsonResponse({ data: null, error: error.message }, 500)
  }

  return jsonResponse({ data, error: null }, 201)
}

/**
 * join_session — upsert a participant contribution and return the session plus
 * the current participants list.
 */
async function handleJoinSession(
  supabase: ReturnType<typeof makeSupabase>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, user_id, display_name } = body

  if (!session_id || typeof session_id !== 'string') {
    return jsonResponse({ data: null, error: 'session_id is required' }, 400)
  }
  if (!user_id || typeof user_id !== 'string') {
    return jsonResponse({ data: null, error: 'user_id is required' }, 400)
  }

  // Upsert the contribution record (unique on session_id + user_id)
  const { error: upsertError } = await supabase
    .from('rezonate_collab_contributions')
    .upsert(
      { session_id, user_id, display_name: display_name ?? null, left_at: null },
      { onConflict: 'session_id,user_id', ignoreDuplicates: false },
    )

  if (upsertError) {
    console.error('[REZONATE-COLLAB] join_session upsert error:', upsertError.message)
    return jsonResponse({ data: null, error: upsertError.message }, 500)
  }

  // Fetch the session and current participants
  const [sessionRes, participantsRes] = await Promise.all([
    supabase
      .from('rezonate_collab_sessions')
      .select('*')
      .eq('id', session_id)
      .single(),
    supabase
      .from('rezonate_collab_contributions')
      .select('*')
      .eq('session_id', session_id)
      .is('left_at', null),
  ])

  if (sessionRes.error) {
    console.error('[REZONATE-COLLAB] join_session session fetch error:', sessionRes.error.message)
    return jsonResponse({ data: null, error: sessionRes.error.message }, 500)
  }

  return jsonResponse(
    { data: { session: sessionRes.data, participants: participantsRes.data ?? [] }, error: null },
    200,
  )
}

/**
 * leave_session — mark the participant's contribution as ended by setting
 * left_at to now().
 */
async function handleLeaveSession(
  supabase: ReturnType<typeof makeSupabase>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, user_id } = body

  if (!session_id || typeof session_id !== 'string') {
    return jsonResponse({ data: null, error: 'session_id is required' }, 400)
  }
  if (!user_id || typeof user_id !== 'string') {
    return jsonResponse({ data: null, error: 'user_id is required' }, 400)
  }

  const { error } = await supabase
    .from('rezonate_collab_contributions')
    .update({ left_at: new Date().toISOString() })
    .eq('session_id', session_id)
    .eq('user_id', user_id)

  if (error) {
    console.error('[REZONATE-COLLAB] leave_session error:', error.message)
    return jsonResponse({ data: null, error: error.message }, 500)
  }

  return jsonResponse({ data: { ok: true }, error: null }, 200)
}

/**
 * log_event — insert a collab event and increment the contributor's event_count.
 */
async function handleLogEvent(
  supabase: ReturnType<typeof makeSupabase>,
  body: Record<string, unknown>,
): Promise<Response> {
  const { session_id, user_id, event_type, payload } = body

  if (!session_id || typeof session_id !== 'string') {
    return jsonResponse({ data: null, error: 'session_id is required' }, 400)
  }
  if (!user_id || typeof user_id !== 'string') {
    return jsonResponse({ data: null, error: 'user_id is required' }, 400)
  }
  if (!event_type || typeof event_type !== 'string') {
    return jsonResponse({ data: null, error: 'event_type is required' }, 400)
  }

  // Insert the event row
  const { data: eventRow, error: insertError } = await supabase
    .from('rezonate_collab_events')
    .insert({
      session_id,
      user_id,
      event_type,
      payload: payload ?? null,
    })
    .select()
    .single()

  if (insertError) {
    console.error('[REZONATE-COLLAB] log_event insert error:', insertError.message)
    return jsonResponse({ data: null, error: insertError.message }, 500)
  }

  // Increment the contribution event_count for this user in this session.
  // Use rpc if available; fall back to a read-modify-write to stay portable.
  const { data: contrib, error: contribFetchErr } = await supabase
    .from('rezonate_collab_contributions')
    .select('event_count')
    .eq('session_id', session_id)
    .eq('user_id', user_id)
    .single()

  if (!contribFetchErr && contrib) {
    const newCount = ((contrib.event_count as number) ?? 0) + 1
    await supabase
      .from('rezonate_collab_contributions')
      .update({ event_count: newCount })
      .eq('session_id', session_id)
      .eq('user_id', user_id)
  }

  return jsonResponse({ data: eventRow, error: null }, 201)
}

/**
 * get_session — fetch a session with its contributions and last 50 events.
 */
async function handleGetSession(
  supabase: ReturnType<typeof makeSupabase>,
  session_id: string,
): Promise<Response> {
  if (!session_id) {
    return jsonResponse({ data: null, error: 'session_id is required' }, 400)
  }

  const [sessionRes, contributionsRes, eventsRes] = await Promise.all([
    supabase
      .from('rezonate_collab_sessions')
      .select('*')
      .eq('id', session_id)
      .single(),
    supabase
      .from('rezonate_collab_contributions')
      .select('*')
      .eq('session_id', session_id),
    supabase
      .from('rezonate_collab_events')
      .select('*')
      .eq('session_id', session_id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (sessionRes.error) {
    console.error('[REZONATE-COLLAB] get_session error:', sessionRes.error.message)
    return jsonResponse({ data: null, error: sessionRes.error.message }, 500)
  }

  return jsonResponse(
    {
      data: {
        session: sessionRes.data,
        contributions: contributionsRes.data ?? [],
        events: (eventsRes.data ?? []).reverse(), // return chronological order
      },
      error: null,
    },
    200,
  )
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Health-check / quick session lookup — GET returns service metadata or
  // session data when ?session_id=xxx is provided.
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const session_id = url.searchParams.get('session_id')

    if (session_id) {
      const supabase = makeSupabase()
      return handleGetSession(supabase, session_id)
    }

    return jsonResponse(
      {
        status: 'active',
        service: 'rezonate-collab',
        version: '1.0.0',
        description: 'Collaboration session management for the Rezonate DAW node',
        accepted_actions: VALID_ACTIONS,
        timestamp: new Date().toISOString(),
      },
      200,
    )
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { headers: corsHeaders, status: 405 })
  }

  let body: Record<string, unknown>

  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return jsonResponse({ data: null, error: 'Invalid JSON body' }, 400)
  }

  const { action } = body

  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action as string)) {
    return jsonResponse(
      {
        data: null,
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
        received: action ?? null,
      },
      400,
    )
  }

  const supabase = makeSupabase()

  switch (action as CollabAction) {
    case 'create_session':
      return handleCreateSession(supabase, body)
    case 'join_session':
      return handleJoinSession(supabase, body)
    case 'leave_session':
      return handleLeaveSession(supabase, body)
    case 'log_event':
      return handleLogEvent(supabase, body)
    case 'get_session':
      return handleGetSession(supabase, body.session_id as string)
  }
})
