// CHAOS WRITER WORKER - CONCURRENT EVENT GENERATION
// Simulates multiple writers with chaos conditions

const { workerData, parentPort } = require('worker_threads');
const { v4: uuidv4 } = require('uuid');

class ChaosWriter {
  constructor(writerId, chaosConditions) {
    this.writerId = writerId;
    this.chaosConditions = chaosConditions;
    this.metrics = {
      eventsGenerated: 0,
      eventsProcessed: 0,
      errors: 0,
      startTime: null
    };
    this.isRunning = false;
  }

  async start(endTime) {
    this.isRunning = true;
    this.metrics.startTime = Date.now();
    
    console.log(`Writer ${this.writerId} started`);
    
    // Generate events until endTime
    while (this.isRunning && Date.now() < endTime) {
      try {
        await this.generateEvent();
        this.metrics.eventsGenerated++;
        
        // Random delay based on chaos conditions
        const delay = Math.random() * this.chaosConditions.eventDelayRange.max;
        await this.sleep(delay);
        
      } catch (error) {
        this.metrics.errors++;
        console.log(`Writer ${this.writerId} error: ${error.message}`);
      }
    }
    
    // Send final metrics
    parentPort.postMessage({
      type: 'metrics',
      writerId: this.writerId,
      ...this.metrics
    });
    
    console.log(`Writer ${this.writerId} stopped`);
  }

  async generateEvent() {
    // Generate event with chaos conditions
    const event = {
      event_id: uuidv4(),
      writer_id: this.writerId,
      event_type: Math.random() > 0.3 ? 'CAUSAL' : 'EXTERNAL',
      determinism_key: `writer-${this.writerId}-${Date.now()}-${Math.random()}`,
      logical_clock: Date.now(),
      decision_time: Date.now(),
      payload: {
        operation: 'chaos_write',
        writer_id: this.writerId,
        value: Math.random() * 1000,
        timestamp: Date.now(),
        chaos_applied: true
      }
    };
    
    // Simulate processing with chaos
    await this.processEventWithChaos(event);
    this.metrics.eventsProcessed++;
  }

  async processEventWithChaos(event) {
    // Simulate network jitter
    if (this.chaosConditions.networkJitter) {
      const jitterDelay = Math.random() * 50;
      await this.sleep(jitterDelay);
    }
    
    // Simulate processing
    const processingTime = Math.random() * 10;
    await this.sleep(processingTime);
    
    // Randomly fail (simulate chaos)
    if (Math.random() < 0.001) { // 0.1% failure rate
      throw new Error(`Chaos failure in writer ${this.writerId}`);
    }
    
    // Send event to parent
    parentPort.postMessage({
      type: 'event',
      writerId: this.writerId,
      event: event
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
  }
}

// Handle worker messages
if (parentPort) {
  const writer = new ChaosWriter(workerData.writerId, workerData.chaosConditions);
  
  parentPort.on('message', (message) => {
    if (message.type === 'start') {
      writer.start(message.endTime);
    } else if (message.type === 'stop') {
      writer.stop();
    }
  });
}
