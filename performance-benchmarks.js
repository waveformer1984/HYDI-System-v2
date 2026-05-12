// Realistic Performance Benchmarks
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { EventContractValidator } = require('./event-contracts');

class PerformanceBenchmarks {
  constructor() {
    this.supabase = createClient(
      process.env.SEST_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.validator = new EventContractValidator();
    this.results = {};
  }

  async runAllBenchmarks() {
    console.log('=== REALISTIC PERFORMANCE BENCHMARKS ===');
    
    const tests = [
      { name: 'Event Creation', test: () => this.benchmarkEventCreation() },
      { name: 'Database Insert', test: () => this.benchmarkDatabaseInsert() },
      { name: 'Idempotency Check', test: () => this.benchmarkIdempotencyCheck() },
      { name: 'Cold Start', test: () => this.benchmarkColdStart() },
      { name: 'Warm Throughput', test: () => this.benchmarkWarmThroughput() },
      { name: 'Concurrent Load', test: () => this.benchmarkConcurrentLoad() },
      { name: 'Memory Usage', test: () => this.benchmarkMemoryUsage() }
    ];
    
    for (const test of tests) {
      console.log(`\n--- ${test.name} ---`);
      
      try {
        const result = await test.test();
        this.results[test.name] = result;
        console.log(`Result: ${result.success ? 'PASS' : 'FAIL'} - ${result.message}`);
        if (result.details) {
          console.log(`Details: ${result.details}`);
        }
      } catch (error) {
        this.results[test.name] = { success: false, error: error.message };
        console.log(`ERROR: ${error.message}`);
      }
    }
    
    this.printBenchmarkReport();
  }

  async benchmarkEventCreation() {
    const iterations = 10000;
    const events = [];
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      const event = this.validator.createEvent('benchmark_test', {
        index: i,
        timestamp: Date.now(),
        payload: { data: `test_data_${i}` }
      });
      events.push(event);
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;
    
    return {
      success: true,
      message: `Created ${iterations} events`,
      details: {
        avg_time_ms: avgTime.toFixed(3),
        total_time_ms: totalTime,
        events_per_second: Math.round(1000 / avgTime)
      }
    };
  }

  async benchmarkDatabaseInsert() {
    const iterations = 1000;
    const events = [];
    
    // Pre-create events
    for (let i = 0; i < iterations; i++) {
      const event = this.validator.createEvent('db_test', {
        index: i,
        timestamp: Date.now(),
        payload: { data: `test_data_${i}` }
      });
      events.push(event);
    }
    
    const startTime = Date.now();
    
    // Insert all events
    for (const event of events) {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .insert([event])
        .select();
      
      if (error) {
        throw new Error(`Insert failed: ${error.message}`);
      }
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;
    
    return {
      success: true,
      message: `Inserted ${iterations} events`,
      details: {
        avg_time_ms: avgTime.toFixed(3),
        total_time_ms: totalTime,
        events_per_second: Math.round(1000 / avgTime)
      }
    };
  }

  async benchmarkIdempotencyCheck() {
    // Simulate checking for duplicates
    const iterations = 1000;
    const eventIds = Array.from({ length: iterations }, () => this.validator.createEvent('idempotency_test', {
      timestamp: Date.now()
    }));
    
    const startTime = Date.now();
    
    // Simulate checking for existing events (round-trip to database)
    for (const eventId of eventIds) {
      // Simulate database check
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('event_id')
        .eq('event_id', eventId)
        .single();
      
      if (error) {
        throw new Error(`Idempotency check failed: ${error.message}`);
      }
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;
    
    return {
      success: true,
      message: `Checked ${iterations} events for duplicates`,
      details: {
        avg_check_time_ms: avgTime.toFixed(3),
        total_time_ms: totalTime,
        checks_per_second: Math.round(1000 / avgTime)
      }
    };
  }

  async benchmarkColdStart() {
    // Cold start - first event after system startup
    const startTime = Date.now();
    
    // First event creation (no caches)
    const event = this.validator.createEvent('cold_start_test', {
      message: 'First event after cold start',
      timestamp: Date.now()
    });
    
    // First database insert (no connection pool)
    const { data, error } = await this.supabase
      .from('hydi_events')
      .insert([event])
      .select();
    
    if (error) {
      throw new Error(`Cold start failed: ${error.message}`);
    }
    
    const totalTime = Date.now() - startTime;
    
    return {
      success: true,
      message: 'Cold start test completed',
      details: {
        cold_start_time_ms: totalTime,
        event_id: data[0]?.event_id,
        processing_time_ms: totalTime
      }
    };
  }

  async benchmarkWarmThroughput() {
    const iterations = 1000;
    const events = [];
    
    // Warm up connection
    await this.supabase
      .from('hydi_events')
      .select('count')
      .limit(1);
    
    const startTime = Date.now();
    
    // Process events with warm connection
    for (let i = 0; i < iterations; i++) {
      const event = this.validator.createEvent('warm_test', {
        index: i,
        timestamp: Date.now()
      });
      
      const { data, error } = await this.supabase
        .from('hydi_events')
        .insert([event])
        .select();
      
      if (error) {
        throw new Error(`Warm throughput failed: ${error.message}`);
      }
      
      events.push(data[0]);
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;
    
    return {
      success: true,
      message: `Warm throughput test completed`,
      details: {
        avg_time_ms: avgTime.toFixed(3),
        total_time_ms: totalTime,
        events_per_second: Math.round(1000 / avgTime),
        first_event_id: events[0]?.event_id,
        last_event_id: events[events.length - 1]?.event_id
      }
    };
  }

  async benchmarkConcurrentLoad() {
    const concurrency = 50;
    const iterations = 1000;
    const events = [];
    
    // Pre-create events
    for (let i = 0; i < iterations; i++) {
      const event = this.validator.createEvent('concurrent_test', {
        index: i,
        timestamp: Date.now(),
        payload: { data: `test_data_${i}` }
      });
      events.push(event);
    }
    
    const startTime = Date.now();
    
    // Process events concurrently
    const promises = events.map(async (event, index) => {
      return this.supabase
        .from('hydi_events')
        .insert([event])
        .select();
    });
    
    const results = await Promise.allSettled(promises);
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;
    
    const successCount = results.filter(r => !r.error).length;
    
    return {
      success: successCount === iterations,
      message: `Concurrent load test completed`,
      details: {
        concurrency,
        iterations,
        success_count: successCount,
        failed_count: iterations - successCount,
        avg_time_ms: avgTime.toFixed(3),
        total_time_ms: totalTime,
        success_rate: ((successCount / iterations) * 100).toFixed(1) + '%'
      }
    };
  }

  async benchmarkMemoryUsage() {
    const iterations = 5000;
    const events = [];
    
    // Create events in memory
    for (let i = 0; i < iterations; i++) {
      const event = this.validator.createEvent('memory_test', {
        index: i,
        timestamp: Date.now(),
        payload: {
          data: `test_data_${i}`,
          // Add some realistic payload size
          metadata: {
            correlation_id: `mem_${i}`,
            trace_id: `trace_${i}`,
            extra_data: Array(100).fill(`data_${i}`)
          }
        }
      });
      events.push(event);
    }
    
    const memBefore = process.memoryUsage();
    
    // Force garbage collection if needed
    if (memBefore.heapUsed / 1024 / 1024 > 100) {
      if (global.gc) {
        global.gc();
      }
    }
    
    const memAfter = process.memoryUsage();
    
    return {
      success: true,
      message: `Memory usage test completed`,
      memory_before: memBefore,
      memory_after: memAfter,
      events_created: iterations,
      memory_per_event: ((memAfter.heapUsed - memBefore.heapUsed) / iterations),
      details: {
        heap_used_mb: (memAfter.heapUsed / 1024 / 1024).toFixed(2),
        rss_mb: (memAfter.rss / 1000 / 1000).toFixed(2),
        external_mb: (memAfter.external / 1000 / 1000).toFixed(2)
      }
    };
  }

  printBenchmarkReport() {
    console.log('\n=== REALISTIC PERFORMANCE REPORT ===');
    
    const operations = [
      'Event Creation',
      'Database Insert', 
      'Idempotency Check',
      'Cold Start',
      'Warm Throughput',
      'Concurrent Load',
      'Memory Usage'
    ];
    
    console.log('\n--- PERFORMANCE METRICS ---');
    
    for (const op of operations) {
      const result = this.results[op];
      const status = result.success ? 'PASS' : 'FAIL';
      const details = result.details || {};
      
      console.log(`${status}: ${op}`);
      
      if (details.avg_time_ms) {
        console.log(`  Avg Time: ${details.avg_time_ms}ms`);
      }
      
      if (details.events_per_second) {
        console.log(`  Throughput: ${details.events_per_second} events/sec`);
      }
      
      if (details.cold_start_time_ms) {
        console.log(`  Cold Start: ${details.cold_start_time_ms}ms`);
      }
      
      if (details.success_rate) {
        console.log(`  Success Rate: ${details.success_rate}`);
      }
      
      if (details.heap_used_mb) {
        console.log(`  Memory: ${details.heap_used_mb}MB`);
      }
    }
    
    console.log('\n=== REALISTIC REALITY NOTES ===');
    console.log('These benchmarks represent real-world conditions:');
    console.log('- Cold starts include connection pool initialization');
    console.log(' Network latency (Supabase) varies: 50-200ms typical');
    console.log(' Database load affects throughput significantly');
    console.log('- Idempotency checks require round-trip to database');
    console.log('- Memory usage scales with event payload size');
    console.log('Concurrent load limited by database connection pool');
  }
}

// CLI interface
if (require.main === module) {
  const benchmarks = new PerformanceBenchmarks();
  
  const command = process.argv[2] || 'all';
  
  (async () => {
    switch (command) {
      case 'all':
        await benchmarks.runAllBenchmarks();
        break;
        
      case 'event':
        await benchmarks.benchmarkEventCreation();
        break;
        
      case 'database':
        await benchmarks.benchmarkDatabaseInsert();
        break;
        
      case 'idempotency':
        await benchmarks.benchmarkIdempotencyCheck();
        break;
        
      case 'cold':
        await benchmarks.benchmarkColdStart();
        break;
        
      'warm':
        await benchmarks.benchmarkWarmThroughput();
        break;
        
      case 'concurrent':
        await benchmarks.benchmarkConcurrentLoad();
        break;
        
      case 'memory':
        await benchmarks.benchmarkMemoryUsage();
        break;
        
      default:
        console.log('Usage: node performance-benchmarks.js [all|event|database|idempotency|cold|warm|concurrent|memory]');
    }
  })().catch(console.error);
}

module.exports = { PerformanceBenchmarks };
