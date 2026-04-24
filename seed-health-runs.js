/**
 * SEED HEALTH RUNS
 * Populates system_health_runs to activate trend analysis
 * Run: node seed-health-runs.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedHealthRuns() {
  console.log('🌱 Seeding system_health_runs...\n');
  
  const now = new Date();
  const runs = [];
  
  // Create 5 healthy runs
  for (let i = 0; i < 5; i++) {
    runs.push({
      run_at: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(), // Every 2 minutes
      status: 'OK',
      environment: 'production',
      queue_status: 'OK',
      event_flow_status: 'OK',
      revenue_status: 'OK',
      automation_status: 'OK',
      entitlements_status: 'OK',
      issues_count: 0,
      warnings_count: 0,
      details: {
        timestamp: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(),
        status: 'OK',
        components: {
          queue: { status: 'OK', queued: 5, failed: 0, total: 100 },
          eventFlow: { status: 'OK', recentEventsCount: 15, lastEventMinutesAgo: 2 },
          revenue: { status: 'OK', payments24h: 3, revenue24h: 150.00 },
          automation: { status: 'OK', heartbeats5min: 4 },
          entitlements: { status: 'OK', active: 10, total: 10 }
        },
        issues: [],
        warnings: []
      }
    });
  }
  
  // Insert runs
  const { data, error } = await supabase
    .from('system_health_runs')
    .insert(runs);
  
  if (error) {
    console.error('❌ Error seeding health runs:', error);
    process.exit(1);
  }
  
  console.log(`✅ Inserted ${runs.length} health runs`);
  
  // Verify trend analysis now works
  console.log('\n🔍 Checking trend analysis...');
  const { data: trend, error: trendError } = await supabase.rpc('analyze_health_trends');
  
  if (trendError) {
    console.error('❌ Trend analysis error:', trendError);
  } else {
    console.log('Trend status:', JSON.stringify(trend, null, 2));
  }
  
  // Check escalation
  console.log('\n🔍 Checking escalation...');
  const { data: esc, error: escError } = await supabase.rpc('evaluate_system_escalation');
  
  if (escError) {
    console.error('❌ Escalation error:', escError);
  } else {
    console.log('Escalation:', JSON.stringify(esc, null, 2));
  }
  
  // View dashboard
  console.log('\n📊 Dashboard view:');
  const { data: dash, error: dashError } = await supabase
    .from('system_dashboard')
    .select('*')
    .single();
  
  if (dashError) {
    console.error('❌ Dashboard error:', dashError);
  } else {
    console.log(JSON.stringify(dash, null, 2));
  }
  
  console.log('\n✅ Health runs seeded successfully!');
  console.log('Run this again after 2+ minutes to see trend analysis in action.');
}

seedHealthRuns().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
