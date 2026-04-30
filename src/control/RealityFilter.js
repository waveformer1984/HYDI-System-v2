/**
 * CASCADE - Reality Filter Layer for ProtoForge
 * 
 * Kills bad tasks before they're born.
 * No warnings. No retries. Just kills.
 */

const { createClient } = require('@supabase/supabase-js');
const { MemoryStore } = require('../memory/MemoryStore.js');

class RealityFilter {
  constructor() {
    // Initialize Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    
    // Initialize memory store
    this.memory = new MemoryStore(this.supabase);
    
    // Rule configurations
    this.rules = {
      leadSourceValidation: {
        minConversionSignal: 1, // At least one conversion
        probationQueueSize: 10, // New sources need 10 leads first
        allowedSources: ['linkedin', 'referral', 'directory', 'cold_email_proven']
      },
      outreachPersonalization: {
        minScore: 0.7,
        requiredElements: ['business_reference', 'pain_point', 'concrete_offer'],
        blockedPatterns: ['dear_friend', 'opportunity_of_lifetime', 'act_now', 'limited_time']
      },
      productDemandValidation: {
        requiredSignals: ['search_volume', 'waitlist', 'competitor_reviews', 'customer_request'],
        minSignalCount: 1
      },
      executionMargin: {
        minMarginPercent: 30,
        blockIfUncalculable: true
      }
    };
  }

  /**
   * Single public method - filters a task through all four rules
   * Returns { approved: true } or { approved: false, reason: string }
   */
  async filter(task) {
    // Rule 1: Lead Source Validation
    if (task.type === 'outreach' || task.type === 'lead_generation') {
      const sourceValidation = await this.validateLeadSource(task.leadSource);
      if (!sourceValidation.passed) {
        return { approved: false, reason: sourceValidation.reason };
      }
    }

    // Rule 2: Outreach Personalization Score
    if (task.type === 'outreach') {
      const personalizationCheck = this.checkPersonalization(task.message);
      if (!personalizationCheck.passed) {
        return { approved: false, reason: personalizationCheck.reason };
      }
    }

    // Rule 3: Product Listing Demand Validation
    if (task.type === 'product_listing') {
      const demandValidation = await this.validateDemand(task.product);
      if (!demandValidation.passed) {
        return { approved: false, reason: demandValidation.reason };
      }
    }

    // Rule 4: Execution Margin Gate
    if (task.type === 'execution' || task.type === 'fulfillment') {
      const marginCheck = this.checkMargin(task);
      if (!marginCheck.passed) {
        return { approved: false, reason: marginCheck.reason };
      }
    }

    // All rules passed
    return { approved: true };
  }

  /**
   * RULE 1: Lead Source Validation
   */
  async validateLeadSource(source) {
    // Check if source is in allowed list
    if (this.rules.leadSourceValidation.allowedSources.includes(source)) {
      return { passed: true };
    }

    // Check for conversion signal
    try {
      const conversions = await this.memory.read('leads', {
        source,
        status: 'replied'
      });
      
      if (conversions && conversions.length > 0) {
        return { passed: true };
      }
    } catch (e) {
      // Table might not exist - continue with other checks
      console.log(`[CASCADE] Lead check failed: ${e.message}`);
    }

    // Check probation queue
    try {
      const probation = await this.memory.read('probation_leads', { source });
      if (probation && probation.length >= this.rules.leadSourceValidation.probationQueueSize) {
        return { passed: true };
      }
    } catch (e) {
      // Table might not exist
      console.log(`[CASCADE] Probation check failed: ${e.message}`);
    }

    // Add to probation queue
    try {
      await this.memory.write('probation_leads', {
        source,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.log(`[CASCADE] Failed to add to probation: ${e.message}`);
    }

    return { 
      passed: false, 
      reason: `Lead source '${source}' lacks conversion signal and is not in probation queue` 
    };
  }

  /**
   * RULE 2: Outreach Personalization Score
   */
  checkPersonalization(message) {
    let score = 0;
    const required = this.rules.outreachPersonalization.requiredElements;

    // Check for blocked patterns
    const hasBlockedPattern = this.rules.outreachPersonalization.blockedPatterns.some(pattern =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
    if (hasBlockedPattern) {
      return { passed: false, reason: 'Message contains blocked sales patterns' };
    }

    // Check for business reference (company name, specific role, etc.)
    if (/\b[A-Z][a-z]+ (Inc|Corp|LLC|Ltd|Company|Startup|Tech)\b|founder|ceo|cto|director/i.test(message)) {
      score += 0.4;
    }

    // Check for pain point (specific problem, challenge, need)
    if (/\b(problem|challenge|issue|struggle|need|require|looking for|trying to)\b/i.test(message)) {
      score += 0.3;
    }

    // Check for concrete offer (specific deliverable, timeline, price)
    if (/\b(deliver|provide|create|build|prototype|print|\$\d+|days|weeks)\b/i.test(message)) {
      score += 0.3;
    }

    if (score < this.rules.outreachPersonalization.minScore) {
      return { 
        passed: false, 
        reason: `Personalization score ${score.toFixed(2)} below threshold ${this.rules.outreachPersonalization.minScore}` 
      };
    }

    return { passed: true };
  }

  /**
   * RULE 3: Product Listing Demand Validation
   */
  async validateDemand(product) {
    // Check for demand signals
    const signals = [];
    
    if (product.searchVolume && product.searchVolume > 100) {
      signals.push('search_volume');
    }
    
    if (product.waitlistCount && product.waitlistCount > 0) {
      signals.push('waitlist');
    }
    
    if (product.competitorReviews && product.competitorReviews > 0) {
      signals.push('competitor_reviews');
    }
    
    if (product.customerRequests && product.customerRequests > 0) {
      signals.push('customer_request');
    }

    // Query database for existing signals
    const { data: existingSignals } = await this.supabase
      .from('demand_signals')
      .select('signal_type')
      .eq('product_category', product.category)
      .limit(10);

    if (existingSignals) {
      existingSignals.forEach(signal => signals.push(signal.signal_type));
    }

    if (signals.length < this.rules.productDemandValidation.minSignalCount) {
      return { 
        passed: false, 
        reason: `Product lacks demand validation. Found ${signals.length} signals, need ${this.rules.productDemandValidation.minSignalCount}` 
      };
    }

    return { passed: true };
  }

  /**
   * RULE 4: Execution Margin Gate
   */
  checkMargin(task) {
    if (!task.estimatedRevenue || !task.estimatedCost) {
      if (this.rules.executionMargin.blockIfUncalculable) {
        return { 
          passed: false, 
          reason: 'Cannot calculate margin - revenue and cost estimates required' 
        };
      }
      return { passed: true }; // Allow if not blocking
    }

    const margin = ((task.estimatedRevenue - task.estimatedCost) / task.estimatedRevenue) * 100;

    if (margin < this.rules.executionMargin.minMarginPercent) {
      return { 
        passed: false, 
        reason: `Margin ${margin.toFixed(1)}% below threshold ${this.rules.executionMargin.minMarginPercent}%` 
      };
    }

    return { passed: true };
  }

  /**
   * Log kill reason for analysis
   */
  async logKill(task, reason) {
    try {
      await this.memory.write('cascade_kills', {
        task_type: task.type,
        task_data: task,
        kill_reason: reason,
        killed_at: new Date().toISOString()
      });
      console.log(`[CASCADE] Logged kill: ${task.type} - ${reason}`);
    } catch (e) {
      console.error(`[CASCADE] Failed to log kill: ${e.message}`);
    }
  }
}

module.exports = RealityFilter;
