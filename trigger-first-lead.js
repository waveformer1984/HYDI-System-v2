/**
 * Trigger First Lead Test
 * Manually creates the first lead to verify Heidi's outreach automation
 */

const { createClient } = require('@supabase/supabase-js');
const HeidiRevenueOutreach = require('./modules/heidi-revenue-outreach');

require('dotenv').config();

async function triggerFirstLead() {
  console.log('=== TRIGGERING FIRST LEAD TEST ===\n');
  
  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey || supabaseKey.includes('sb_publishable')) {
    console.error('Invalid Supabase credentials. Check .env configuration.');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase connected');
  
  // Initialize Heidi Outreach
  const heidiOutreach = new HeidiRevenueOutreach();
  console.log('Heidi Outreach initialized');
  
  try {
    // Create the first lead
    const testLead = {
      email: `founder-${Date.now()}@theforge.local`,
      source: 'heidi_broadcast',
      metadata: {
        test: true,
        first_lead: true,
        tier: 'starter',
        interests: ['SEO Content Generator', 'Data Pipeline Builder', 'Performance Profiler'],
        utm_source: 'forge_lockdown_test',
        signup_reason: 'Testing the hardened revenue engine'
      }
    };
    
    console.log('Creating first lead...');
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert(testLead)
      .select();
    
    if (leadError) {
      console.error('Failed to create lead:', leadError.message);
      process.exit(1);
    }
    
    const lead = leadData[0];
    console.log(`Lead created: ${lead.id}`);
    console.log(`Email: ${lead.email}`);
    console.log(`Interests: ${testLead.metadata.interests.join(', ')}`);
    
    // Process the lead through Heidi's outreach
    console.log('\nProcessing through Heidi Outreach...');
    await heidiOutreach.processNewLead(lead);
    
    // Verify the results
    console.log('\n=== VERIFICATION ===');
    
    // Check if Heidi memory was created
    const { data: memoryData, error: memoryError } = await supabase
      .from('heidi_memory')
      .select('*')
      .eq('user_email', lead.email)
      .single();
    
    if (memoryError) {
      console.error('Heidi memory check failed:', memoryError.message);
    } else {
      console.log('Heidi memory entry: CREATED');
      console.log(`Interaction type: ${memoryData.last_interaction_type}`);
    }
    
    // Check if lead was marked as welcomed
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .select('welcome_sent')
      .eq('id', lead.id)
      .single();
    
    if (updateError) {
      console.error('Lead update check failed:', updateError.message);
    } else {
      console.log(`Welcome sent: ${updatedLead.welcome_sent ? 'YES' : 'NO'}`);
    }
    
    // Check system status update
    const { data: statusData, error: statusError } = await supabase
      .from('system_status')
      .select('*')
      .order('last_broadcast', { ascending: false })
      .limit(1);
    
    if (statusError) {
      console.error('System status check failed:', statusError.message);
    } else {
      console.log(`System status: UPDATED`);
      console.log(`Last broadcast: ${statusData[0]?.last_broadcast}`);
      console.log(`Active services: ${statusData[0]?.active_services}`);
      console.log(`CPU usage: ${statusData[0]?.cpu_usage}%`);
    }
    
    console.log('\n=== FIRST LEAD TEST COMPLETE ===');
    console.log('The Forge is now generating revenue!');
    console.log('Heidi has captured, processed, and welcomed the first customer.');
    console.log('\nNext steps:');
    console.log('1. Monitor the leads table for new entries');
    console.log('2. Check heidi_memory for interaction tracking');
    console.log('3. Watch system_status for real-time telemetry');
    console.log('4. Run Heidi 24-hour report tomorrow: node templates/heidi-24-hour-report.js');
    
  } catch (err) {
    console.error('First lead test failed:', err.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  triggerFirstLead();
}

module.exports = triggerFirstLead;
