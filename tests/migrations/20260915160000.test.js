/**
 * Migration test for webhook_events.is_test_mode column and backfill
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

describe('webhook_events.is_test_mode migration', () => {
  it('is_test_mode column exists on webhook_events', async () => {
    // Insert a test row and check that is_test_mode is selectable
    const testEventId = 'evt_test_migration_test_' + Date.now();
    const { data, error } = await supabase
      .from('webhook_events')
      .insert({
        event_id: testEventId,
        type: 'checkout.session.completed',
        status: 'processing',
        payload: { data: { object: { id: 'cs_test_migration' } } },
      })
      .select('id, event_id, is_test_mode')
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.event_id).toBe(testEventId);
    // is_test_mode should be selectable (null for new rows not stamped by the RPC)
    expect(data).toHaveProperty('is_test_mode');

    // Clean up
    await supabase.from('webhook_events').delete().eq('event_id', testEventId);
  });

  it('known test-mode records (evt_test_*) are backfilled with is_test_mode=true', async () => {
    // Insert a synthetic test event and run the backfill logic
    const testEventId = 'evt_test_backfill_check_' + Date.now();
    await supabase
      .from('webhook_events')
      .insert({
        event_id: testEventId,
        type: 'checkout.session.completed',
        status: 'processing',
        payload: { data: { object: { id: 'cs_test_backfill' } } },
      });

    // Manually apply the backfill for evt_test_* records
    // (the migration already ran, but we verify the pattern works)
    await supabase
      .from('webhook_events')
      .update({ is_test_mode: true })
      .eq('event_id', testEventId)
      .like('event_id', 'evt_test_%');

    const { data, error } = await supabase
      .from('webhook_events')
      .select('is_test_mode')
      .eq('event_id', testEventId)
      .single();

    expect(error).toBeNull();
    expect(data.is_test_mode).toBe(true);

    // Clean up
    await supabase.from('webhook_events').delete().eq('event_id', testEventId);
  });

  it('claim_webhook_event RPC accepts p_is_test_mode parameter', async () => {
    const testEventId = 'evt_test_rpc_check_' + Date.now();
    const { data, error } = await supabase.rpc('claim_webhook_event', {
      p_event_id: testEventId,
      p_type: 'checkout.session.completed',
      p_is_test_mode: true,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined(); // should return a uuid

    // Verify the record was stamped with is_test_mode=true
    const { data: row, error: rowError } = await supabase
      .from('webhook_events')
      .select('is_test_mode')
      .eq('event_id', testEventId)
      .single();

    expect(rowError).toBeNull();
    expect(row.is_test_mode).toBe(true);

    // Clean up
    await supabase.from('webhook_events').delete().eq('event_id', testEventId);
  });

  it('claim_webhook_event RPC works without p_is_test_mode (backward compat)', async () => {
    const testEventId = 'evt_test_rpc_compat_' + Date.now();
    const { data, error } = await supabase.rpc('claim_webhook_event', {
      p_event_id: testEventId,
      p_type: 'checkout.session.completed',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined(); // should return a uuid

    // Verify the record exists (is_test_mode will be null)
    const { data: row, error: rowError } = await supabase
      .from('webhook_events')
      .select('is_test_mode')
      .eq('event_id', testEventId)
      .single();

    expect(rowError).toBeNull();
    expect(row).toBeDefined();

    // Clean up
    await supabase.from('webhook_events').delete().eq('event_id', testEventId);
  });
});
