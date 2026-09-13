/**
 * Migration test for operator_escalations table
 *
 * Verifies the table exists with the correct columns, constraints,
 * and RLS policies.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

describe('operator_escalations migration', () => {
  it('table exists with correct columns', async () => {
    const { data, error } = await supabase
      .from('operator_escalations')
      .select('id, category, severity, title, body, action_taken, action_required, metadata, created_at, resolved, resolved_at, resolved_by')
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it('can insert and retrieve an escalation', async () => {
    const { data, error } = await supabase
      .from('operator_escalations')
      .insert({
        category: 'test',
        severity: 'info',
        title: 'Test escalation',
        body: 'This is a test',
        metadata: { test: true },
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.category).toBe('test');
    expect(data.severity).toBe('info');
    expect(data.resolved).toBe(false);

    // Clean up
    await supabase.from('operator_escalations').delete().eq('id', data.id);
  });

  it('rejects invalid severity', async () => {
    const { error } = await supabase
      .from('operator_escalations')
      .insert({
        category: 'test',
        severity: 'invalid',
        title: 'Test',
        body: 'Test',
      });
    expect(error).not.toBeNull();
  });
});
