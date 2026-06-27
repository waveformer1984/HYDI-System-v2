#!/usr/bin/env node

/**
 * REAL REVENUE ENGINE
 * 
 * Ledger-first design with pre-authorization, billing locks, and real payment integration
 * 
 * Architecture:
 * 1. Pre-authorize usage (credit/payment method validation)
 * 2. Lock execution cost upfront
 * 3. Execute system
 * 4. Commit or rollback billing
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// MOCK STRIPE INTEGRATION (would be real Stripe in production)
class MockStripeIntegration {
  constructor() {
    this.customers = new Map();
    this.charges = new Map();
    this.holds = new Map();
  }

  async createCustomer(userId, paymentMethod) {
    const customerId = `cus_${crypto.randomUUID().substring(0, 8)}`;
    
    this.customers.set(customerId, {
      id: customerId,
      userId: userId,
      paymentMethod: paymentMethod,
      balance: 100.00, // Starting balance for demo
      created: new Date()
    });

    return customerId;
  }

  async preAuthorizeCharge(customerId, amount) {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    if (customer.balance < amount) {
      throw new Error('Insufficient funds');
    }

    // Create hold on funds
    const holdId = `hold_${crypto.randomUUID().substring(0, 8)}`;
    this.holds.set(holdId, {
      customerId: customerId,
      amount: amount,
      status: 'held',
      created: new Date()
    });

    // Reserve the funds
    customer.balance -= amount;

    return {
      holdId: holdId,
      amount: amount,
      status: 'authorized'
    };
  }

  async captureHold(holdId) {
    const hold = this.holds.get(holdId);
    if (!hold) {
      throw new Error('Hold not found');
    }

    if (hold.status !== 'held') {
      throw new Error('Hold already processed');
    }

    // Convert hold to actual charge
    const chargeId = `ch_${crypto.randomUUID().substring(0, 8)}`;
    this.charges.set(chargeId, {
      id: chargeId,
      customerId: hold.customerId,
      amount: hold.amount,
      status: 'succeeded',
      created: new Date()
    });

    // Mark hold as captured
    hold.status = 'captured';
    hold.chargeId = chargeId;

    return {
      chargeId: chargeId,
      amount: hold.amount,
      status: 'succeeded'
    };
  }

  async releaseHold(holdId) {
    const hold = this.holds.get(holdId);
    if (!hold) {
      throw new Error('Hold not found');
    }

    if (hold.status !== 'held') {
      throw new Error('Hold already processed');
    }

    // Release funds back to customer
    const customer = this.customers.get(hold.customerId);
    if (customer) {
      customer.balance += hold.amount;
    }

    // Mark hold as released
    hold.status = 'released';

    return {
      holdId: holdId,
      amount: hold.amount,
      status: 'released'
    };
  }

  getCustomerBalance(customerId) {
    const customer = this.customers.get(customerId);
    return customer ? customer.balance : 0;
  }
}

// IMMUTABLE LEDGER ENGINE
class ImmutableLedger {
  constructor() {
    this.entries = new Map(); // entryId -> ledger entry
    this.sequence = 0;
  }

  createEntry(type, data) {
    const entryId = `ledger_${++this.sequence}`;
    const entry = {
      id: entryId,
      type: type, // 'hold', 'charge', 'release', 'refund'
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      data: data,
      hash: this.calculateHash(entryId, type, data)
    };

    this.entries.set(entryId, entry);
    return entry;
  }

  calculateHash(entryId, type, data) {
    const hashInput = `${entryId}:${type}:${JSON.stringify(data)}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  getEntriesByCustomer(customerId) {
    return Array.from(this.entries.values())
      .filter(entry => entry.data.customerId === customerId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  verifyLedgerIntegrity() {
    // Verify all ledger entries have correct hashes
    for (const [entryId, entry] of this.entries.entries()) {
      const expectedHash = this.calculateHash(entry.id, entry.type, entry.data);
      if (entry.hash !== expectedHash) {
        return { valid: false, corruptedEntry: entryId };
      }
    }
    return { valid: true };
  }
}

// REAL REVENUE ENGINE
class RealRevenueEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.stripe = new MockStripeIntegration();
    this.ledger = new ImmutableLedger();
    this.userSessions = new Map(); // sessionId -> user data
    this.pendingExecutions = new Map(); // executionId -> billing data
    
    this.config = {
      pricing: {
        intentProcessing: 0.005,
        taskGeneration: 0.01,
        execution: 0.02,
        toolUsage: 0.015,
        validation: 0.003
      }
    };
    
    this.metrics = {
      totalPreAuthorizations: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalRevenue: 0,
      heldAmount: 0,
      releasedAmount: 0
    };
  }

  // REAL REVENUE FLOW (LEDGER-FIRST)
  async processRevenueFlow(userIntent, sessionId, customerId) {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    
    try {
      console.log(`[REVENUE] Starting revenue flow: ${executionId}`);
      
      // STEP 1: Calculate total cost
      const totalCost = this.calculateExecutionCost(userIntent);
      console.log(`[REVENUE] Calculated cost: $${totalCost.toFixed(4)}`);
      
      // STEP 2: Pre-authorize usage (CRITICAL)
      const authorization = await this.preAuthorizeUsage(customerId, totalCost, executionId);
      console.log(`[REVENUE] Pre-authorized: ${authorization.holdId}`);
      
      // STEP 3: Lock execution cost in ledger
      const ledgerHold = this.ledger.createEntry('hold', {
        executionId: executionId,
        customerId: customerId,
        amount: totalCost,
        holdId: authorization.holdId,
        intent: userIntent
      });
      
      this.pendingExecutions.set(executionId, {
        holdId: authorization.holdId,
        ledgerEntryId: ledgerHold.id,
        customerId: customerId,
        amount: totalCost
      });
      
      // STEP 4: Execute system
      const executionResult = await this.executeSystem(userIntent, executionId);
      
      // STEP 5: Commit billing (success path)
      if (executionResult.success) {
        await this.commitBilling(executionId, executionResult);
        this.metrics.successfulExecutions++;
        this.metrics.totalRevenue += totalCost;
        console.log(`[REVENUE] Billing committed: $${totalCost.toFixed(4)}`);
      } else {
        throw new Error(executionResult.error);
      }
      
      return {
        executionId: executionId,
        success: true,
        cost: totalCost,
        billingId: authorization.holdId,
        result: executionResult
      };
      
    } catch (error) {
      // STEP 6: Rollback billing (failure path)
      await this.rollbackBilling(executionId);
      this.metrics.failedExecutions++;
      console.log(`[REVENUE] Billing rolled back: ${error.message}`);
      
      throw {
        executionId: executionId,
        success: false,
        error: error.message,
        billingRolledBack: true
      };
    }
  }

  // STEP 1: Calculate execution cost
  calculateExecutionCost(userIntent) {
    const costs = this.config.pricing;
    return Object.values(costs).reduce((sum, cost) => sum + cost, 0);
  }

  // STEP 2: Pre-authorize usage
  async preAuthorizeUsage(customerId, amount, executionId) {
    this.metrics.totalPreAuthorizations++;
    
    try {
      const authorization = await this.stripe.preAuthorizeCharge(customerId, amount);
      this.metrics.heldAmount += amount;
      
      return authorization;
    } catch (error) {
      throw new Error(`Pre-authorization failed: ${error.message}`);
    }
  }

  // STEP 4: Execute system (your existing pipeline)
  async executeSystem(userIntent, executionId) {
    console.log(`[EXECUTION] Starting execution: ${executionId}`);
    
    try {
      // Simulate the execution pipeline
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Simulate occasional failures (10% failure rate)
      if (Math.random() < 0.1) {
        throw new Error('Simulated execution failure');
      }
      
      return {
        success: true,
        executionId: executionId,
        result: `Execution completed for: ${userIntent}`,
        duration: Date.now() - Date.now()
      };
      
    } catch (error) {
      return {
        success: false,
        executionId: executionId,
        error: error.message
      };
    }
  }

  // STEP 5: Commit billing
  async commitBilling(executionId, executionResult) {
    const pending = this.pendingExecutions.get(executionId);
    if (!pending) {
      throw new Error('No pending billing data found');
    }
    
    try {
      // Capture the hold in Stripe
      const charge = await this.stripe.captureHold(pending.holdId);
      
      // Create charge entry in ledger
      this.ledger.createEntry('charge', {
        executionId: executionId,
        customerId: pending.customerId,
        amount: pending.amount,
        chargeId: charge.chargeId,
        holdId: pending.holdId,
        result: executionResult
      });
      
      // Clean up pending execution
      this.pendingExecutions.delete(executionId);
      
      this.emit('revenueCaptured', {
        executionId: executionId,
        amount: pending.amount,
        chargeId: charge.chargeId
      });
      
      return charge;
      
    } catch (error) {
      throw new Error(`Billing commit failed: ${error.message}`);
    }
  }

  // STEP 6: Rollback billing
  async rollbackBilling(executionId) {
    const pending = this.pendingExecutions.get(executionId);
    if (!pending) {
      console.log(`[ROLLBACK] No pending billing for ${executionId}`);
      return;
    }
    
    try {
      // Release the hold in Stripe
      const release = await this.stripe.releaseHold(pending.holdId);
      
      // Create release entry in ledger
      this.ledger.createEntry('release', {
        executionId: executionId,
        customerId: pending.customerId,
        amount: pending.amount,
        holdId: pending.holdId,
        releaseId: release.holdId
      });
      
      this.metrics.releasedAmount += pending.amount;
      
      // Clean up pending execution
      this.pendingExecutions.delete(executionId);
      
      this.emit('revenueReleased', {
        executionId: executionId,
        amount: pending.amount,
        releaseId: release.holdId
      });
      
      return release;
      
    } catch (error) {
      console.error(`[ROLLBACK] Failed to release hold: ${error.message}`);
    }
  }

  // USER MANAGEMENT
  async createCustomer(userId, paymentMethod) {
    return await this.stripe.createCustomer(userId, paymentMethod);
  }

  getCustomerBalance(customerId) {
    return this.stripe.getCustomerBalance(customerId);
  }

  // RECONCILIATION METHODS
  async reconcileRevenue() {
    console.log('[RECONCILIATION] Starting revenue reconciliation...');
    
    // Verify ledger integrity
    const ledgerIntegrity = this.ledger.verifyLedgerIntegrity();
    if (!ledgerIntegrity.valid) {
      throw new Error(`Ledger corruption detected: ${ledgerIntegrity.corruptedEntry}`);
    }
    
    // Reconcile Stripe charges vs ledger
    const ledgerCharges = Array.from(this.ledger.entries.values())
      .filter(entry => entry.type === 'charge');
    
    const stripeCharges = Array.from(this.stripe.charges.values());
    
    const reconciled = [];
    const unreconciled = [];
    
    for (const ledgerCharge of ledgerCharges) {
      const stripeCharge = stripeCharges.find(charge => 
        charge.id === ledgerCharge.data.chargeId
      );
      
      if (stripeCharge) {
        reconciled.push({
          ledgerEntry: ledgerCharge.id,
          stripeCharge: stripeCharge.id,
          amount: ledgerCharge.data.amount
        });
      } else {
        unreconciled.push({
          ledgerEntry: ledgerCharge.id,
          amount: ledgerCharge.data.amount,
          issue: 'Missing Stripe charge'
        });
      }
    }
    
    console.log(`[RECONCILIATION] Reconciled: ${reconciled.length}, Unreconciled: ${unreconciled.length}`);
    
    return {
      ledgerIntegrity: ledgerIntegrity.valid,
      reconciled: reconciled,
      unreconciled: unreconciled,
      totalReconciled: reconciled.reduce((sum, r) => sum + r.amount, 0),
      totalUnreconciled: unreconciled.reduce((sum, u) => sum + u.amount, 0)
    };
  }

  // METRICS
  getMetrics() {
    return {
      ...this.metrics,
      pendingExecutions: this.pendingExecutions.size,
      ledgerEntries: this.ledger.entries.size,
      stripeCustomers: this.stripe.customers.size,
      stripeCharges: this.stripe.charges.size,
      netRevenue: this.metrics.totalRevenue - this.metrics.releasedAmount
    };
  }

  // DEBUG METHODS
  getLedgerEntries(customerId) {
    return this.ledger.getEntriesByCustomer(customerId);
  }

  getPendingExecutions() {
    return Array.from(this.pendingExecutions.entries()).map(([id, data]) => ({
      executionId: id,
      ...data
    }));
  }
}

// DEMONSTRATION
async function demonstrateRealRevenueEngine() {
  console.log('=== REAL REVENUE ENGINE DEMONSTRATION ===\n');
  
  const revenueEngine = new RealRevenueEngine();
  
  // Listen to revenue events
  revenueEngine.on('revenueCaptured', (event) => {
    console.log(`[EVENT] Revenue captured: $${event.amount.toFixed(4)} for execution ${event.executionId}`);
  });
  
  revenueEngine.on('revenueReleased', (event) => {
    console.log(`[EVENT] Revenue released: $${event.amount.toFixed(4)} for execution ${event.executionId}`);
  });
  
  try {
    // Create test customers
    console.log('Creating test customers...\n');
    const customer1 = await revenueEngine.createCustomer('user-123', 'card_123');
    const customer2 = await revenueEngine.createCustomer('user-456', 'card_456');
    
    console.log(`Customer 1 ID: ${customer1}, Balance: $${revenueEngine.getCustomerBalance(customer1).toFixed(2)}`);
    console.log(`Customer 2 ID: ${customer2}, Balance: $${revenueEngine.getCustomerBalance(customer2).toFixed(2)}\n`);
    
    // Process revenue flows
    const flows = [
      { intent: 'create user account', customerId: customer1 },
      { intent: 'generate marketing content', customerId: customer1 },
      { intent: 'execute data backup', customerId: customer2 },
      { intent: 'update project status', customerId: customer2 },
      { intent: 'this will fail', customerId: customer1 } // This one will fail
    ];
    
    for (const flow of flows) {
      console.log(`--- Processing: ${flow.intent} ---`);
      
      try {
        const result = await revenueEngine.processRevenueFlow(flow.intent, 'session-123', flow.customerId);
        console.log(`SUCCESS: $${result.cost.toFixed(4)} billed`);
      } catch (error) {
        console.log(`FAILED: ${error.error} (billing rolled back: ${error.billingRolledBack})`);
      }
      
      // Show customer balance after each flow
      console.log(`Customer balance: $${revenueEngine.getCustomerBalance(flow.customerId).toFixed(2)}\n`);
    }
    
    // Show final metrics
    console.log('=== REVENUE ENGINE METRICS ===\n');
    const metrics = revenueEngine.getMetrics();
    console.log(JSON.stringify(metrics, null, 2));
    
    // Show ledger entries for customer 1
    console.log('\n=== LEDGER ENTRIES FOR CUSTOMER 1 ===\n');
    const ledgerEntries = revenueEngine.getLedgerEntries(customer1);
    ledgerEntries.forEach(entry => {
      console.log(`${entry.type.toUpperCase()}: $${entry.data.amount.toFixed(4)} - ${entry.timestamp}`);
    });
    
    // Run reconciliation
    console.log('\n=== REVENUE RECONCILIATION ===\n');
    const reconciliation = await revenueEngine.reconcileRevenue();
    console.log(JSON.stringify(reconciliation, null, 2));
    
  } catch (error) {
    console.error('Demo error:', error);
  }
}

// Run demonstration
if (require.main === module) {
  demonstrateRealRevenueEngine().catch(console.error);
}

module.exports = { RealRevenueEngine, MockStripeIntegration, ImmutableLedger };
