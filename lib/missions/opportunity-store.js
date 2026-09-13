'use strict';
/**
 * Local persistence for protoforge.daily_opportunity_scan.
 *
 * Everything the mission finds goes here -- not into a chat response that
 * disappears. Backed by the local Supabase/Postgres instance
 * (supabase/migrations/20260916000000_protoforge_opportunities.sql).
 */

const { createClient } = require('@supabase/supabase-js');
const { MISSION_ID } = require('./config');

let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  _client = createClient(url, key);
  return _client;
}

/**
 * Insert a new opportunity, or silently skip if its dedup_hash already
 * exists (same underlying signal seen on a prior run).
 * @returns {Promise<{inserted: boolean, id?: string, error?: string}>}
 */
async function upsertOpportunity(record, deps = {}) {
  const supabase = deps.supabase || getClient();
  const existing = await supabase
    .from('protoforge_opportunities')
    .select('id')
    .eq('dedup_hash', record.dedupHash)
    .maybeSingle();

  if (existing.error) return { inserted: false, error: existing.error.message };
  if (existing.data) return { inserted: false, duplicate: true, id: existing.data.id };

  const { data, error } = await supabase
    .from('protoforge_opportunities')
    .insert({
      mission: MISSION_ID,
      product: record.product,
      dedup_hash: record.dedupHash,
      title: record.title,
      why_it_matters: record.whyItMatters,
      required_action: record.requiredAction,
      estimated_value: record.estimatedValue,
      confidence: record.confidence,
      status: record.status,
      source_type: record.sourceType,
      evidence: record.evidence,
      scoring_detail: record.scoringDetail,
      discovered_at: record.discoveredAt,
    })
    .select('id')
    .single();

  if (error) return { inserted: false, error: error.message };
  return { inserted: true, id: data.id };
}

/** Latest N opportunities, most recent first. Optional status filter. */
async function listOpportunities({ status, limit = 50 } = {}, deps = {}) {
  const supabase = deps.supabase || getClient();
  let query = supabase
    .from('protoforge_opportunities')
    .select('*')
    .order('confidence', { ascending: false })
    .order('discovered_at', { ascending: false })
    .limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function getOpportunity(id, deps = {}) {
  const supabase = deps.supabase || getClient();
  const { data, error } = await supabase.from('protoforge_opportunities').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The only two functions in this codebase allowed to move a record out of
 * approval_status 'pending'. See lib/missions/approval.js for the R2+
 * boundary this enforces -- approving does not execute anything.
 */
async function setApproval(id, approvalStatus, approvedBy, deps = {}) {
  const supabase = deps.supabase || getClient();
  if (!['approved', 'rejected'].includes(approvalStatus)) {
    throw new Error(`invalid approval_status: ${approvalStatus}`);
  }
  const { data, error } = await supabase
    .from('protoforge_opportunities')
    .update({ approval_status: approvalStatus, approved_by: approvedBy || null, approved_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`no opportunity with id ${id}`);
  return data;
}

/** Record one mission run. Always call this, even (especially) on failure. */
async function recordMissionRun(run, deps = {}) {
  const supabase = deps.supabase || getClient();
  const { data, error } = await supabase
    .from('protoforge_mission_runs')
    .insert({
      mission: MISSION_ID,
      status: run.status,
      sources_queried: run.sourcesQueried || [],
      opportunities_found: run.opportunitiesFound || 0,
      duplicates_skipped: run.duplicatesSkipped || 0,
      high_confidence_count: run.highConfidenceCount || 0,
      needs_review_count: run.needsReviewCount || 0,
      rejected_count: run.rejectedCount || 0,
      briefing_text: run.briefingText || null,
      error: run.error || null,
      duration_ms: run.durationMs || null,
    })
    .select('id, run_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function getLatestMissionRun(deps = {}) {
  const supabase = deps.supabase || getClient();
  const { data, error } = await supabase
    .from('protoforge_mission_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  getClient,
  upsertOpportunity,
  listOpportunities,
  getOpportunity,
  setApproval,
  recordMissionRun,
  getLatestMissionRun,
};
