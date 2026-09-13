/**
 * Migration test for adding operator_escalation category
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

describe('operator_escalation category migration', () => {
  it('accepts operator_escalation as a valid category', async () => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        category: 'operator_escalation',
        severity: 'warning',
        title: 'Test operator escalation',
        body: 'Testing the new category',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.category).toBe('operator_escalation');

    // Clean up
    await supabase.from('notifications').delete().eq('id', data.id);
  });
});
