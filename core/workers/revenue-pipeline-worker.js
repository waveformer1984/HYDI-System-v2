// core/workers/revenue-pipeline-worker.js
//
// In-process worker for lead/quote/proposal lifecycle events.
// Domains: outreach, lead, quote, proposal, revenue, work, analysis

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

async function execute(event) {
  const type    = event.type || event.event_type || '';
  const payload = event.payload || {};
  const source  = event.source || '';
  const eventId = event.event_id;

  console.log(`[revenue-pipeline] handling ${type} (event_id=${eventId})`);

  // ── lead.created ──────────────────────────────────────────────────────────
  if (type.includes('lead') || type === 'outreach') {
    const supabase = getSupabase();
    const leadData = {
      source:       payload.source || source,
      name:         payload.name || payload.contact_name,
      email:        payload.email,
      project_name: payload.project_name,
      status:       'new',
      metadata:     { triggering_event_id: eventId, raw: payload }
    };
    const { error } = await supabase.from('leads').insert(leadData);
    if (error && !error.message.includes('does not exist')) {
      console.error('[revenue-pipeline] lead insert error:', error.message);
    }
    return { handled: true, action: 'lead_created', email: payload.email };
  }

  // ── quote.requested / quote.sent ─────────────────────────────────────────
  if (type.includes('quote')) {
    const supabase = getSupabase();
    const { error } = await supabase.from('quotes').insert({
      lead_id:      payload.lead_id,
      project_name: payload.project_name,
      amount:       payload.amount,
      status:       type.includes('sent') ? 'sent' : 'draft',
      metadata:     { triggering_event_id: eventId, raw: payload }
    });
    if (error && !error.message.includes('does not exist')) {
      console.error('[revenue-pipeline] quote insert error:', error.message);
    }
    return { handled: true, action: 'quote_processed', status: type.includes('sent') ? 'sent' : 'draft' };
  }

  // ── proposal.accepted / proposal.sent ────────────────────────────────────
  if (type.includes('proposal')) {
    const supabase = getSupabase();
    const { error } = await supabase.from('proposals').insert({
      quote_id:     payload.quote_id,
      project_name: payload.project_name,
      status:       type.includes('accepted') ? 'accepted' : 'pending',
      metadata:     { triggering_event_id: eventId, raw: payload }
    });
    if (error && !error.message.includes('does not exist')) {
      console.error('[revenue-pipeline] proposal insert error:', error.message);
    }
    return { handled: true, action: 'proposal_processed', status: type.includes('accepted') ? 'accepted' : 'pending' };
  }

  // ── analysis / work / research ────────────────────────────────────────────
  console.log(`[revenue-pipeline] queued for processing: type=${type} source=${source}`);
  return { handled: true, action: 'queued', type };
}

module.exports = {
  id: 'revenue-pipeline-worker',
  version: '1.0.0',
  domains: ['outreach', 'lead', 'quote', 'proposal', 'revenue', 'work', 'analysis', 'research'],
  execute,
  metadata: { description: 'Handles lead/quote/proposal lifecycle — writes CRM records and tracks pipeline state' }
};
