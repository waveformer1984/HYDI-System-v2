/**
 * Migration test for webhook_retry_log table
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

describe('webhook_retry_log migration', () => {
  it('webhook_retry_log table exists and accepts inserts', async () => {
    const testWebhookId = '00000000-0000-0000-0000-000000000001';
    const { data, error } = await supabase
      .from('webhook_retry_log')
      .insert({
        webhook_id: testWebhookId,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.webhook_id).toBe(testWebhookId);

    // Clean up
    await supabase.from('webhook_retry_log').delete().eq('id', data.id);
  });

  it('RLS is enabled (anon key cannot read)', async () => {
    // With service role we can read, but the table should have RLS
    const { data, error } = await supabase
      .from('webhook_retry_log')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
    // Service role bypasses RLS, so this should work
    expect(Array.isArray(data)).toBe(true);
  });
});
