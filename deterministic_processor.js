// DETERMINISTIC PROCESSOR - ELIMINATE ALL HIDDEN ENTROPY
// No more timing-sensitive operations, randomness, or unstable inputs

class DeterministicProcessor {
  constructor() {
    this.processingCache = new Map();
    this.determinismSeeds = new Map();
  }

  // =============================================================================
  // STEP 2.1: REMOVE TIME FROM LOGIC
  // =============================================================================
  
  getLogicalTime(event) {
    // WRONG: Date.now()
    // RIGHT: event.logical_timestamp
    return event.logical_timestamp || event.decision_time || 0;
  }

  getCurrentTimestamp(event) {
    // WRONG: new Date()
    // RIGHT: event logical time
    return this.getLogicalTime(event);
  }

  // =============================================================================
  // STEP 2.2: REMOVE RANDOMNESS
  // =============================================================================
  
  seededRandom(determinismKey) {
    // WRONG: Math.random()
    // RIGHT: seededRandom(event.determinism_key)
    
    if (!this.determinismSeeds.has(determinismKey)) {
      // Generate seed from determinism key
      const seed = this.hashString(determinismKey);
      this.determinismSeeds.set(determinismKey, seed);
    }
    
    const seed = this.determinismSeeds.get(determinismKey);
    return this.seededRandomAlgorithm(seed);
  }

  seededRandomAlgorithm(seed) {
    // Simple seeded random algorithm (LCG)
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    
    return ((a * seed + c) % m) / m;
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // =============================================================================
  // STEP 2.3: CANONICALIZE INPUTS BEFORE HASHING
  // =============================================================================
  
  canonicalize(obj) {
    // WRONG: hash(obj) - unstable
    // RIGHT: hash(canonicalize(obj))
    
    if (obj === null || obj === undefined) {
      return 'null';
    }
    
    if (typeof obj !== 'object') {
      return String(obj);
    }
    
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalize(item)).join(',') + ']';
    }
    
    // Sort keys for consistent ordering
    const sortedKeys = Object.keys(obj).sort();
    const canonicalObj = {};
    
    sortedKeys.forEach(key => {
      canonicalObj[key] = this.canonicalize(obj[key]);
    });
    
    return JSON.stringify(canonicalObj);
  }

  stableHash(input) {
    // WRONG: unstableHash(input)
    // RIGHT: stableHash(canonicalize(input))
    
    const canonical = this.canonicalize(input);
    return this.hashString(canonical);
  }

  // =============================================================================
  // STEP 2.4: FREEZE EXECUTION INPUTS
  // =============================================================================
  
  freezeInputs(event, systemSnapshot) {
    // Prevent mutation during processing
    const frozenEvent = Object.freeze({
      ...event,
      payload: Object.freeze(event.payload || {})
    });
    
    const frozenSnapshot = Object.freeze({
      ...systemSnapshot,
      data: Object.freeze(systemSnapshot.data || {})
    });
    
    return { frozenEvent, frozenSnapshot };
  }

  // =============================================================================
  // STEP 2.5: DETERMINISTIC PROCESSING
  // =============================================================================
  
  async processEventDeterministic(event, systemSnapshot) {
    // Freeze inputs to prevent mutation
    const { frozenEvent, frozenSnapshot } = this.freezeInputs(event, systemSnapshot);
    
    // Generate processing hash
    const processingHash = this.generateProcessingHash(frozenEvent, frozenSnapshot);
    
    // Check cache for existing result
    if (this.processingCache.has(processingHash)) {
      return this.processingCache.get(processingHash);
    }
    
    // Process deterministically
    const result = await this.executeDeterministicProcessing(frozenEvent, frozenSnapshot);
    
    // Cache result
    this.processingCache.set(processingHash, result);
    
    return result;
  }

  generateProcessingHash(event, systemSnapshot) {
    const processingInput = {
      event_id: event.event_id,
      event_type: event.event_type,
      logical_timestamp: this.getLogicalTime(event),
      determinism_key: event.determinism_key,
      payload: this.canonicalize(event.payload),
      system_state: this.canonicalize(systemSnapshot),
      processing_version: '5.0.0'
    };
    
    return this.stableHash(processingInput);
  }

  async executeDeterministicProcessing(event, systemSnapshot) {
    // Use logical time instead of real time
    const processingTime = this.getLogicalTime(event);
    
    // Use seeded random instead of Math.random()
    const randomValue = this.seededRandom(event.determinism_key);
    
    // Process based on event type
    switch (event.event_type) {
      case 'CAUSAL':
        return await this.processCausalEventDeterministic(event, systemSnapshot, processingTime, randomValue);
      case 'DERIVED':
        return await this.processDerivedEventDeterministic(event, systemSnapshot, processingTime, randomValue);
      case 'EXTERNAL':
        return await this.processExternalEventDeterministic(event, systemSnapshot, processingTime, randomValue);
      default:
        throw new Error(`Unknown event type: ${event.event_type}`);
    }
  }

  async processCausalEventDeterministic(event, systemSnapshot, processingTime, randomValue) {
    const result = {
      event_id: event.event_id,
      processing_time: processingTime,
      processing_hash: this.generateProcessingHash(event, systemSnapshot),
      state_changes: [],
      side_effects: [],
      deterministic: true
    };
    
    // Process payload deterministically
    if (event.payload?.operation) {
      const stateChange = this.processOperationDeterministic(
        event.payload.operation,
        event.payload,
        processingTime,
        randomValue
      );
      
      result.state_changes.push(stateChange);
    }
    
    return result;
  }

  processOperationDeterministic(operation, payload, processingTime, randomValue) {
    // All operations must be deterministic
    switch (operation) {
      case 'create_run':
        return {
          type: 'run_created',
          run_id: payload.run_id || this.generateDeterministicId(payload, processingTime),
          name: payload.name,
          status: payload.status || 'running',
          created_at: processingTime
        };
        
      case 'update_status':
        return {
          type: 'status_updated',
          target_id: payload.target_id,
          old_status: payload.old_status,
          new_status: payload.new_status,
          updated_at: processingTime
        };
        
      default:
        return {
          type: 'unknown_operation',
          operation: operation,
          processed_at: processingTime
        };
    }
  }

  generateDeterministicId(payload, processingTime) {
    // Generate ID deterministically from payload and time
    const idInput = {
      payload: this.canonicalize(payload),
      time: processingTime
    };
    
    const idHash = this.stableHash(idInput);
    return `deterministic_${idHash}`;
  }

  async processDerivedEventDeterministic(event, systemSnapshot, processingTime, randomValue) {
    // Derived events are pure functions - no state mutation
    return {
      event_id: event.event_id,
      processing_time: processingTime,
      processing_hash: this.generateProcessingHash(event, systemSnapshot),
      derivation_result: this.computeDerivationDeterministic(event.payload, systemSnapshot),
      deterministic: true
    };
  }

  computeDerivationDeterministic(payload, systemSnapshot) {
    // Pure function computation
    return {
      derived_value: payload.value * 2, // Deterministic computation
      derived_at: this.getLogicalTime({ logical_timestamp: payload.timestamp }),
      derivation_type: payload.derivation_type
    };
  }

  async processExternalEventDeterministic(event, systemSnapshot, processingTime, randomValue) {
    // External events must be normalized deterministically
    return {
      event_id: event.event_id,
      processing_time: processingTime,
      processing_hash: this.generateProcessingHash(event, systemSnapshot),
      normalized_payload: this.normalizeExternalEventDeterministic(event.payload),
      deterministic: true
    };
  }

  normalizeExternalEventDeterministic(payload) {
    // Deterministic normalization
    return {
      original_source: payload.external_source,
      normalized_type: payload.external_event_type,
      normalized_data: this.canonicalize(payload.external_data),
      normalized_at: this.getLogicalTime({ logical_timestamp: payload.timestamp })
    };
  }

  // =============================================================================
  // STEP 2.6: DETERMINISM TORTURE TEST
  // =============================================================================
  
  async runDeterminismTortureTest(event, systemSnapshot, iterations = 1000) {
    console.log(`🔥 Running determinism torture test: ${iterations} iterations`);
    
    const results = [];
    const hashes = new Set();
    let allIdentical = true;
    
    for (let i = 0; i < iterations; i++) {
      // Simulate different conditions
      const delay = Math.random() * 10; // Random delay
      await this.sleep(delay);
      
      // CPU throttling simulation
      if (i % 100 === 0) {
        // Simulate CPU load
        const start = Date.now();
        while (Date.now() - start < 5) {
          // Busy wait to simulate CPU load
        }
      }
      
      // Process event
      const result = await this.processEventDeterministic(event, systemSnapshot);
      const hash = result.processing_hash;
      
      results.push(result);
      hashes.add(hash);
      
      // Check for divergence
      if (hashes.size > 1) {
        allIdentical = false;
        console.log(`❌ Divergence detected at iteration ${i}: ${hashes.size} different hashes`);
        break;
      }
    }
    
    return {
      iterations: iterations,
      allIdentical: allIdentical,
      uniqueHashes: hashes.size,
      firstHash: hashes.size > 0 ? Array.from(hashes)[0] : null,
      passed: allIdentical && hashes.size === 1
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =============================================================================
  // VALIDATION TESTS
  // =============================================================================
  
  async testDeterministicProcessing() {
    console.log('🔄 Testing Deterministic Processing');
    
    const testEvent = {
      event_id: 'test-event-123',
      event_type: 'CAUSAL',
      determinism_key: 'test-determinism-key',
      logical_clock: 1,
      decision_time: 1000000,
      payload: {
        operation: 'create_run',
        run_id: 'test-run-456',
        name: 'Test Run',
        status: 'running'
      }
    };
    
    const systemSnapshot = {
      runs: {},
      timestamp: 1000000
    };
    
    // Test 1: Multiple processing attempts should be identical
    console.log('  Test 1: Multiple processing attempts...');
    const result1 = await this.processEventDeterministic(testEvent, systemSnapshot);
    await this.sleep(10); // Small delay
    const result2 = await this.processEventDeterministic(testEvent, systemSnapshot);
    
    const identicalResults = result1.processing_hash === result2.processing_hash;
    console.log(`    Results identical: ${identicalResults ? '✅' : '❌'}`);
    
    // Test 2: Torture test
    console.log('  Test 2: Determinism torture test...');
    const tortureResult = await this.runDeterminismTortureTest(testEvent, systemSnapshot, 100);
    
    console.log(`    Torture test passed: ${tortureResult.passed ? '✅' : '❌'}`);
    console.log(`    Unique hashes: ${tortureResult.uniqueHashes}`);
    
    // Test 3: Input canonicalization
    console.log('  Test 3: Input canonicalization...');
    const input1 = { b: 2, a: 1 };
    const input2 = { a: 1, b: 2 };
    
    const hash1 = this.stableHash(input1);
    const hash2 = this.stableHash(input2);
    
    const canonicalizationWorks = hash1 === hash2;
    console.log(`    Canonicalization works: ${canonicalizationWorks ? '✅' : '❌'}`);
    
    return {
      multipleAttempts: identicalResults,
      tortureTest: tortureResult.passed,
      canonicalization: canonicalizationWorks,
      overall: identicalResults && tortureResult.passed && canonicalizationWorks
    };
  }
}

// Test the deterministic processor
if (require.main === module) {
  async function testDeterministicProcessor() {
    const processor = new DeterministicProcessor();
    
    console.log('🧪 Testing Deterministic Processor');
    console.log('==================================');
    
    const results = await processor.testDeterministicProcessing();
    
    console.log('\n📊 Test Results:');
    console.log(`  Multiple attempts: ${results.multipleAttempts ? '✅' : '❌'}`);
    console.log(`  Torture test: ${results.tortureTest ? '✅' : '❌'}`);
    console.log(`  Canonicalization: ${results.canonicalization ? '✅' : '❌'}`);
    console.log(`  Overall: ${results.overall ? '✅' : '❌'}`);
    
    if (results.overall) {
      console.log('\n✅ Deterministic processing is working');
    } else {
      console.log('\n❌ Deterministic processing needs work');
    }
  }
  
  testDeterministicProcessor().catch(console.error);
}

module.exports = DeterministicProcessor;
