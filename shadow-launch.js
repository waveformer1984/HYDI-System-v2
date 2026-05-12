require('dotenv').config({ path: '.env.production' });
const { processEvent } = require('./hydi-processor');

// Shadow Launch Controller - Stage 2
class ShadowLaunchController {
  constructor(targetPercentage = 10) {
    this.targetPercentage = targetPercentage; // 10% traffic
    this.totalRequests = 0;
    this.shadowRequests = 0;
    this.directRequests = 0;
    this.shadowLatencies = [];
    this.startupTime = Date.now();
    this.running = false;
  }

  async processWithShadow(source, type, payload) {
    this.totalRequests++;
    const startTime = Date.now();
    
    // Determine if this request should go to shadow
    const shouldShadow = Math.random() * 100 < this.targetPercentage;
    
    if (shouldShadow) {
      this.shadowRequests++;
      
      try {
        const result = await processEvent(source, type, {
          ...payload,
          shadow_launch: true,
          original_request_id: payload.request_id || `shadow-${Date.now()}`,
          traffic_percentage: this.targetPercentage
        });
        
        const latency = Date.now() - startTime;
        this.shadowLatencies.push(latency);
        
        console.log(`SHADOW: ${source}/${type} (${latency}ms) - ${result.success ? 'SUCCESS' : 'FAILED'}`);
        
        // Performance monitoring
        if (latency > 200) {
          console.log(`PERFORMANCE ALERT: Shadow request took ${latency}ms (>200ms threshold)`);
        }
        
        return result;
        
      } catch (error) {
        console.log(`SHADOW ERROR: ${source}/${type} - ${error.message}`);
        return { success: false, error: error.message };
      }
      
    } else {
      // Direct processing (existing path)
      this.directRequests++;
      
      try {
        const result = await processEvent(source, type, payload);
        const latency = Date.now() - startTime;
        
        console.log(`DIRECT: ${source}/${type} (${latency}ms) - ${result.success ? 'SUCCESS' : 'FAILED'}`);
        
        return result;
        
      } catch (error) {
        console.log(`DIRECT ERROR: ${source}/${type} - ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  }

  getPerformanceMetrics() {
    if (this.shadowLatencies.length === 0) {
      return {
        avgLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        p95Latency: 0,
        requestsPerSecond: 0
      };
    }
    
    const sorted = this.shadowLatencies.sort((a, b) => a - b);
    const runtime = (Date.now() - this.startupTime) / 1000;
    
    return {
      avgLatency: this.shadowLatencies.reduce((sum, lat) => sum + lat, 0) / this.shadowLatencies.length,
      maxLatency: Math.max(...this.shadowLatencies),
      minLatency: Math.min(...this.shadowLatencies),
      p95Latency: sorted[Math.floor(sorted.length * 0.95)],
      requestsPerSecond: this.shadowRequests / runtime
    };
  }

  healthCheck() {
    const metrics = this.getPerformanceMetrics();
    const successRate = this.shadowRequests > 0 ? 
      (this.shadowLatencies.filter(l => l < 200).length / this.shadowLatencies.length * 100) : 0;
    
    console.log(`=== SHADOW LAUNCH HEALTH ===`);
    console.log(`Target Traffic: ${this.targetPercentage}%`);
    console.log(`Total Requests: ${this.totalRequests}`);
    console.log(`Shadow Requests: ${this.shadowRequests} (${(this.shadowRequests/this.totalRequests*100).toFixed(1)}%)`);
    console.log(`Direct Requests: ${this.directRequests}`);
    console.log(`Shadow Latency - Avg: ${metrics.avgLatency.toFixed(2)}ms, P95: ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(`Success Rate (<200ms): ${successRate.toFixed(2)}%`);
    console.log(`Status: ${metrics.avgLatency < 200 && successRate >= 95 ? 'HEALTHY' : 'NEEDS_ATTENTION'}`);
    console.log(`============================`);
    
    return {
      healthy: metrics.avgLatency < 200 && successRate >= 95,
      metrics,
      successRate
    };
  }

  startMonitoring(interval = 60000) { // Every minute
    if (this.running) {
      console.log('Shadow launch monitoring already running');
      return;
    }
    
    this.running = true;
    console.log(`Starting shadow launch monitoring (${this.targetPercentage}% traffic)`);
    
    this.monitoringInterval = setInterval(() => {
      this.healthCheck();
    }, interval);
  }

  stopMonitoring() {
    if (!this.running) {
      console.log('Shadow launch monitoring not running');
      return;
    }
    
    this.running = false;
    clearInterval(this.monitoringInterval);
    
    console.log('Shadow launch monitoring stopped');
    this.healthCheck();
  }

  // Simulate traffic for testing
  async simulateTraffic(duration = 300000) { // 5 minutes
    console.log(`Simulating traffic for ${duration/1000} seconds...`);
    
    const endTime = Date.now() + duration;
    let requestCount = 0;
    
    while (Date.now() < endTime) {
      requestCount++;
      
      await this.processWithShadow(
        'simulator',
        'error',
        {
          request_id: `sim-${requestCount}`,
          message: `Simulated request ${requestCount}`,
          timestamp: Date.now()
        }
      );
      
      // Random delay between requests (100ms to 1s)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 900 + 100));
    }
    
    console.log(`Simulation complete: ${requestCount} requests processed`);
  }
}

// CLI interface
if (require.main === module) {
  const controller = new ShadowLaunchController(10); // 10% shadow traffic
  
  const command = process.argv[2] || 'monitor';
  
  switch (command) {
    case 'monitor':
      controller.startMonitoring();
      
      process.on('SIGINT', () => {
        console.log('\nStopping shadow launch monitoring...');
        controller.stopMonitoring();
        process.exit(0);
      });
      
      process.stdin.resume();
      break;
      
    case 'simulate':
      const duration = parseInt(process.argv[3]) || 300000; // 5 minutes default
      controller.simulateTraffic(duration).then(() => {
        controller.healthCheck();
        process.exit(0);
      });
      break;
      
    case 'health':
      controller.healthCheck();
      break;
      
    case 'test':
      // Test single request
      controller.processWithShadow('test', 'error', {
        message: 'Test request',
        timestamp: Date.now()
      }).then(result => {
        console.log('Test result:', result);
        controller.healthCheck();
      });
      break;
      
    default:
      console.log('Usage: node shadow-launch.js [monitor|simulate|health|test]');
      process.exit(1);
  }
}

module.exports = { ShadowLaunchController };
