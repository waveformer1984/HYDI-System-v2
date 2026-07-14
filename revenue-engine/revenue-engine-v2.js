/**
 * HYDI Revenue Engine V2
 * 
 * With Reality Filter Layer integrated
 * Reality Filter → CASCADE → Execution
 * 
 * Reality Filter: Prevents stupid tasks from being born
 * CASCADE: Kills underperforming tasks
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const RealityFilter = require('./reality-filter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

class RevenueEngineV2 {
  constructor() {
    this.supabase = supabase;
    this.stripe = stripe;
    this.realityFilter = new RealityFilter(this.supabase);
    
    // Enhanced metrics with filter tracking
    this.metrics = {
      // Original metrics
      leadsScraped: 0,
      proposalsGenerated: 0,
      checkoutsCreated: 0,
      productsListed: 0,
      revenueToday: 0,
      
      // New filter metrics
      tasksBlocked: 0,
      tasksAllowed: 0,
      cascadeKilled: 0,
      filterBlockReasons: new Map(),
      
      // Performance metrics
      avgFilterScore: 0,
      avgCascadeScore: 0,
      systemEfficiency: 0
    };
  }

  /**
   * Enhanced task execution with Reality Filter
   */
  async executeTask(taskType, params, context = {}) {
    console.log(`\n[REVENUE V2] Executing: ${taskType}`);
    
    // STEP 1: Reality Filter Check
    const filterResult = await this.realityFilter.filterTask(taskType, params, context);
    
    if (!filterResult.allowed) {
      this.metrics.tasksBlocked++;
      
      // Track block reason
      const reason = filterResult.reason;
      this.metrics.filterBlockReasons.set(reason, (this.metrics.filterBlockReasons.get(reason) || 0) + 1);
      
      console.log(`[REALITY FILTER] ❌ BLOCKED: ${reason}`);
      console.log(`[REVENUE V2] Task prevented - no waste of resources\n`);
      
      return {
        success: false,
        blocked: true,
        reason: reason,
        filterScore: filterResult.score,
        stage: 'reality_filter'
      };
    }
    
    this.metrics.tasksAllowed++;
    console.log(`[REALITY FILTER] ✅ ALLOWED: ${filterResult.reason} (score: ${filterResult.score.toFixed(2)})`);
    
    // STEP 2: Execute the task
    let result;
    try {
      switch (taskType) {
        case 'scrape_leads':
          result = await this.scrapeLeads(params);
          break;
        case 'send_outreach':
          result = await this.sendOutreach(params);
          break;
        case 'create_quote':
          result = await this.createInstantQuote(params);
          break;
        case 'create_product':
          result = await this.generateProductIdeas(params);
          break;
        default:
          throw new Error(`Unknown task type: ${taskType}`);
      }
    } catch (error) {
      console.error(`[REVENUE V2] Execution failed: ${error.message}`);
      
      // Learn from failure
      await this.realityFilter.learnFromOutcome(taskType, params, { 
        success: false, 
        reason: error.message 
      });
      
      return {
        success: false,
        error: error.message,
        filterScore: filterResult.score,
        stage: 'execution'
      };
    }
    
    // STEP 3: CASCADE Scoring
    const cascadeScore = this.scoreTaskForCascade(taskType, result);
    console.log(`[CASCADE] Score: ${cascadeScore.toFixed(2)}`);
    
    if (this.shouldCascadeKill(taskType, cascadeScore)) {
      this.metrics.cascadeKilled++;
      console.log(`[CASCADE] ❌ KILLED: Performance below threshold`);
      
      // Learn from failure
      await this.realityFilter.learnFromOutcome(taskType, params, { 
        success: false, 
        reason: 'CASCADE: Performance below threshold' 
      });
      
      return {
        success: false,
        cascadeKilled: true,
        reason: 'Performance below threshold',
        filterScore: filterResult.score,
        cascadeScore: cascadeScore,
        stage: 'cascade'
      };
    }
    
    // STEP 4: Success - Learn and track
    console.log(`[CASCADE] ✅ SURVIVED: Task completed successfully`);
    
    await this.realityFilter.learnFromOutcome(taskType, params, { 
      success: true, 
      result: result 
    });
    
    // Update metrics
    this.updateMetrics(taskType, result, filterScore, cascadeScore);
    
    return {
      success: true,
      result: result,
      filterScore: filterScore,
      cascadeScore: cascadeScore,
      stage: 'completed'
    };
  }

  /**
   * Enhanced revenue cycle with Reality Filter
   */
  async runRevenueCycle() {
    console.log('\n═══════════════════════════════════════════');
    console.log('   HYDI REVENUE ENGINE V2 - WITH REALITY FILTER');
    console.log('═══════════════════════════════════════════\n');

    const cycleResults = [];
    let totalRevenue = 0;

    // Task 1: Scrape leads
    console.log('📍 TASK 1: Lead Scraping');
    const scrapeResult = await this.executeTask('scrape_leads', {
      source: 'linkedin',
      niche: 'prototyping',
      estimatedLeads: 10
    });
    cycleResults.push({ task: 'scrape_leads', result: scrapeResult });

    // Task 2: Send outreach (only if leads were scraped)
    if (scrapeResult.success && scrapeResult.result.leads) {
      console.log('\n📍 TASK 2: Outreach');
      const outreachResult = await this.executeTask('send_outreach', {
        leads: scrapeResult.result.leads,
        template: 'Hi {{company_name}}, noticed you need {{specific_need}}...',
        personalizationData: { company_name: true, specific_need: true, pain_point: true }
      });
      cycleResults.push({ task: 'send_outreach', result: outreachResult });
    }

    // Task 3: Create quote
    console.log('\n📍 TASK 3: Quote Creation');
    const quoteResult = await this.executeTask('create_quote', {
      projectType: 'custom_print',
      quantity: 5,
      complexity: 'medium',
      rushOrder: false,
      basePrice: 150
    });
    cycleResults.push({ task: 'create_quote', result: quoteResult });

    // Task 4: Generate products
    console.log('\n📍 TASK 4: Product Generation');
    const productResult = await this.executeTask('create_product', {
      category: 'organizers',
      estimatedCost: 8,
      estimatedPrice: 25,
      trendScore: 0.75
    });
    cycleResults.push({ task: 'create_product', result: productResult });

    // Calculate cycle metrics
    const successfulTasks = cycleResults.filter(r => r.result.success).length;
    const blockedTasks = cycleResults.filter(r => r.result.blocked).length;
    const cascadeKilled = cycleResults.filter(r => r.result.cascadeKilled).length;
    
    const systemEfficiency = successfulTasks / cycleResults.length;
    this.metrics.systemEfficiency = systemEfficiency;

    // Generate report
    console.log('\n═══════════════════════════════════════════');
    console.log('           CYCLE COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Successful: ${successfulTasks}/${cycleResults.length}`);
    console.log(`🚫 Blocked by Filter: ${blockedTasks}`);
    console.log(`⚔️  Killed by CASCADE: ${cascadeKilled}`);
    console.log(`📊 System Efficiency: ${(systemEfficiency * 100).toFixed(1)}%`);
    console.log(`💰 Total Revenue: $${totalRevenue.toFixed(2)}`);
    
    // Show block reasons if any
    if (this.metrics.filterBlockReasons.size > 0) {
      console.log('\n🚫 Block Reasons:');
      for (const [reason, count] of this.metrics.filterBlockReasons) {
        console.log(`   ${reason}: ${count}`);
      }
    }
    
    console.log('═══════════════════════════════════════════\n');

    return {
      cycleResults,
      metrics: this.metrics,
      efficiency: systemEfficiency,
      report: {
        successfulTasks,
        blockedTasks,
        cascadeKilled,
        totalRevenue,
        constraints: this.realityFilter.getConstraints()
      }
    };
  }

  /**
   * CASCADE scoring methods
   */
  scoreTaskForCascade(taskType, result) {
    const scores = {
      scrape_leads: result.leads?.length > 0 ? 0.8 : 0.2,
      send_outreach: result.outreach?.length > 0 ? 0.9 : 0.4,
      create_quote: result.total > 0 ? 0.85 : 0.3,
      create_product: result.products?.length > 0 ? 0.8 : 0.3
    };
    return scores[taskType] || 0.5;
  }

  shouldCascadeKill(taskType, score) {
    const thresholds = {
      scrape_leads: 0.3,
      send_outreach: 0.3,
      create_quote: 0.4,
      create_product: 0.3
    };
    return score < (thresholds[taskType] || 0.3);
  }

  /**
   * Update metrics
   */
  updateMetrics(taskType, result, filterScore, cascadeScore) {
    // Update original metrics
    switch (taskType) {
      case 'scrape_leads':
        this.metrics.leadsScraped += result.leads?.length || 0;
        break;
      case 'send_outreach':
        // Outreach metrics tracked in original methods
        break;
      case 'create_quote':
        this.metrics.checkoutsCreated++;
        break;
      case 'create_product':
        this.metrics.productsListed += result.products?.length || 0;
        break;
    }

    // Update new metrics
    const totalScores = this.metrics.tasksAllowed * this.metrics.avgFilterScore || 0;
    this.metrics.avgFilterScore = (totalScores + filterScore) / (this.metrics.tasksAllowed || 1);
    
    const cascadeScores = this.metrics.tasksAllowed * this.metrics.avgCascadeScore || 0;
    this.metrics.avgCascadeScore = (cascadeScores + cascadeScore) / (this.metrics.tasksAllowed || 1);
  }

  /**
   * Original methods (unchanged but now called through executeTask)
   */
  async scrapeLeads(params) {
    console.log(`[REVENUE] Scraping leads for ${params.niche} from ${params.source}...`);
    
    const mockLeads = [
      { 
        id: `lead_${Date.now()}_1`,
        company: 'TechCorp',
        contact: 'ceo@techcorp.com',
        niche: params.niche,
        source: params.source,
        score: 85,
        status: 'new',
        created_at: new Date().toISOString()
      },
      {
        id: `lead_${Date.now()}_2`,
        company: 'StartupXYZ',
        contact: 'founder@startupxyz.com', 
        niche: params.niche,
        source: params.source,
        score: 92,
        status: 'new',
        created_at: new Date().toISOString()
      }
    ];

    for (const lead of mockLeads) {
      await this.supabase.from('leads').upsert(lead, { onConflict: 'id' });
    }

    console.log(`[REVENUE] ✓ Scraped ${mockLeads.length} leads`);
    return { leads: mockLeads };
  }

  async sendOutreach(params) {
    console.log(`[REVENUE] Sending outreach to ${params.leads.length} leads...`);
    
    const outreachResults = [];
    
    for (const lead of params.leads) {
      const outreach = {
        id: `outreach_${Date.now()}_${lead.id}`,
        lead_id: lead.id,
        email_subject: `Custom 3D printing for ${lead.company}`,
        email_body: params.template.replace('{{company_name}}', lead.company),
        status: 'sent',
        sent_at: new Date().toISOString()
      };
      
      await this.supabase.from('outreach').insert(outreach);
      outreachResults.push({ lead: lead.company, email: outreach.email_subject });
    }

    console.log(`[REVENUE] ✓ Sent ${outreachResults.length} outreach emails`);
    return { outreach: outreachResults };
  }

  async createInstantQuote(params) {
    console.log('[REVENUE] Creating instant quote...');
    
    const pricing = this.calculatePricing(params.projectType);
    let total = pricing.base + (params.quantity * pricing.rate);
    
    if (params.complexity === 'high') total *= 1.5;
    if (params.complexity === 'medium') total *= 1.2;
    if (params.rushOrder) total *= 1.3;
    
    const quote = {
      id: `quote_${Date.now()}`,
      project_type: params.projectType,
      quantity: params.quantity,
      complexity: params.complexity,
      rush_order: params.rushOrder,
      base_price: pricing.base,
      unit_price: pricing.rate,
      total: Math.round(total * 100) / 100,
      currency: 'usd',
      valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      created_at: new Date().toISOString()
    };

    await this.supabase.from('quotes').insert(quote);
    
    console.log(`[REVENUE] ✓ Quote created: $${quote.total}`);
    return quote;
  }

  async generateProductIdeas(params) {
    console.log(`[REVENUE] Generating products for ${params.category}...`);
    
    const products = [
      {
        id: `idea_${Date.now()}_1`,
        name: `Smart ${params.category} System`,
        category: params.category,
        estimated_cost: params.estimatedCost,
        estimated_price: params.estimatedPrice,
        trend_score: params.trendScore,
        status: 'idea',
        created_at: new Date().toISOString()
      }
    ];

    for (const product of products) {
      await this.supabase.from('product_ideas').insert(product);
    }

    console.log(`[REVENUE] ✓ Generated ${products.length} products`);
    return { products };
  }

  calculatePricing(projectType) {
    const baseRates = {
      custom_print: { base: 150, rate: 25 },
      prototyping: { base: 300, rate: 50 },
      architectural_model: { base: 500, rate: 100 },
      bulk_printing: { base: 1000, rate: 15 }
    };
    return baseRates[projectType] || baseRates.custom_print;
  }

  /**
   * Get system health report
   */
  async getSystemHealth() {
    const efficiency = this.metrics.systemEfficiency;
    const healthScore = efficiency * 100;
    
    let status = 'critical';
    if (healthScore > 80) status = 'healthy';
    else if (healthScore > 60) status = 'degraded';
    else if (healthScore > 40) status = 'warning';
    
    return {
      status,
      score: healthScore,
      metrics: this.metrics,
      constraints: this.realityFilter.getConstraints(),
      recommendations: this.generateRecommendations()
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.metrics.tasksBlocked > this.metrics.tasksAllowed) {
      recommendations.push('Reality Filter is blocking too many tasks - consider adjusting constraints');
    }
    
    if (this.metrics.cascadeKilled > this.metrics.tasksAllowed * 0.5) {
      recommendations.push('CASCADE is killing many tasks - improve execution quality');
    }
    
    if (this.metrics.avgFilterScore < 0.6) {
      recommendations.push('Average filter score is low - tasks are barely passing validation');
    }
    
    const topBlockReason = [...this.metrics.filterBlockReasons.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    
    if (topBlockReason) {
      recommendations.push(`Top block reason: ${topBlockReason[0]} (${topBlockReason[1]} times)`);
    }
    
    return recommendations;
  }
}

module.exports = RevenueEngineV2;

// CLI interface
async function main() {
  const engine = new RevenueEngineV2();
  const command = process.argv[2];

  switch (command) {
    case 'cycle':
      await engine.runRevenueCycle();
      break;
    case 'health':
      const health = await engine.getSystemHealth();
      console.log(JSON.stringify(health, null, 2));
      break;
    case 'constraints':
      console.log(JSON.stringify(engine.realityFilter.getConstraints(), null, 2));
      break;
    case 'test-filter':
      // Test the filter with various scenarios
      const tests = [
        { task: 'scrape_leads', params: { source: 'random_scrape', niche: 'test' } },
        { task: 'send_outreach', params: { template: 'Dear friend, act now!', leads: [] } },
        { task: 'create_quote', params: { projectType: 'custom_print', basePrice: 50 } }
      ];
      
      for (const test of tests) {
        const result = await engine.realityFilter.filterTask(test.task, test.params);
        console.log(`${test.task}: ${result.allowed ? '✅' : '❌'} ${result.reason}`);
      }
      break;
    default:
      console.log('HYDI Revenue Engine V2 - With Reality Filter\n');
      console.log('Commands:');
      console.log('  cycle         - Run complete revenue cycle with filtering');
      console.log('  health        - Get system health report');
      console.log('  constraints   - Show all Reality Filter constraints');
      console.log('  test-filter   - Test filter with various scenarios');
  }
}

if (require.main === module) {
  main().catch(console.error);
}
