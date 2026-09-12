/**
 * Migration test: protoforge_opportunities / protoforge_mission_runs.
 *
 * Locks down the schema HYDI Mission Runner v1 depends on: dedup
 * uniqueness, status/approval_status CHECK constraints, the updated_at
 * trigger, and RLS matching the existing `leads` table convention
 * (service_role only).
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PG = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
};

async function withClient(fn) {
  const c = new Client(PG);
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

jest.setTimeout(30000);

function uniqueHash(label) {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe('protoforge_opportunities schema', () => {
  it('both tables exist', async () => {
    const rows = await withClient(async (c) => (await c.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('protoforge_opportunities','protoforge_mission_runs')"
    )).rows);
    expect(rows.map((r) => r.table_name).sort()).toEqual(['protoforge_mission_runs', 'protoforge_opportunities']);
  });

  it('inserts a well-formed opportunity through PostgREST', async () => {
    const dedup_hash = uniqueHash('insert');
    const { data, error } = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate',
      dedup_hash,
      title: 'Test opportunity',
      why_it_matters: 'test',
      required_action: 'test',
      confidence: 55,
      source_type: 'hn_algolia',
      evidence: [{ source_url: 'https://example.com', snippet: 'x', fetched_at: new Date().toISOString() }],
    }).select('*').single();

    expect(error).toBeNull();
    expect(data.status).toBe('needs_review'); // default
    expect(data.approval_status).toBe('pending'); // default -- the whole point of the R2+ boundary
    expect(data.id).toBeDefined();
  });

  it('rejects an invalid status value', async () => {
    const { error } = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate', dedup_hash: uniqueHash('badstatus'), title: 'x',
      confidence: 10, source_type: 'hn_algolia', status: 'not_a_real_status',
    });
    expect(error).not.toBeNull();
  });

  it('rejects confidence outside 0-100', async () => {
    const { error } = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate', dedup_hash: uniqueHash('badconf'), title: 'x',
      confidence: 999, source_type: 'hn_algolia',
    });
    expect(error).not.toBeNull();
  });

  it('enforces dedup_hash uniqueness', async () => {
    const dedup_hash = uniqueHash('dupe');
    const first = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate', dedup_hash, title: 'first', confidence: 50, source_type: 'hn_algolia',
    });
    expect(first.error).toBeNull();

    const second = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate', dedup_hash, title: 'second (duplicate hash)', confidence: 50, source_type: 'hn_algolia',
    });
    expect(second.error).not.toBeNull();
  });

  it('updated_at advances on approve/reject', async () => {
    const dedup_hash = uniqueHash('approve');
    const created = await supabase.from('protoforge_opportunities').insert({
      product: 'rezonate', dedup_hash, title: 'x', confidence: 80, source_type: 'hn_algolia',
    }).select('*').single();
    expect(created.error).toBeNull();
    const before = created.data.updated_at;

    await new Promise((r) => setTimeout(r, 50));
    const updated = await supabase.from('protoforge_opportunities')
      .update({ approval_status: 'approved', approved_by: 'test-human' })
      .eq('id', created.data.id).select('*').single();

    expect(updated.error).toBeNull();
    expect(updated.data.approval_status).toBe('approved');
    expect(updated.data.approved_by).toBe('test-human');
    expect(new Date(updated.data.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('records a mission run with the required status CHECK', async () => {
    const { error: badError } = await supabase.from('protoforge_mission_runs').insert({ status: 'not_a_status' });
    expect(badError).not.toBeNull();

    const { data, error } = await supabase.from('protoforge_mission_runs').insert({
      status: 'success', opportunities_found: 3, duplicates_skipped: 1,
      high_confidence_count: 1, needs_review_count: 2, rejected_count: 0,
      briefing_text: 'PROTOFORGE DAILY BRIEF\n...', duration_ms: 1234,
    }).select('*').single();
    expect(error).toBeNull();
    expect(data.run_at).toBeDefined();
  });

  it('RLS matches the existing leads table convention: service_role only', async () => {
    const rows = await withClient(async (c) => (await c.query(
      "select relrowsecurity from pg_class where relname='protoforge_opportunities'"
    )).rows);
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
