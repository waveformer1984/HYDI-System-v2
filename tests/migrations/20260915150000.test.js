/**
 * Migration test for operational_boundary table
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

describe('operational_boundary migration', () => {
  it('operational_boundary table exists with a default row', async () => {
    const { data, error } = await supabase
      .from('operational_boundary')
      .select('*')
      .eq('id', 1)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.id).toBe(1);
    expect(data.go_live_at).toBeDefined();
    expect(data.note).toContain('test');
  });

  it('go_live_at can be updated', async () => {
    const testTimestamp = '2026-09-01T00:00:00Z';
    const { data, error } = await supabase
      .from('operational_boundary')
      .update({ go_live_at: testTimestamp, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select()
      .single();

    expect(error).toBeNull();
    expect(new Date(data.go_live_at).toISOString()).toBe(new Date(testTimestamp).toISOString());

    // Reset to now for other tests
    await supabase
      .from('operational_boundary')
      .update({ go_live_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', 1);
  });
});
