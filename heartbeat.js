require('dotenv').config();
const { processEvent } = require('./hydi-processor');

// Dark Launch Heartbeat Script
class HeartbeatMonitor {
  constructor(interval = 60000) { // 1 minute
    this.interval = interval;
    this.running = false;
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      lastSuccess: null,
      lastFailure: null,
      avgLatency: 0
    };
  }

  async sendHeartbeat() {
    const startTime = Date.now();
    const heartbeatId = `heartbeat-${Date.now()}`;
    
    try {
      const result = await processEvent('heartbeat', 'system', {
        heartbeat_id: heartbeatId,
        timestamp: startTime,
        environment: process.env.ENVIRONMENT || 'unknown',
        version: process.env.VERSION || '1.0.0'
      });

      const latency = Date.now() - startTime;
      
      if (result.success) {
        this.stats.success++;
        this.stats.lastSuccess = new Date().toISOString();
        console.log(`HEARTBEAT SUCCESS: ${heartbeatId} (${latency}ms)`);
      } else {
        this.stats.failed++;
        this.stats.lastFailure = new Date().toISOString();
        console.log(`HEARTBEAT FAILED: ${heartbeatId} - ${result.error}`);
      }
      
      this.stats.total++;
      this.stats.avgLatency = (this.stats.avgLatency * (this.stats.total - 1) + latency) / this.stats.total;
      
    } catch (error) {
      this.stats.failed++;
      this.stats.lastFailure = new Date().toISOString();
      console.log(`HEARTBEAT ERROR: ${error.message}`);
    }
  }

  start() {
    if (this.running) {
      console.log('Heartbeat already running');
      return;
    }
    
    this.running = true;
    console.log(`Starting heartbeat monitor (interval: ${this.interval}ms)`);
    
    // Send first heartbeat immediately
    this.sendHeartbeat();
    
    // Set up interval
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.interval);
    
    // Stats reporting every 10 heartbeats
    this.statsInterval = setInterval(() => {
      this.reportStats();
    }, this.interval * 10);
  }

  stop() {
    if (!this.running) {
      console.log('Heartbeat not running');
      return;
    }
    
    this.running = false;
    clearInterval(this.heartbeatInterval);
    clearInterval(this.statsInterval);
    console.log('Heartbeat monitor stopped');
  }

  reportStats() {
    const successRate = this.stats.total > 0 ? (this.stats.success / this.stats.total * 100).toFixed(2) : 0;
    
    console.log(`=== HEARTBEAT STATS ===`);
    console.log(`Total: ${this.stats.total}`);
    console.log(`Success: ${this.stats.success} (${successRate}%)`);
    console.log(`Failed: ${this.stats.failed}`);
    console.log(`Avg Latency: ${this.stats.avgLatency.toFixed(2)}ms`);
    console.log(`Last Success: ${this.stats.lastSuccess || 'Never'}`);
    console.log(`Last Failure: ${this.stats.lastFailure || 'Never'}`);
    console.log(`=====================`);
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.total > 0 ? (this.stats.success / this.stats.total * 100) : 0,
      uptime: this.running
    };
  }
}

// CLI interface
if (require.main === module) {
  const monitor = new HeartbeatMonitor();
  
  const command = process.argv[2] || 'start';
  
  switch (command) {
    case 'start':
      monitor.start();
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\\nShutting down heartbeat monitor...');
        monitor.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        console.log('\\nShutting down heartbeat monitor...');
        monitor.stop();
        process.exit(0);
      });
      
      // Keep process alive
      process.stdin.resume();
      break;
      
    case 'stop':
      monitor.stop();
      break;
      
    case 'stats':
      console.log(JSON.stringify(monitor.getStats(), null, 2));
      break;
      
    default:
      console.log('Usage: node heartbeat.js [start|stop|stats]');
      process.exit(1);
  }
}

module.exports = { HeartbeatMonitor };
