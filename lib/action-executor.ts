/**
 * ACTION EXECUTOR
 *
 * Performs Heidi's actions for real and reports truthful outcomes.
 * Replaces the previous `Math.random()`-based simulated execution.
 *
 * Every handler returns an explicit result:
 *   - status 'completed' with a `result` payload, or
 *   - status 'failed' with an `error` string.
 *
 * Actions that require external credentials that aren't configured return
 * 'failed' with a clear reason — they are never reported as fake successes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { updateSessionState } from './session-state';

export interface ExecutorAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface ActionResult {
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

// Tables Heidi is permitted to read from / write to via generic actions.
const READABLE_TABLES = new Set([
  'memories',
  'actions',
  'sessions',
  'leads',
  'quotes',
  'proposals',
  'system_dashboard',
]);
const WRITABLE_TABLES = new Set(['sessions']);

export class ActionExecutor {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async execute(action: ExecutorAction, sessionId: string): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'create_task':
          return await this.createTask(action.payload, sessionId);
        case 'fetch_data':
          return await this.fetchData(action.payload);
        case 'update_database':
          return await this.updateDatabase(action.payload);
        case 'schedule_event':
          return await this.scheduleEvent(action.payload, sessionId);
        case 'send_email':
          return await this.sendEmail(action.payload);
        default:
          return { status: 'failed', error: `Unsupported action type: ${action.type}` };
      }
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async createTask(payload: Record<string, unknown>, sessionId: string): Promise<ActionResult> {
    const taskName = (payload.task_name as string) || (payload.title as string) || 'untitled_task';
    const { data, error } = await this.supabase
      .from('actions')
      .insert({ session_id: sessionId, task_name: taskName, status: 'pending', payload })
      .select('id')
      .single();

    if (error) return { status: 'failed', error: error.message };
    return { status: 'completed', result: { task_id: data?.id, task_name: taskName } };
  }

  private async fetchData(payload: Record<string, unknown>): Promise<ActionResult> {
    const table = payload.table as string;
    if (!table || !READABLE_TABLES.has(table)) {
      return { status: 'failed', error: `Table not readable: ${table ?? '(none)'}` };
    }
    const limit = typeof payload.limit === 'number' ? payload.limit : 10;
    let query = this.supabase.from(table).select('*').limit(limit);

    const filter = payload.filter as Record<string, unknown> | undefined;
    if (filter && typeof filter === 'object') {
      for (const [key, value] of Object.entries(filter)) {
        query = query.eq(key, value as never);
      }
    }

    const { data, error } = await query;
    if (error) return { status: 'failed', error: error.message };
    return { status: 'completed', result: { rows: data, count: data?.length ?? 0 } };
  }

  private async updateDatabase(payload: Record<string, unknown>): Promise<ActionResult> {
    const table = payload.table as string;
    if (!table || !WRITABLE_TABLES.has(table)) {
      return { status: 'failed', error: `Table not writable: ${table ?? '(none)'}` };
    }
    const values = payload.values as Record<string, unknown> | undefined;
    const match = payload.match as Record<string, unknown> | undefined;
    if (!values || !match || Object.keys(match).length === 0) {
      return { status: 'failed', error: 'update_database requires non-empty "values" and "match"' };
    }

    // Route through the shared session-state module rather than writing to
    // `sessions` directly — see lib/session-state.ts.
    if (table === 'sessions') {
      const sessionId = match.session_id as string | undefined;
      if (!sessionId || Object.keys(match).length !== 1) {
        return { status: 'failed', error: 'update_database on "sessions" requires match to be exactly { session_id }' };
      }
      const { error } = await updateSessionState(this.supabase, sessionId, values);
      if (error) return { status: 'failed', error };
      return { status: 'completed', result: { table, updated: match } };
    }

    let query = this.supabase.from(table).update(values);
    for (const [key, value] of Object.entries(match)) {
      query = query.eq(key, value as never);
    }
    const { error } = await query;
    if (error) return { status: 'failed', error: error.message };
    return { status: 'completed', result: { table, updated: match } };
  }

  private async scheduleEvent(payload: Record<string, unknown>, sessionId: string): Promise<ActionResult> {
    const scheduledFor = payload.scheduled_for as string | undefined;
    if (!scheduledFor || isNaN(Date.parse(scheduledFor))) {
      return { status: 'failed', error: 'schedule_event requires a valid ISO "scheduled_for" timestamp' };
    }
    const { data, error } = await this.supabase
      .from('actions')
      .insert({
        session_id: sessionId,
        task_name: (payload.name as string) || 'scheduled_event',
        status: 'pending',
        payload: { ...payload, scheduled_for: scheduledFor },
      })
      .select('id')
      .single();

    if (error) return { status: 'failed', error: error.message };
    return { status: 'completed', result: { event_id: data?.id, scheduled_for: scheduledFor } };
  }

  private async sendEmail(payload: Record<string, unknown>): Promise<ActionResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      return {
        status: 'failed',
        error: 'Email not configured (set RESEND_API_KEY and EMAIL_FROM to enable send_email)',
      };
    }
    const to = payload.to as string | undefined;
    const subject = (payload.subject as string) || '';
    const body = (payload.body as string) || (payload.text as string) || '';
    if (!to) return { status: 'failed', error: 'send_email requires a "to" address' };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: body }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { status: 'failed', error: `Email send failed: ${response.status} ${detail}`.trim() };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: 'completed', result: { email_id: data.id, to } };
  }
}
