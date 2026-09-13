/**
 * Migration test: relax the April-schema NOT NULL columns on
 * public.notifications (type, recipient, channel, status, template).
 *
 * 20260818120000_reconcile_notifications_schema.sql added the July-style
 * columns (category, severity, title, body, device_id) but left the
 * April-only columns NOT NULL with no defaults. lib/notifications/notify.js
 * -- the current, real insert path -- never sets those April columns, so
 * every call was failing with a NOT NULL violation on every real database
 * (April always migrates first, chronologically). This locks down the fix.
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

describe('notifications: April-schema columns relaxed to nullable', () => {
  it('type, recipient, channel, status, template are all nullable', async () => {
    const rows = await withClient((c) => c.query(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'notifications'
         and column_name in ('type', 'recipient', 'channel', 'status', 'template')`
    ));
    const byName = Object.fromEntries(rows.rows.map((r) => [r.column_name, r.is_nullable]));
    expect(byName.type).toBe('YES');
    expect(byName.recipient).toBe('YES');
    expect(byName.channel).toBe('YES');
    expect(byName.status).toBe('YES');
    expect(byName.template).toBe('YES');
  });

  it('a July-shaped insert (the real notify.js path -- category/severity/title/body only) succeeds', async () => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        category: 'operator_escalation',
        severity: 'warning',
        title: 'Test July-shaped insert',
        body: 'No type/recipient/channel/status/template provided',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.type).toBeNull();
    expect(data.recipient).toBeNull();

    await supabase.from('notifications').delete().eq('id', data.id);
  });

  it('the channel CHECK constraint still rejects an invalid value when one is provided', async () => {
    const { error } = await supabase
      .from('notifications')
      .insert({
        category: 'operator_escalation',
        severity: 'warning',
        title: 'Should be rejected',
        channel: 'carrier-pigeon',
      })
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/notifications_channel_check|violates check constraint/i);
  });
});
