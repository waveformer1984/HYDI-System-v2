require('dotenv').config({ path: '.env.production' });
const { createClient } = require('@supabase/supabase-js');

// Persistence Monitor - Operational Guardrail
class PersistenceMonitor {
  constructor(checkInterval = 900000) { // 15 minutes
    this.checkInterval = checkInterval;
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.running = false;
    this.alerts = [];
    this.lastEventTime = null;
    this.consecutiveFailures = 0;
  }

  async checkPersistence() {
    console.log(`=== PERSISTENCE MONITOR CHECK ===`);
    console.log(`Time: ${new Date().toISOString()}`);
    
    try {
      // Check for recent events (last 15 minutes)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      
      const { data: recentEvents, error } = await this.supabase
        .from('hydi_events')
        .select('event_id, timestamp, status')
        .gte('timestamp', fifteenMinutesAgo)
        .order('timestamp', { ascending: false })
        .limit(10);

      if (error) {
        throw new Error(`Database query failed: ${error.message}`);
      }

      const eventCount = recentEvents.length;
      const now = new Date();
      
      if (eventCount === 0) {
        this.handleAlert('CRITICAL', 'No events in last 15 minutes', {
          checkTime: now.toISOString(),
          lastCheck: this.lastEventTime,
          consecutiveFailures: this.consecutiveFailures
        });
      } else {
        // Update last event time
        this.lastEventTime = recentEvents[0].timestamp;
        this.consecutiveFailures = 0;
        
        console.log(`SUCCESS: Found ${eventCount} events in last 15 minutes`);
        console.log(`Latest event: ${recentEvents[0].event_id.substring(0, 8)}... (${recentEvents[0].timestamp})`);
        
        // Check event status distribution
        const statusBreakdown = recentEvents.reduce((acc, event) => {
          acc[event.status] = (acc[event.status] || 0) + 1;
          return acc;
        }, {});
        
        console.log('Status breakdown:', statusBreakdown);
        
        // Check for high failure rate
        const failureRate = (statusBreakdown.failed || 0) / eventCount * 100;
        if (failureRate > 10) {
          this.handleAlert('WARNING', 'High failure rate detected', {
            failureRate: failureRate.toFixed(2) + '%',
            totalEvents: eventCount,
            breakdown: statusBreakdown
          });
        }
        
        // Check for stuck events (high pending count)
        const pendingRate = (statusBreakdown.pending || 0) / eventCount * 100;
        if (pendingRate > 20) {
          this.handleAlert('WARNING', 'High pending rate detected', {
            pendingRate: pendingRate.toFixed(2) + '%',
            totalEvents: eventCount,
            breakdown: statusBreakdown
          });
        }
      }

      // Check database connectivity
      await this.checkDatabaseConnectivity();
      
      // Check system health
      await this.checkSystemHealth();
      
    } catch (error) {
      this.handleAlert('CRITICAL', 'Persistence monitor failed', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`===============================`);
  }

  async checkDatabaseConnectivity() {
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('count')
        .limit(1);

      if (error) {
        throw new Error(`Connectivity test failed: ${error.message}`);
      }
      
      console.log('Database connectivity: OK');
      
    } catch (error) {
      this.handleAlert('CRITICAL', 'Database connectivity issue', {
        error: error.message
      });
    }
  }

  async checkSystemHealth() {
    const now = Date.now();
    
    // Check if we've been running too long without events
    if (this.lastEventTime) {
      const timeSinceLastEvent = now - new Date(this.lastEventTime).getTime();
      const minutesSinceLastEvent = timeSinceLastEvent / (1000 * 60);
      
      if (minutesSinceLastEvent > 30) {
        this.handleAlert('CRITICAL', 'No events for over 30 minutes', {
          lastEventTime: this.lastEventTime,
          minutesSinceLastEvent: minutesSinceLastEvent.toFixed(2)
        });
      }
    }
    
    // Check alert rate
    const recentAlerts = this.alerts.filter(alert => 
      (now - new Date(alert.timestamp).getTime()) < (1000 * 60 * 60) // Last hour
    );
    
    if (recentAlerts.length > 5) {
      this.handleAlert('WARNING', 'High alert frequency', {
        alertCount: recentAlerts.length,
        timeWindow: '1 hour'
      });
    }
  }

  handleAlert(severity, message, details = {}) {
    const alert = {
      id: `alert-${Date.now()}`,
      severity,
      message,
      details,
      timestamp: new Date().toISOString()
    };
    
    this.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
    
    // Update consecutive failures
    if (severity === 'CRITICAL') {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 0;
    }
    
    // Log alert
    console.log(`ALERT [${severity}]: ${message}`);
    if (Object.keys(details).length > 0) {
      console.log('Details:', JSON.stringify(details, null, 2));
    }
    
    // Send to external monitoring (PagerDuty, Slack, etc.)
    this.sendAlert(alert);
  }

  async sendAlert(alert) {
    // This would integrate with your alerting system
    // For now, just log it prominently
    
    const alertMessage = `
=== HYDI SYSTEM ALERT ===
Severity: ${alert.severity}
Message: ${alert.message}
Time: ${alert.timestamp}
Details: ${JSON.stringify(alert.details, null, 2)}
============================
`;
    
    console.log(alertMessage);
    
    // In production, you would:
    // - Send to PagerDuty for CRITICAL alerts
    // - Post to Slack channel
    // - Send email notification
    // - Create incident in tracking system
    
    if (alert.severity === 'CRITICAL' && this.consecutiveFailures >= 3) {
      console.log('ESCALATION: Multiple critical failures detected!');
      // Trigger emergency procedures
    }
  }

  start() {
    if (this.running) {
      console.log('Persistence monitor already running');
      return;
    }
    
    this.running = true;
    console.log(`Starting persistence monitor (interval: ${this.checkInterval/1000/60} minutes)`);
    
    // Run first check immediately
    this.checkPersistence();
    
    // Set up interval
    this.monitorInterval = setInterval(() => {
      this.checkPersistence();
    }, this.checkInterval);
  }

  stop() {
    if (!this.running) {
      console.log('Persistence monitor not running');
      return;
    }
    
    this.running = false;
    clearInterval(this.monitorInterval);
    
    console.log('Persistence monitor stopped');
  }

  getAlerts(severity = null, hours = 24) {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    let filtered = this.alerts.filter(alert => 
      new Date(alert.timestamp).getTime() > cutoff
    );
    
    if (severity) {
      filtered = filtered.filter(alert => alert.severity === severity);
    }
    
    return filtered;
  }

  getStatus() {
    return {
      running: this.running,
      lastEventTime: this.lastEventTime,
      consecutiveFailures: this.consecutiveFailures,
      totalAlerts: this.alerts.length,
      recentAlerts: this.getAlerts(null, 1).length,
      checkInterval: this.checkInterval
    };
  }
}

// CLI interface
if (require.main === module) {
  const monitor = new PersistenceMonitor();
  
  const command = process.argv[2] || 'start';
  
  switch (command) {
    case 'start':
      monitor.start();
      
      process.on('SIGINT', () => {
        console.log('\nStopping persistence monitor...');
        monitor.stop();
        process.exit(0);
      });
      
      process.stdin.resume();
      break;
      
    case 'stop':
      monitor.stop();
      break;
      
    case 'check':
      monitor.checkPersistence();
      break;
      
    case 'alerts':
      const hours = parseInt(process.argv[3]) || 24;
      const alerts = monitor.getAlerts(null, hours);
      console.log(`Alerts in last ${hours} hours: ${alerts.length}`);
      alerts.forEach(alert => {
        console.log(`[${alert.severity}] ${alert.timestamp}: ${alert.message}`);
      });
      break;
      
    case 'status':
      console.log(JSON.stringify(monitor.getStatus(), null, 2));
      break;
      
    default:
      console.log('Usage: node persistence-monitor.js [start|stop|check|alerts [hours]|status]');
      process.exit(1);
  }
}

module.exports = { PersistenceMonitor };
