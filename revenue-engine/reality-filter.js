/**
 * HYDI Reality Filter Layer
 * 
 * Sits above CASCADE. Prevents stupid tasks from being born.
 * Answers: "What should NOT happen?"
 * 
 * Rules are enforced BEFORE execution, not after failure.
 */

class RealityFilter {
  constructor() {
    // Hard constraints - these are non-negotiable
    this.constraints = {
      // Lead source validation
      leadSources: {
        minConversionProof: 0.05, // 5% minimum historical conversion
        allowedSources: ['linkedin', 'referral', 'directory', 'cold_email_proven'],
        blockedSources: ['random_scrape', 'unverified_api'],
        maxNewSourcesPerDay: 2
      },
      
      // Outreach quality gates
      outreach: {
        minPersonalizationScore: 0.7,
        maxDailyOutreach: 50,
        minRelevanceScore: 0.8,
        requiredPersonalization: ['company_name', 'specific_need', 'pain_point'],
        blockedPatterns: ['dear_friend', 'opportunity_of_lifetime', 'act_now']
      },
      
      // Pricing constraints
      pricing: {
        minMarginPercent: 40,
        maxDiscountPercent: 20,
        priceBandRanges: {
          custom_print: { min: 100, max: 1000 },
          prototyping: { min: 250, max: 2500 },
          architectural_model: { min: 400, max: 4000 },
          bulk_printing: { min: 800, max: 8000 }
        },
        rushOrderMultiplier: { min: 1.2, max: 1.5 }
      },
      
      // Product listing requirements
      products: {
        minDemandScore: 0.6,
        minMarginPercent: 50,
        maxListingsPerDay: 5,
        requiredValidation: ['trend_score', 'competitor_analysis', 'cost_validation'],
        blacklistedCategories: ['saturated', 'no_demand', 'high_competition_low_margin']
      },
      
      // Execution gates
      execution: {
        minExpectedMargin: 30,
        maxConcurrentTasks: 10,
        requiredPreChecks: ['resource_availability', 'time_estimate', 'cost_validation'],
        blockedHours: [22, 23, 0, 1, 2, 3, 4, 5], // No execution 10pm-6am
        weekendMultiplier: 1.5 // Higher margin required on weekends
      }
    };
    
    // Learning from past failures
    this.failurePatterns = new Map();
    this.successPatterns = new Map();
  }

  /**
   * Filter a task before it reaches CASCADE
   * Returns { allowed: boolean, reason: string, score: number }
   */
  async filterTask(taskType, params, context = {}) {
    console.log(`[REALITY FILTER] Evaluating: ${taskType}`);
    
    switch (taskType) {
      case 'scrape_leads':
        return await this.filterLeadScraping(params, context);
      case 'send_outreach':
        return await this.filterOutreach(params, context);
      case 'create_quote':
        return await this.filterQuote(params, context);
      case 'create_product':
        return await this.filterProductCreation(params, context);
      case 'execute_fulfillment':
        return await this.filterExecution(params, context);
      default:
        return { allowed: false, reason: 'Unknown task type', score: 0 };
    }
  }

  async filterLeadScraping(params, context) {
    const { source, niche, estimatedLeads } = params;
    
    // Check if source is allowed
    if (this.constraints.leadSources.blockedSources.includes(source)) {
      return {
        allowed: false,
        reason: `Lead source '${source}' is blocked. Proven sources only.`,
        score: 0
      };
    }
    
    // Check historical conversion for this source
    const conversionRate = await this.getConversionRate(source);
    if (conversionRate < this.constraints.leadSources.minConversionProof) {
      return {
        allowed: false,
        reason: `Source conversion rate (${(conversionRate * 100).toFixed(1)}%) below threshold (${this.constraints.leadSources.minConversionProof * 100}%)`,
        score: conversionRate
      };
    }
    
    // Check if we're adding too many new sources
    const newSourcesToday = await this.getNewSourcesToday();
    if (newSourcesToday >= this.constraints.leadSources.maxNewSourcesPerDay && !this.constraints.leadSources.allowedSources.includes(source)) {
      return {
        allowed: false,
        reason: `Too many new sources tested today (${newSourcesToday}). Focus on proven sources.`,
        score: 0.3
      };
    }
    
    // Check niche saturation
    const saturationScore = await this.getNicheSaturation(niche);
    if (saturationScore > 0.8) {
      return {
        allowed: false,
        reason: `Niche '${niche}' is saturated (${(saturationScore * 100).toFixed(1)}% saturation)`,
        score: 1 - saturationScore
      };
    }
    
    return {
      allowed: true,
      reason: 'Lead scraping approved',
      score: Math.min(conversionRate * 2, 1)
    };
  }

  async filterOutreach(params, context) {
    const { leads, template, personalizationData } = params;
    
    // Check daily limit
    const outreachToday = await this.getOutreachCountToday();
    if (outreachToday >= this.constraints.outreach.maxDailyOutreach) {
      return {
        allowed: false,
        reason: `Daily outreach limit reached (${outreachToday}/${this.constraints.outreach.maxDailyOutreach})`,
        score: 0
      };
    }
    
    // Analyze personalization
    const personalizationScore = this.calculatePersonalizationScore(template, personalizationData);
    if (personalizationScore < this.constraints.outreach.minPersonalizationScore) {
      return {
        allowed: false,
        reason: `Personalization score (${personalizationScore.toFixed(2)}) below threshold (${this.constraints.outreach.minPersonalizationScore})`,
        score: personalizationScore
      };
    }
    
    // Check for blocked patterns
    const hasBlockedPattern = this.constraints.outreach.blockedPatterns.some(pattern => 
      template.toLowerCase().includes(pattern.toLowerCase())
    );
    if (hasBlockedPattern) {
      return {
        allowed: false,
        reason: 'Template contains blocked sales patterns',
        score: 0
      };
    }
    
    // Check lead relevance
    const avgRelevance = await this.calculateLeadRelevance(leads);
    if (avgRelevance < this.constraints.outreach.minRelevanceScore) {
      return {
        allowed: false,
        reason: `Average lead relevance (${avgRelevance.toFixed(2)}) below threshold`,
        score: avgRelevance
      };
    }
    
    return {
      allowed: true,
      reason: 'Outreach approved',
      score: (personalizationScore + avgRelevance) / 2
    };
  }

  async filterQuote(params, context) {
    const { projectType, quantity, complexity, rushOrder, basePrice } = params;
    
    // Get price band for project type
    const priceBand = this.constraints.pricing.priceBandRanges[projectType];
    if (!priceBand) {
      return {
        allowed: false,
        reason: `Unknown project type: ${projectType}`,
        score: 0
      };
    }
    
    // Calculate final price
    let finalPrice = basePrice;
    if (complexity === 'high') finalPrice *= 1.5;
    if (complexity === 'medium') finalPrice *= 1.2;
    if (rushOrder) finalPrice *= 1.3;
    
    // Check minimum margin
    const estimatedCost = await this.getEstimatedCost(projectType, quantity);
    const marginPercent = ((finalPrice - estimatedCost) / finalPrice) * 100;
    
    if (marginPercent < this.constraints.pricing.minMarginPercent) {
      return {
        allowed: false,
        reason: `Margin (${marginPercent.toFixed(1)}%) below minimum (${this.constraints.pricing.minMarginPercent}%)`,
        score: marginPercent / 100
      };
    }
    
    // Check if price is within band
    if (finalPrice < priceBand.min || finalPrice > priceBand.max) {
      return {
        allowed: false,
        reason: `Price $${finalPrice.toFixed(2)} outside band for ${projectType} ($${priceBand.min}-$${priceBand.max})`,
        score: 0.5
      };
    }
    
    // Check execution window
    const hour = new Date().getHours();
    if (this.constraints.execution.blockedHours.includes(hour) && !rushOrder) {
      return {
        allowed: false,
        reason: `Quote creation blocked during off-hours (${hour}:00). Use rush order if urgent.`,
        score: 0.2
      };
    }
    
    return {
      allowed: true,
      reason: 'Quote approved',
      score: Math.min(marginPercent / 100, 1)
    };
  }

  async filterProductCreation(params, context) {
    const { category, estimatedCost, estimatedPrice, trendScore } = params;
    
    // Check if category is blacklisted
    if (this.constraints.products.blacklistedCategories.includes(category)) {
      return {
        allowed: false,
        reason: `Category '${category}' is blacklisted`,
        score: 0
      };
    }
    
    // Check demand validation
    const demandScore = await this.getDemandScore(category);
    if (demandScore < this.constraints.products.minDemandScore) {
      return {
        allowed: false,
        reason: `Demand score (${demandScore.toFixed(2)}) below threshold`,
        score: demandScore
      };
    }
    
    // Check margin
    const marginPercent = ((estimatedPrice - estimatedCost) / estimatedPrice) * 100;
    if (marginPercent < this.constraints.products.minMarginPercent) {
      return {
        allowed: false,
        reason: `Product margin (${marginPercent.toFixed(1)}%) below minimum (${this.constraints.products.minMarginPercent}%)`,
        score: marginPercent / 100
      };
    }
    
    // Check daily limit
    const listingsToday = await this.getProductListingsToday();
    if (listingsToday >= this.constraints.products.maxListingsPerDay) {
      return {
        allowed: false,
        reason: `Daily product listing limit reached (${listingsToday}/${this.constraints.products.maxListingsPerDay})`,
        score: 0
      };
    }
    
    return {
      allowed: true,
      reason: 'Product creation approved',
      score: (demandScore + marginPercent / 100) / 2
    };
  }

  async filterExecution(params, context) {
    const { taskId, estimatedCost, estimatedRevenue, timeEstimate } = params;
    
    // Check execution window
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    if (this.constraints.execution.blockedHours.includes(hour)) {
      return {
        allowed: false,
        reason: `Execution blocked during off-hours (${hour}:00)`,
        score: 0
      };
    }
    
    // Check margin
    const marginPercent = ((estimatedRevenue - estimatedCost) / estimatedRevenue) * 100;
    const minMargin = dayOfWeek === 0 || dayOfWeek === 6 
      ? this.constraints.execution.minExpectedMargin * this.constraints.execution.weekendMultiplier
      : this.constraints.execution.minExpectedMargin;
    
    if (marginPercent < minMargin) {
      return {
        allowed: false,
        reason: `Execution margin (${marginPercent.toFixed(1)}%) below minimum (${minMargin.toFixed(1)}%)`,
        score: marginPercent / 100
      };
    }
    
    // Check concurrent tasks
    const concurrentTasks = await this.getConcurrentTaskCount();
    if (concurrentTasks >= this.constraints.execution.maxConcurrentTasks) {
      return {
        allowed: false,
        reason: `Too many concurrent tasks (${concurrentTasks}/${this.constraints.execution.maxConcurrentTasks})`,
        score: 0.3
      };
    }
    
    // Validate pre-checks
    const preChecks = await this.runPreChecks(taskId);
    if (!preChecks.allPassed) {
      return {
        allowed: false,
        reason: `Pre-checks failed: ${preChecks.failed.join(', ')}`,
        score: 0.2
      };
    }
    
    return {
      allowed: true,
      reason: 'Execution approved',
      score: Math.min(marginPercent / 100, 1)
    };
  }

  // Helper methods (simplified implementations)
  async getConversionRate(source) {
    // In real implementation, query database
    const mockRates = { linkedin: 0.08, referral: 0.15, directory: 0.05, cold_email_proven: 0.03 };
    return mockRates[source] || 0.01;
  }

  async getNewSourcesToday() {
    // Query database for new sources tested today
    return Math.floor(Math.random() * 3);
  }

  async getNicheSaturation(niche) {
    // Calculate saturation based on existing leads and competition
    return Math.random() * 0.9;
  }

  async getOutreachCountToday() {
    // Query database for outreach sent today
    return Math.floor(Math.random() * 50);
  }

  calculatePersonalizationScore(template, personalizationData) {
    let score = 0.5;
    const required = this.constraints.outreach.requiredPersonalization;
    
    required.forEach(item => {
      if (personalizationData[item]) score += 0.1;
    });
    
    return Math.min(score, 1);
  }

  async calculateLeadRelevance(leads) {
    // Calculate average relevance score for leads
    return 0.6 + Math.random() * 0.4;
  }

  async getEstimatedCost(projectType, quantity) {
    const baseCosts = {
      custom_print: 80,
      prototyping: 180,
      architectural_model: 300,
      bulk_printing: 600
    };
    return baseCosts[projectType] * (quantity / 10);
  }

  async getDemandScore(category) {
    // Query trend data and market demand
    return 0.5 + Math.random() * 0.5;
  }

  async getProductListingsToday() {
    // Query database for listings created today
    return Math.floor(Math.random() * 5);
  }

  async getConcurrentTaskCount() {
    // Query active tasks
    return Math.floor(Math.random() * 10);
  }

  async runPreChecks(taskId) {
    // Run required pre-checks
    return {
      allPassed: true,
      failed: []
    };
  }

  /**
   * Learn from outcomes to tighten constraints
   */
  async learnFromOutcome(taskType, params, outcome) {
    if (outcome.success) {
      // This worked - maybe we can be slightly more permissive
      console.log(`[REALITY FILTER] Learning from success: ${taskType}`);
    } else {
      // This failed - tighten constraints
      console.log(`[REALITY FILTER] Learning from failure: ${taskType} - ${outcome.reason}`);
      
      // Store failure pattern
      const pattern = JSON.stringify(params);
      if (!this.failurePatterns.has(taskType)) {
        this.failurePatterns.set(taskType, new Map());
      }
      this.failurePatterns.get(taskType).set(pattern, (this.failurePatterns.get(taskType).get(pattern) || 0) + 1);
    }
  }

  /**
   * Get system constraints summary
   */
  getConstraints() {
    return {
      leadSources: this.constraints.leadSources,
      outreach: this.constraints.outreach,
      pricing: this.constraints.pricing,
      products: this.constraints.products,
      execution: this.constraints.execution
    };
  }
}

module.exports = RealityFilter;
