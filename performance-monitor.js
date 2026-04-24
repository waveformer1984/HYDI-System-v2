/**
 * Performance Monitor for The Forge
 * Real-time monitoring of system health and revenue metrics
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

class PerformanceMonitor {
  constructor() {
    this.supabase = null;
    this.monitoring = false;
    this.interval = null;
    
    this.initialize();
  }
  
  async initialize() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseKey && !supabaseKey.includes('sb_publishable')) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      console.log('Performance Monitor: Supabase connected');
    } else {
      console.error('Performance Monitor: Invalid Supabase credentials');
      process.exit(1);
    }
  }
  
  startMonitoring(intervalMinutes = 1) {
    if (this.monitoring) {
      console.log('Performance Monitor: Already running');
      return;
    }
    
    console.log(`Starting Performance Monitor (every ${intervalMinutes} minute(s))...`);
    this.monitoring = true;
    
    this.interval = setInterval(async () => {
      await this.collectMetrics();
    }, intervalMinutes * 60 * 1000);
    
    // Initial collection
    this.collectMetrics();
  }
  
  async collectMetrics() {
    const timestamp = new Date().toISOString();
    console.log(`\n=== PERFORMANCE METRICS - ${timestamp} ===`);
    
    try {
      // System Health
      const { data: systemStatus, error: statusError } = await this.supabase
        .from('system_status')
        .select('*')
        .order('last_broadcast', { ascending: false })
        .limit(5);
      
      if (statusError) throw statusError;
      
      if (systemStatus && systemStatus.length > 0) {
        const latest = systemStatus[0];
        console.log(`System Status: ${latest.status}`);
        console.log(`CPU Usage: ${latest.cpu_usage}%`);
        console.log(`Active Services: ${latest.active_services}`);
        console.log(`Last Broadcast: ${latest.last_broadcast}`);
      }
      
      // Lead Metrics
      const { data: leads, error: leadsError } = await this.supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (leadsError) throw leadsError;
      
      const totalLeads = leads?.length || 0;
      const welcomedLeads = leads?.filter(l => l.welcome_sent).length || 0;
      const welcomeRate = totalLeads > 0 ? ((welcomedLeads / totalLeads) * 100).toFixed(1) : 0;
      
      console.log(`Total Leads: ${totalLeads}`);
      console.log(`Welcomed: ${welcomedLeads} (${welcomeRate}%)`);
      
      // Recent Activity
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentLeads = leads?.filter(l => l.created_at >= oneHourAgo) || [];
      
      console.log(`Last Hour: ${recentLeads.length} new leads`);
      
      // Memory Activity
      const { data: memory, error: memoryError } = await this.supabase
        .from('heidi_memory')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (!memoryError && memory && memory.length > 0) {
        console.log(`Recent Interactions: ${memory.length}`);
        memory.forEach(mem => {
          console.log(`  - ${mem.user_email}: ${mem.last_interaction_type}`);
        });
      }
      
      // Revenue Projection
      const dailyProjection = totalLeads * 0.15 * 49; // 15% conversion, $49 avg
      console.log(`Daily Revenue Projection: $${dailyProjection.toFixed(2)}`);
      
      console.log(`=== END METRICS ===\n`);
      
    } catch (err) {
      console.error('Metrics collection failed:', err.message);
    }
  }
  
  stopMonitoring() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.monitoring = false;
    console.log('Performance Monitor stopped');
  }
}

// Start monitoring if called directly
if (require.main === module) {
  const monitor = new PerformanceMonitor();
  
  monitor.startMonitoring(1); // Every minute
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping Performance Monitor...');
    monitor.stopMonitoring();
    process.exit(0);
  });
}

module.exports = PerformanceMonitor;
