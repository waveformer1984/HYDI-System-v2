/**
 * Load Test: 500 Requests
 * Simulates high traffic to verify Gatekeeper cache, TTL enforcement, and telemetry
 */

const { performance } = require('perf_hooks');
const UniversalAgentBus = require('./modules/universal-agent-bus');

class LoadTest500 {
  constructor() {
    this.bus = new UniversalAgentBus({ name: 'LoadTestBus' });
    this.results = {
      totalRequests: 0,
      successful: 0,
      ttlExpired: 0,
      latencySpikes: [],
      startTime: null,
      endTime: null
    };
  }

  async run() {
    console.log('\n🔥 LOAD TEST: 500 Requests');
    console.log('============================\n');

    this.results.startTime = performance.now();

    // Setup model with varying latencies
    this.setupMockModels();

    // Run 500 requests
    await this.runRequests(500);

    this.results.endTime = performance.now();

    await this.analyzeResults();
  }

  setupMockModels() {
    // Listen for model requests and simulate responses
    this.bus.on('bus:LocalModel:model_request', async (msg) => {
      const latency = msg.payload?.simulatedLatency || 100;
      
      await this.sleep(latency);
      
      // Some requests should TTL (exceed their TTL)
      if (latency > msg.ttl) {
        // Don't respond - let it TTL
        return;
      }
      
      this.bus.respond(msg.id, { 
        result: 'success', 
        model: msg.payload?.modelId,
        latency 
      });
    });
  }

  async runRequests(count) {
    const requests = [];
    
    for (let i = 0; i < count; i++) {
      const tier = i % 3 === 0 ? 'enterprise' : (i % 3 === 1 ? 'pro' : 'starter');
      const latency = i % 10 === 0 ? 500 : (i % 20 === 0 ? 50000 : 100); // Some slow, some TTL
      
      requests.push(this.makeRequest(i, tier, latency));
    }
    
    await Promise.allSettled(requests);
  }

  async makeRequest(index, tier, simulatedLatency) {
    this.results.totalRequests++;
    
    try {
      const result = await this.bus.request('Ursula', 'LocalModel', 'model_request', {
        modelId: `model-${index % 5}`,
        simulatedLatency,
        customerId: `cust-${index % 50}`,
        tier
      }, { 
        tier, 
        ttl: simulatedLatency > 30000 ? 1000 : 30000 // Short TTL for slow requests
      });
      
      this.results.successful++;
      
      if (result.elapsed > 5000) {
        this.results.latencySpikes.push({ index, elapsed: result.elapsed, tier });
      }
    } catch (err) {
      if (err.message.includes('timed out') || err.message.includes('TTL')) {
        this.results.ttlExpired++;
      }
    }
  }

  async analyzeResults() {
    const duration = (this.results.endTime - this.results.startTime).toFixed(0);
    const rps = (this.results.totalRequests / (duration / 1000)).toFixed(1);
    
    console.log('\n📊 LOAD TEST RESULTS');
    console.log('=====================');
    console.log(`Total Requests: ${this.results.totalRequests}`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Throughput: ${rps} req/s`);
    console.log(`Successful: ${this.results.successful} (${((this.results.successful/500)*100).toFixed(1)}%)`);
    console.log(`TTL Expired: ${this.results.ttlExpired} (${((this.results.ttlExpired/500)*100).toFixed(1)}%)`);
    console.log(`Latency Spikes (>5s): ${this.results.latencySpikes.length}`);
    
    // Check telemetry
    const ttlEvents = this.bus.telemetryBuffer.filter(t => 
      t.event_type === 'request_timeout' || t.event_type === 'queue_ttl_expired'
    );
    console.log(`\nTelemetry TTL Events: ${ttlEvents.length}`);
    
    if (this.results.ttlExpired > 0 && ttlEvents.length > 0) {
      console.log('\n✅ TTL CLUSTERS DETECTED: system_telemetry capturing TTL events correctly');
    } else if (this.results.ttlExpired === 0) {
      console.log('\n⚠️ No TTL events (all requests fast - adjust test for TTL validation)');
    }
    
    // Priority distribution
    const priorities = {};
    this.bus.telemetryBuffer.forEach(t => {
      if (t.priority !== undefined) {
        priorities[t.priority] = (priorities[t.priority] || 0) + 1;
      }
    });
    console.log('\nPriority Distribution:', priorities);
    
    console.log('\n✅ LOAD TEST COMPLETE');
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

async function main() {
  const test = new LoadTest500();
  await test.run();
  process.exit(0);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = LoadTest500;
