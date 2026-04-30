// SIMPLE HARNESS TEST - Validate basic functionality
const { v4: uuidv4 } = require('uuid');

class SimpleHarnessTest {
  constructor() {
    this.eventSpine = [];
    this.systemState = {
      chaosRuns: new Map(),
      chaosRunInstances: new Map(),
      externalState: new Map()
    };
    
    this.metrics = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0
    };
  }

  async runSimpleTest() {
    console.log('🧪 SIMPLE HARNESS TEST');
    console.log('=====================');
    console.log('Validating basic test harness functionality\n');
    
    try {
      // Test 1: Basic event submission
      await this.testBasicEventSubmission();
      
      // Test 2: Event processing
      await this.testEventProcessing();
      
      // Test 3: State consistency
      await this.testStateConsistency();
      
      console.log('\n✅ SIMPLE HARNESS TEST PASSED');
      console.log('Basic test harness functionality validated');
      
    } catch (error) {
      console.log('\n❌ SIMPLE HARNESS TEST FAILED');
      console.log('Basic test harness has issues:', error.message);
    }
  }

  async testBasicEventSubmission() {
    console.log('🚀 Test 1 — Basic Event Submission');
    
    const eventId = this.submitEvent('CAUSAL', 'SYSTEM', { test: 'basic_submission' });
    
    if (eventId && this.eventSpine.length === 1) {
      console.log('  ✅ Event submission successful');
    } else {
      throw new Error('Event submission failed');
    }
  }

  async testEventProcessing() {
    console.log('\n⚡ Test 2 — Event Processing');
    
    const eventId = this.submitEvent('CAUSAL', 'SYSTEM', { test: 'event_processing' });
    const processedEvent = await this.processEvent(eventId);
    
    if (processedEvent && processedEvent.processing_status === 'committed') {
      console.log('  ✅ Event processing successful');
    } else {
      throw new Error('Event processing failed');
    }
  }

  async testStateConsistency() {
    console.log('\n🎯 Test 3 — State Consistency');
    
    const runId = uuidv4();
    const eventId = this.submitEvent('CAUSAL', 'SYSTEM', { 
      operation: 'create_run',
      run_id: runId,
      name: 'Test_Run'
    });
    
    await this.processEvent(eventId);
    
    if (this.systemState.chaosRuns.has(runId)) {
      console.log('  ✅ State consistency maintained');
    } else {
      throw new Error('State consistency failed');
    }
  }

  submitEvent(eventType, agent, payload) {
    const eventId = uuidv4();
    const event = {
      id: this.eventSpine.length,
      event_id: eventId,
      event_type: eventType,
      agent: agent,
      payload: payload,
      decision_time: new Date(),
      processing_status: 'pending',
      created_at: new Date()
    };
    
    this.eventSpine.push(event);
    this.metrics.totalEvents++;
    
    return eventId;
  }

  async processEvent(eventId) {
    const event = this.eventSpine.find(e => e.event_id === eventId);
    if (!event) return null;
    
    event.processing_status = 'processing';
    
    try {
      // Process based on type
      if (event.event_type === 'CAUSAL') {
        await this.processCausalEvent(event);
      }
      
      event.processing_status = 'committed';
      event.commit_time = new Date();
      this.metrics.processedEvents++;
      
      return event;
      
    } catch (error) {
      event.processing_status = 'failed';
      event.last_error = error.message;
      this.metrics.failedEvents++;
      throw error;
    }
  }

  async processCausalEvent(event) {
    // Process causal event
    if (event.payload?.operation === 'create_run') {
      const runId = event.payload.run_id;
      this.systemState.chaosRuns.set(runId, {
        id: runId,
        name: event.payload.name,
        status: 'running',
        created_at: new Date()
      });
    }
  }
}

// Run the simple test
const tester = new SimpleHarnessTest();
tester.runSimpleTest().catch(console.error);
