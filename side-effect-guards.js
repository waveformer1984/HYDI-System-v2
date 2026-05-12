// Side-Effect Guards - Prevent Double-Charge During Replay
require('dotenv').config();
const { EventContractValidator } = require('./event-contracts');

class SideEffectGuards {
  constructor() {
    this.validator = new EventContractValidator();
    this.mode = 'LIVE'; // LIVE or REPLAY
    this.sideEffects = new Map();
    this.idempotencyKeys = new Set();
  }

  setMode(mode) {
    if (!['LIVE', 'REPLAY'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be 'LIVE' or 'REPLAY'`);
    }
    
    this.mode = mode;
    console.log(`Side-effect mode set to: ${mode}`);
  }

  // Register side-effect with idempotency key
  registerSideEffect(type, handler, options = {}) {
    const idempotencyKey = options.idempotencyKey || `${type}_side_effect`;
    
    this.sideEffects.set(type, {
      handler,
      idempotencyKey,
      requiresIdempotency: options.requiresIdempotency !== false,
      description: options.description || `${type} side effect`
    });
    
    console.log(`Registered side effect: ${type} (key: ${idempotencyKey})`);
  }

  // Execute side effect with guards
  async executeSideEffect(event, sideEffectType, payload) {
    const sideEffect = this.sideEffects.get(sideEffectType);
    
    if (!sideEffect) {
      console.log(`No side effect registered for: ${sideEffectType}`);
      return { success: false, error: 'No side effect registered' };
    }
    
    // In REPLAY mode, skip side effects
    if (this.mode === 'REPLAY') {
      console.log(`[REPLAY] Skipping side effect: ${sideEffectType}`);
      return { 
        success: true, 
        skipped: true, 
        mode: 'REPLAY',
        sideEffect: sideEffectType
      };
    }
    
    // In LIVE mode, execute with idempotency guard
    if (sideEffect.requiresIdempotency) {
      const idempotencyKey = this.generateIdempotencyKey(event, sideEffect.idempotencyKey);
      
      // Check if already executed
      if (this.idempotencyKeys.has(idempotencyKey)) {
        console.log(`[LIVE] Side effect already executed: ${sideEffectType}`);
        return { 
          success: true, 
          skipped: true, 
          mode: 'LIVE',
          reason: 'already_executed',
          sideEffect: sideEffectType
        };
      }
      
      // Mark as executed
      this.idempotencyKeys.add(idempotencyKey);
      
      console.log(`[LIVE] Executing side effect: ${sideEffectType}`);
      
      try {
        const result = await sideEffect.handler(event, payload);
        
        return {
          success: true,
          executed: true,
          mode: 'LIVE',
          sideEffect: sideEffectType,
          idempotencyKey,
          result
        };
        
      } catch (error) {
        // Remove from idempotency keys on failure
        this.idempotencyKeys.delete(idempotencyKey);
        
        return {
          success: false,
          mode: 'LIVE',
          sideEffect: sideEffectType,
          error: error.message
        };
      }
      
    } else {
      // Execute without idempotency guard
      console.log(`[LIVE] Executing side effect (no guard): ${sideEffectType}`);
      
      try {
        const result = await sideEffect.handler(event, payload);
        
        return {
          success: true,
          executed: true,
          mode: 'LIVE',
          sideEffect: sideEffectType,
          result
        };
        
      } catch (error) {
        return {
          success: false,
          mode: 'LIVE',
          sideEffect: sideEffectType,
          error: error.message
        };
      }
    }
  }

  generateIdempotencyKey(event, baseKey) {
    const key = `${baseKey}:${event.event_id}:${event.correlation_id || event.event_id}`;
    return key.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  // Execute multiple side effects
  async executeSideEffects(event, sideEffects) {
    const results = [];
    
    for (const [type, payload] of Object.entries(sideEffects)) {
      const result = await this.executeSideEffect(event, type, payload);
      results.push({ type, result });
    }
    
    return results;
  }

  // Clear idempotency keys (for testing or reset)
  clearIdempotencyKeys() {
    this.idempotencyKeys.clear();
    console.log('Idempotency keys cleared');
  }

  // Get current mode and stats
  getStatus() {
    return {
      mode: this.mode,
      registeredSideEffects: this.sideEffects.size,
      idempotencyKeysCount: this.idempotencyKeys.size,
      sideEffects: Array.from(this.sideEffects.entries()).map(([type, config]) => ({
        type,
        idempotencyKey: config.idempotencyKey,
        requiresIdempotency: config.requiresIdempotency,
        description: config.description
      }))
    };
  }

  // Test idempotency
  async testIdempotency() {
    console.log('=== SIDE-EFFECT IDEMPOTENCY TEST ===');
    
    const testEvent = this.validator.createEvent('idempotency_test', {
      message: 'Side effect idempotency test',
      timestamp: Date.now()
    });
    
    if (!testEvent.valid) {
      return { success: false, error: testEvent.errors.join(', ') };
    }
    
    // Register test side effect
    this.registerSideEffect('test_notification', async (event, payload) => {
      console.log(`Sending notification for event: ${event.event_id}`);
      return { notification_sent: true, timestamp: Date.now() };
    }, {
      idempotencyKey: 'test_notification',
      requiresIdempotency: true,
      description: 'Test notification side effect'
    });
    
    // Set to LIVE mode
    this.setMode('LIVE');
    
    // Execute first time
    const result1 = await this.executeSideEffect(testEvent.event, 'test_notification', {
      message: 'Test notification 1'
    });
    
    // Execute second time (should be skipped)
    const result2 = await this.executeSideEffect(testEvent.event, 'test_notification', {
      message: 'Test notification 2'
    });
    
    // Set to REPLAY mode
    this.setMode('REPLAY');
    
    // Execute in REPLAY mode (should be skipped)
    const result3 = await this.executeSideEffect(testEvent.event, 'test_notification', {
      message: 'Test notification 3'
    });
    
    // Results
    const success = result1.success && result1.executed && 
                   result2.success && result2.skipped && 
                   result3.success && result3.skipped;
    
    console.log(`Idempotency test: ${success ? 'PASSED' : 'FAILED'}`);
    console.log(`First execution: ${result1.executed ? 'executed' : 'skipped'}`);
    console.log(`Second execution: ${result2.skipped ? 'skipped' : 'executed'}`);
    console.log(`Replay execution: ${result3.skipped ? 'skipped' : 'executed'}`);
    
    return {
      success,
      results: [result1, result2, result3]
    };
  }
}

// Default side effects
const defaultSideEffects = {
  'slack_notification': async (event, payload) => {
    console.log(`[SLACK] Sending notification: ${payload.message}`);
    // In real implementation, this would call Slack API
    return { slack_sent: true, timestamp: Date.now() };
  },
  
  'email_notification': async (event, payload) => {
    console.log(`[EMAIL] Sending email: ${payload.subject}`);
    // In real implementation, this would call email service
    return { email_sent: true, timestamp: Date.now() };
  },
  
  'stripe_charge': async (event, payload) => {
    console.log(`[STRIPE] Processing charge: $${payload.amount}`);
    // In real implementation, this would call Stripe API
    return { charge_processed: true, charge_id: 'ch_' + Date.now(), timestamp: Date.now() };
  },
  
  'webhook_call': async (event, payload) => {
    console.log(`[WEBHOOK] Calling webhook: ${payload.url}`);
    // In real implementation, this would make HTTP request
    return { webhook_sent: true, timestamp: Date.now() };
  }
};

// CLI interface
if (require.main === module) {
  const guards = new SideEffectGuards();
  
  // Register default side effects
  Object.entries(defaultSideEffects).forEach(([type, handler]) => {
    guards.registerSideEffect(type, handler, {
      idempotencyKey: `${type}_idempotency`,
      requiresIdempotency: true,
      description: `${type} side effect`
    });
  });
  
  const command = process.argv[2] || 'status';
  
  (async () => {
    switch (command) {
      case 'test':
        await guards.testIdempotency();
        break;
        
      case 'status':
        console.log(JSON.stringify(guards.getStatus(), null, 2));
        break;
        
      case 'clear':
        guards.clearIdempotencyKeys();
        break;
        
      case 'live':
        guards.setMode('LIVE');
        break;
        
      case 'replay':
        guards.setMode('REPLAY');
        break;
        
      default:
        console.log('Usage: node side-effect-guards.js [test|status|clear|live|replay]');
    }
  })().catch(console.error);
}

module.exports = { SideEffectGuards, defaultSideEffects };
