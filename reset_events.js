#!/usr/bin/env node

require('dotenv').config({ path: '.env.production' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetFailedEvents() {
  console.log('🔄 Resetting failed events to pending status...\n');

  try {
    // Fetch all failed events
    const { data: failedEvents, error: fetchError } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('status', 'failed')
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch events: ${fetchError.message}`);
    }

    console.log(`📊 Found ${failedEvents.length} failed events\n`);

    if (failedEvents.length === 0) {
      console.log('✓ No failed events to reset');
      return;
    }

    // Reset each event to pending
    for (const event of failedEvents) {
      const { error: updateError } = await supabase
        .from('hydi_events')
        .update({
          status: 'pending',
          retry_count: (event.retry_count || 0) + 1,
          last_retry_at: new Date().toISOString()
        })
        .eq('event_id', event.event_id);

      if (updateError) {
        console.error(`❌ Failed to reset ${event.event_id}: ${updateError.message}`);
      } else {
        console.log(`✓ Reset: ${event.type} event (${event.event_id})`);
      }
    }

    console.log(`\n✅ Successfully reset ${failedEvents.length} events to pending status`);
    console.log('⏰ Worker will begin processing in 4 seconds...\n');

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

resetFailedEvents();
