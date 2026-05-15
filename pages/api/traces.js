/**
 * GET /api/traces
 * Returns recent pipeline trace events from the RAW LEDGER (keymaker_events).
 * Powers the /trace-viewer page.
 */

import { createClient } from '@supabase/supabase-js';

const PIPELINE_STAGES = [
  'ingestion',
  'raw_ledger',
  'cascade',
  'kilo',
  'protoforge',
  'emission',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const typeFilter = req.query.type || null;

  let query = supabase
    .from('keymaker_events')
    .select('id, event_id, type, source, severity, processed, occurred_at, payload')
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (typeFilter) {
    query = query.eq('type', typeFilter);
  }

  const { data: events, error } = await query;

  if (error) {
    console.error('[traces] DB error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const traces = (events || []).map(event => ({
    id: event.id,
    eventId: event.event_id,
    type: event.type,
    source: event.source,
    severity: event.severity,
    processed: event.processed,
    occurredAt: event.occurred_at,
    stages: PIPELINE_STAGES.map((name, index) => ({
      name,
      status: event.processed ? 'completed' : index === 0 ? 'active' : 'pending',
      metadata:
        name === 'cascade'
          ? { classification: classify(event.type), confidence: 0.9 }
          : name === 'raw_ledger'
          ? { hash: (event.event_id || '').slice(0, 8), immutable: true }
          : null,
    })),
  }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ traces, count: traces.length });
}

function classify(type) {
  if (!type) return 'UNCLASSIFIED';
  if (/^(payment_intent|charge|invoice)/.test(type)) return 'REVENUE_EVENT';
  if (/^customer\.subscription/.test(type)) return 'SUBSCRIPTION_EVENT';
  if (/^checkout\.session/.test(type)) return 'CHECKOUT_EVENT';
  if (/^payout/.test(type)) return 'PAYOUT_EVENT';
  if (/error|fail/.test(type)) return 'INFRA_FAILURE';
  return 'SYSTEM_EVENT';
}
