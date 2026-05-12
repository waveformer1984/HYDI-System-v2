require('dotenv').config({ path: '.env.production' });
const { processEvent } = require('./hydi-processor');

// Ghost Producer for Stage 1 - Internal Heartbeat
class GhostProducer {
  constructor(interval = 300000) { // 5 minutes
    this.interval = interval;
    this.running = false;
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 0
    };
  }

  async produceHeartbeat() {
    const startTime = Date.now();
    const heartbeatId = `ghost-${Date.now()}`;
    
    try {
      const result = await processEvent('ghost-producer', 'system', {
        heartbeat_id: heartbeatId,
        timestamp: startTime,
        environment: process.env.ENVIRONMENT || 'production',
        version: '1.0.0',
        stage: 'heartbeat',
        interval: this.interval,
        stats: { ...this.stats }
      });

      const latency = Date.now() - startTime;
      
      if (result.success) {
        this.stats.success++;
        this.stats.lastSuccess = new Date().toISOString();
        this.stats.consecutiveFailures = 0;
        
        console.log(`GHOST SUCCESS: ${heartbeatId} (${latency}ms) - Total: ${this.stats.total}`);
      } else {
        this.handleFailure(heartbeatId, result.error);
      }
      
      this.stats.total++;
      
    } catch (error) {
      this.handleFailure(heartbeatId, error.message);
    }
  }

  handleFailure(heartbeatId, error) {
    this.stats.failed++;
    this.stats.lastFailure = new Date().toISOString();
    this.stats.consecutiveFailures++;
    this.stats.maxConsecutiveFailures = Math.max(
      this.stats.maxConsecutiveFailures, 
      this.stats.consecutiveFailures
    );
    
    console.log(`GHOST FAILED: ${heartbeatId} - ${error} (Consecutive: ${this.stats.consecutiveFailures})`);
    
    // Alert if too many consecutive failures
    if (this.stats.consecutiveFailures >= 3) {
      console.log(`ALERT: ${this.stats.consecutiveFailures} consecutive ghost producer failures`);
      // Here you would send to PagerDuty/Slack
    }
  }

  start() {
    if (this.running) {
      console.log('Ghost producer already running');
      return;
    }
    
    this.running = true;
    console.log(`Starting ghost producer (interval: ${this.interval}ms)`);
    console.log('Stage 1: 24-hour heartbeat verification');
    
    // Send first heartbeat immediately
    this.produceHeartbeat();
    
    // Set up interval
    this.heartbeatInterval = setInterval(() => {
      this.produceHeartbeat();
    }, this.interval);
    
    // Daily stats report
    this.statsInterval = setInterval(() => {
      this.reportDailyStats();
    }, 86400000); // 24 hours
    
    // Hourly health check
    this.healthInterval = setInterval(() => {
      this.healthCheck();
    }, 3600000); // 1 hour
  }

  stop() {
    if (!this.running) {
      console.log('Ghost producer not running');
      return;
    }
    
    this.running = false;
    clearInterval(this.heartbeatInterval);
    clearInterval(this.statsInterval);
    clearInterval(this.healthInterval);
    
    console.log('Ghost producer stopped');
    this.reportFinalStats();
  }

  healthCheck() {
    const successRate = this.stats.total > 0 ? (this.stats.success / this.stats.total * 100) : 0;
    const uptime = this.running ? 'ACTIVE' : 'STOPPED';
    
    console.log(`=== GHOST HEALTH CHECK ===`);
    console.log(`Status: ${uptime}`);
    console.log(`Success Rate: ${successRate.toFixed(2)}%`);
    console.log(`Consecutive Failures: ${this.stats.consecutiveFailures}`);
    console.log(`Last Success: ${this.stats.lastSuccess || 'Never'}`);
    console.log(`Last Failure: ${this.stats.lastFailure || 'Never'}`);
    console.log(`========================`);
    
    // Health check failure criteria
    if (successRate < 95 || this.stats.consecutiveFailures >= 3) {
      console.log('HEALTH CHECK FAILED: System needs attention');
      // Trigger alert
    }
  }

  reportDailyStats() {
    const successRate = this.stats.total > 0 ? (this.stats.success / this.stats.total * 100) : 0;
    
    console.log(`\n=== DAILY GHOST PRODUCER REPORT ===`);
    console.log(`Date: ${new Date().toISOString()}`);
    console.log(`Total Heartbeats: ${this.stats.total}`);
    console.log(`Successful: ${this.stats.success} (${successRate.toFixed(2)}%)`);
    console.log(`Failed: ${this.stats.failed}`);
    console.log(`Max Consecutive Failures: ${this.stats.maxConsecutiveFailures}`);
    console.log(`Success Metric: ${successRate >= 99.9 ? 'PASS' : 'FAIL'} (Target: 99.9%)`);
    console.log(`===================================\n`);
  }

  reportFinalStats() {
    console.log(`\n=== FINAL GHOST PRODUCER STATS ===`);
    console.log(`Total: ${this.stats.total}`);
    console.log(`Success: ${this.stats.success}`);
    console.log(`Failed: ${this.stats.failed}`);
    console.log(`Last Success: ${this.stats.lastSuccess || 'Never'}`);
    console.log(`Last Failure: ${this.stats.lastFailure || 'Never'}`);
    console.log(`Max Consecutive Failures: ${this.stats.maxConsecutiveFailures}`);
    console.log(`===============================\n`);
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.total > 0 ? (this.stats.success / this.stats.total * 100) : 0,
      uptime: this.running,
      interval: this.interval
    };
  }
}

// CLI interface
if (require.main === module) {
  const producer = new GhostProducer();
  
  const command = process.argv[2] || 'start';
  
  switch (command) {
    case 'start':
      producer.start();
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down ghost producer...');
        producer.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        console.log('\nShutting down ghost producer...');
        producer.stop();
        process.exit(0);
      });
      
      // Keep process alive
      process.stdin.resume();
      break;
      
    case 'stop':
      producer.stop();
      break;
      
    case 'health':
      producer.healthCheck();
      break;
      
    case 'stats':
      console.log(JSON.stringify(producer.getStats(), null, 2));
      break;
      
    default:
      console.log('Usage: node ghost-producer.js [start|stop|health|stats]');
      process.exit(1);
  }
}

module.exports = { GhostProducer };
