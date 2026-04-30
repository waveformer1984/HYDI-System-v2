/**
 * ProtoForge Financial Automation Engine
 * 
 * Comprehensive financial automation system that manages:
 * - Dynamic budget allocation by priority
 * - Real-time burn tracking
 * - Cash flow forecasting with AI predictions
 * - Revenue stream management
 * - Funding pipeline automation
 * - Smart treasury management
 * - Multi-account financial orchestration
 * - Emergency buffer management
 * - Investment optimization
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class ProtoForgeFinancialEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      defaultCurrency: 'USD',
      reserveRequirement: 0.15, // 15% reserve requirement
      emergencyBuffer: 0.10, // 10% emergency buffer
      investmentAllocation: 0.20, // 20% for investments
      rebalanceFrequency: 7 * 24 * 60 * 60 * 1000, // Weekly
      forecastHorizon: 90 * 24 * 60 * 60 * 1000, // 90 days
      alertThresholds: {
        lowCash: 0.20, // 20% of budget
        highBurn: 0.15, // 15% over projected
        revenueDecline: 0.10 // 10% decline
      },
      ...config
    };
    
    // Financial accounts
    this.accounts = new Map();
    
    // Budget management
    this.budgets = new Map();
    this.allocations = new Map();
    this.expenses = new Map();
    
    // Revenue management
    this.revenueStreams = new Map();
    this.revenueHistory = [];
    
    // Funding pipeline
    this.fundingPipeline = new Map();
    this.grantApplications = new Map();
    
    // Treasury management
    this.treasury = {
      totalAssets: 0,
      reserveFund: 0,
      emergencyFund: 0,
      investmentFund: 0,
      operatingFund: 0
    };
    
    // Forecasting
    this.forecasts = new Map();
    this.predictions = [];
    
    // Alerts and notifications
    this.alerts = [];
    this.notifications = [];
    
    // Metrics
    this.metrics = {
      totalRevenue: 0,
      totalExpenses: 0,
      netIncome: 0,
      burnRate: 0,
      runway: 0,
      cashPosition: 0,
      roi: 0
    };
    
    // Automation rules
    this.automationRules = new Map();
    
    console.log('[FINANCIAL ENGINE] Initialized with automation capabilities');
    console.log(`[FINANCIAL ENGINE] Reserve requirement: ${(this.config.reserveRequirement * 100).toFixed(1)}%`);
    console.log(`[FINANCIAL ENGINE] Emergency buffer: ${(this.config.emergencyBuffer * 100).toFixed(1)}%`);
  }
  
  /**
   * Initialize the financial engine
   */
  async initialize(initialCapital = 0) {
    console.log('[FINANCIAL ENGINE] Initializing financial systems...');
    
    // Set up initial treasury
    this.initializeTreasury(initialCapital);
    
    // Set up default automation rules
    this.setupDefaultAutomationRules();
    
    // Start background processes
    this.startBackgroundProcesses();
    
    console.log(`[FINANCIAL ENGINE] Initialized with $${initialCapital.toLocaleString()} initial capital`);
    
    this.emit('initialized', {
      initialCapital,
      treasury: this.treasury,
      timestamp: Date.now()
    });
  }
  
  /**
   * Initialize treasury with initial capital
   */
  initializeTreasury(initialCapital) {
    this.treasury.totalAssets = initialCapital;
    this.treasury.reserveFund = initialCapital * this.config.reserveRequirement;
    this.treasury.emergencyFund = initialCapital * this.config.emergencyBuffer;
    this.treasury.investmentFund = initialCapital * this.config.investmentAllocation;
    this.treasury.operatingFund = initialCapital - (
      this.treasury.reserveFund + 
      this.treasury.emergencyFund + 
      this.treasury.investmentFund
    );
    
    console.log('[FINANCIAL ENGINE] Treasury allocation:');
    console.log(`  Reserve Fund: $${this.treasury.reserveFund.toLocaleString()}`);
    console.log(`  Emergency Fund: $${this.treasury.emergencyFund.toLocaleString()}`);
    console.log(`  Investment Fund: $${this.treasury.investmentFund.toLocaleString()}`);
    console.log(`  Operating Fund: $${this.treasury.operatingFund.toLocaleString()}`);
  }
  
  /**
   * Set up default automation rules
   */
  setupDefaultAutomationRules() {
    // Cash management rules
    this.automationRules.set('cash_rebalance', {
      name: 'Automatic Cash Rebalancing',
      trigger: 'cash_imbalance',
      condition: 'operating_fund < 0.1 * total_assets OR operating_fund > 0.5 * total_assets',
      action: 'rebalance_funds',
      enabled: true
    });
    
    // Burn rate monitoring
    this.automationRules.set('burn_rate_alert', {
      name: 'Burn Rate Alert',
      trigger: 'burn_rate_exceeds_threshold',
      condition: 'burn_rate > projected_burn_rate * 1.15',
      action: 'send_alert_and_reduce_expenses',
      enabled: true
    });
    
    // Revenue optimization
    this.automationRules.set('revenue_optimization', {
      name: 'Revenue Stream Optimization',
      trigger: 'revenue_decline_detected',
      condition: 'revenue_growth_rate < -0.10 for 2_consecutive_months',
      action: 'analyze_and_optimize_revenue_streams',
      enabled: true
    });
    
    // Investment management
    this.automationRules.set('investment_rebalancing', {
      name: 'Investment Portfolio Rebalancing',
      trigger: 'periodic_rebalance',
      condition: 'weekly_schedule',
      action: 'rebalance_investment_portfolio',
      enabled: true
    });
    
    console.log(`[FINANCIAL ENGINE] Set up ${this.automationRules.size} automation rules`);
  }
  
  /**
   * Create a budget with dynamic allocation
   */
  createBudget(name, totalAmount, categories, priorities = {}) {
    const budget = {
      id: uuidv4(),
      name,
      totalAmount,
      categories,
      priorities,
      allocations: this.calculateDynamicAllocations(totalAmount, categories, priorities),
      createdAt: Date.now(),
      lastRebalanced: Date.now(),
      spent: 0,
      remaining: totalAmount
    };
    
    this.budgets.set(budget.id, budget);
    
    console.log(`[FINANCIAL ENGINE] Created budget: ${name} - $${totalAmount.toLocaleString()}`);
    
    this.emit('budget_created', budget);
    
    return budget;
  }
  
  /**
   * Calculate dynamic allocations based on priorities
   */
  calculateDynamicAllocations(totalAmount, categories, priorities) {
    const allocations = new Map();
    let remainingAmount = totalAmount;
    
    // Sort categories by priority
    const sortedCategories = categories.sort((a, b) => {
      const priorityA = priorities[a.name] || 3;
      const priorityB = priorities[b.name] || 3;
      return priorityA - priorityB;
    });
    
    // Allocate based on priority and constraints
    sortedCategories.forEach(category => {
      let allocation;
      
      if (category.type === 'percentage') {
        allocation = totalAmount * (category.percentage / 100);
      } else if (category.type === 'fixed') {
        allocation = category.amount;
      } else if (category.type === 'minimum') {
        allocation = Math.max(category.minimum, remainingAmount * 0.1);
      } else {
        allocation = remainingAmount / sortedCategories.length;
      }
      
      // Apply constraints
      allocation = Math.min(allocation, remainingAmount);
      allocation = Math.min(allocation, category.maximum || remainingAmount);
      
      allocations.set(category.name, {
        allocated: allocation,
        percentage: (allocation / totalAmount) * 100,
        spent: 0,
        remaining: allocation
      });
      
      remainingAmount -= allocation;
    });
    
    return Object.fromEntries(allocations);
  }
  
  /**
   * Record an expense against a budget
   */
  recordExpense(budgetId, category, amount, description = '') {
    const budget = this.budgets.get(budgetId);
    
    if (!budget) {
      throw new Error(`Budget ${budgetId} not found`);
    }
    
    const categoryAllocation = budget.allocations[category];
    
    if (!categoryAllocation) {
      throw new Error(`Category ${category} not found in budget`);
    }
    
    if (categoryAllocation.remaining < amount) {
      throw new Error(`Insufficient funds in category ${category}`);
    }
    
    const expense = {
      id: uuidv4(),
      budgetId,
      category,
      amount,
      description,
      timestamp: Date.now(),
      approved: this.autoApproveExpense(amount, category)
    };
    
    // Update budget allocations
    categoryAllocation.spent += amount;
    categoryAllocation.remaining -= amount;
    budget.spent += amount;
    budget.remaining -= amount;
    
    // Record expense
    if (!this.expenses.has(budgetId)) {
      this.expenses.set(budgetId, []);
    }
    this.expenses.get(budgetId).push(expense);
    
    // Update metrics
    this.metrics.totalExpenses += amount;
    
    console.log(`[FINANCIAL ENGINE] Expense recorded: $${amount.toLocaleString()} for ${category}`);
    
    this.emit('expense_recorded', expense);
    
    // Check if rebalancing is needed
    this.checkBudgetRebalancing(budget);
    
    return expense;
  }
  
  /**
   * Auto-approve expense based on amount and category
   */
  autoApproveExpense(amount, category) {
    const thresholds = {
      'operational': 1000,
      'marketing': 500,
      'development': 2000,
      'infrastructure': 5000
    };
    
    const threshold = thresholds[category] || 1000;
    return amount <= threshold;
  }
  
  /**
   * Add a revenue stream
   */
  addRevenueStream(name, type, expectedAmount, frequency = 'monthly') {
    const stream = {
      id: uuidv4(),
      name,
      type,
      expectedAmount,
      frequency,
      actualAmount: 0,
      history: [],
      active: true,
      createdAt: Date.now()
    };
    
    this.revenueStreams.set(stream.id, stream);
    
    console.log(`[FINANCIAL ENGINE] Added revenue stream: ${name} - $${expectedAmount.toLocaleString()} ${frequency}`);
    
    this.emit('revenue_stream_added', stream);
    
    return stream;
  }
  
  /**
   * Record revenue from a stream
   */
  recordRevenue(streamId, amount, metadata = {}) {
    const stream = this.revenueStreams.get(streamId);
    
    if (!stream) {
      throw new Error(`Revenue stream ${streamId} not found`);
    }
    
    const revenue = {
      id: uuidv4(),
      streamId,
      amount,
      metadata,
      timestamp: Date.now()
    };
    
    // Update stream
    stream.actualAmount += amount;
    stream.history.push(revenue);
    
    // Add to history
    this.revenueHistory.push(revenue);
    
    // Update metrics
    this.metrics.totalRevenue += amount;
    this.metrics.netIncome = this.metrics.totalRevenue - this.metrics.totalExpenses;
    
    console.log(`[FINANCIAL ENGINE] Revenue recorded: $${amount.toLocaleString()} from ${stream.name}`);
    
    this.emit('revenue_recorded', revenue);
    
    // Update forecasts
    this.updateRevenueForecasts();
    
    return revenue;
  }
  
  /**
   * Calculate current burn rate
   */
  calculateBurnRate(timeWindow = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const cutoff = Date.now() - timeWindow;
    
    let totalExpenses = 0;
    
    for (const expenses of this.expenses.values()) {
      for (const expense of expenses) {
        if (expense.timestamp >= cutoff) {
          totalExpenses += expense.amount;
        }
      }
    }
    
    const dailyBurnRate = totalExpenses / (timeWindow / (24 * 60 * 60 * 1000));
    const monthlyBurnRate = dailyBurnRate * 30;
    
    this.metrics.burnRate = monthlyBurnRate;
    
    return {
      daily: dailyBurnRate,
      monthly: monthlyBurnRate,
      annual: monthlyBurnRate * 12
    };
  }
  
  /**
   * Calculate runway (months until cash depletion)
   */
  calculateRunway() {
    const burnRate = this.calculateBurnRate().monthly;
    const cashPosition = this.treasury.operatingFund + this.treasury.emergencyFund;
    
    if (burnRate <= 0) {
      return Infinity; // Infinite runway with positive cash flow
    }
    
    const runwayMonths = cashPosition / burnRate;
    this.metrics.runway = runwayMonths;
    
    return runwayMonths;
  }
  
  /**
   * Generate cash flow forecast
   */
  generateCashFlowForecast(horizon = this.config.forecastHorizon) {
    const forecast = {
      id: uuidv4(),
      horizon,
      generatedAt: Date.now(),
      projections: [],
      assumptions: this.getForecastAssumptions(),
      confidence: 0.8
    };
    
    // Generate monthly projections
    const months = Math.ceil(horizon / (30 * 24 * 60 * 60 * 1000));
    
    for (let month = 1; month <= months; month++) {
      const monthProjection = this.calculateMonthProjection(month);
      forecast.projections.push(monthProjection);
    }
    
    this.forecasts.set(forecast.id, forecast);
    
    console.log(`[FINANCIAL ENGINE] Generated ${months}-month cash flow forecast`);
    
    this.emit('forecast_generated', forecast);
    
    return forecast;
  }
  
  /**
   * Get forecast assumptions
   */
  getForecastAssumptions() {
    return {
      revenueGrowth: 0.05, // 5% monthly growth
      expenseGrowth: 0.02, // 2% monthly growth
      seasonality: this.calculateSeasonality(),
      marketConditions: 'stable',
      riskFactors: ['competition', 'market_volatility', 'operational_risks']
    };
  }
  
  /**
   * Calculate seasonality factors
   */
  calculateSeasonality() {
    const seasonality = new Array(12).fill(1.0);
    
    // Example: Q4 stronger, Q1 weaker
    seasonality[9] = 1.1; // October
    seasonality[10] = 1.2; // November
    seasonality[11] = 1.3; // December
    seasonality[0] = 0.8; // January
    seasonality[1] = 0.9; // February
    
    return seasonality;
  }
  
  /**
   * Calculate projection for a specific month
   */
  calculateMonthProjection(monthNumber) {
    const assumptions = this.getForecastAssumptions();
    const seasonalFactor = assumptions.seasonality[(monthNumber - 1) % 12];
    
    // Project revenue
    let projectedRevenue = 0;
    for (const stream of this.revenueStreams.values()) {
      if (stream.active) {
        const monthlyRevenue = this.getStreamMonthlyAmount(stream);
        const growthAdjusted = monthlyRevenue * Math.pow(1 + assumptions.revenueGrowth, monthNumber - 1);
        projectedRevenue += growthAdjusted * seasonalFactor;
      }
    }
    
    // Project expenses
    const currentMonthlyBurn = this.calculateBurnRate().monthly;
    const projectedExpenses = currentMonthlyBurn * Math.pow(1 + assumptions.expenseGrowth, monthNumber - 1);
    
    // Project cash flow
    const netCashFlow = projectedRevenue - projectedExpenses;
    
    // Project ending cash
    const startingCash = monthNumber === 1 ? 
      this.treasury.operatingFund + this.treasury.emergencyFund :
      this.getPreviousMonthEndingCash(monthNumber - 1);
    
    const endingCash = startingCash + netCashFlow;
    
    return {
      month: monthNumber,
      projectedRevenue,
      projectedExpenses,
      netCashFlow,
      startingCash,
      endingCash,
      runway: endingCash / projectedExpenses
    };
  }
  
  /**
   * Get monthly amount for a revenue stream
   */
  getStreamMonthlyAmount(stream) {
    switch (stream.frequency) {
      case 'daily':
        return stream.expectedAmount * 30;
      case 'weekly':
        return stream.expectedAmount * 4.33;
      case 'monthly':
        return stream.expectedAmount;
      case 'quarterly':
        return stream.expectedAmount / 3;
      case 'annual':
        return stream.expectedAmount / 12;
      default:
        return stream.expectedAmount;
    }
  }
  
  /**
   * Get previous month ending cash
   */
  getPreviousMonthEndingCash(monthNumber) {
    // This would typically come from the most recent forecast
    // For now, use current cash position
    return this.treasury.operatingFund + this.treasury.emergencyFund;
  }
  
  /**
   * Update revenue forecasts based on actual data
   */
  updateRevenueForecasts() {
    // Analyze recent revenue trends
    const recentRevenue = this.getRecentRevenue(30 * 24 * 60 * 60 * 1000); // Last 30 days
    
    if (recentRevenue.length > 0) {
      const trend = this.calculateRevenueTrend(recentRevenue);
      
      // Adjust forecast assumptions based on trend
      if (trend > 0.1) {
        console.log('[FINANCIAL ENGINE] Revenue trend positive, adjusting forecasts upward');
      } else if (trend < -0.1) {
        console.log('[FINANCIAL ENGINE] Revenue trend negative, adjusting forecasts downward');
        this.triggerRevenueOptimization();
      }
    }
  }
  
  /**
   * Get recent revenue
   */
  getRecentRevenue(timeWindow) {
    const cutoff = Date.now() - timeWindow;
    return this.revenueHistory.filter(revenue => revenue.timestamp >= cutoff);
  }
  
  /**
   * Calculate revenue trend
   */
  calculateRevenueTrend(revenueData) {
    if (revenueData.length < 2) return 0;
    
    // Simple linear regression
    const n = revenueData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    revenueData.forEach((revenue, index) => {
      const x = index;
      const y = revenue.amount;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const averageY = sumY / n;
    
    return slope / averageY; // Normalized trend
  }
  
  /**
   * Trigger revenue optimization
   */
  triggerRevenueOptimization() {
    console.log('[FINANCIAL ENGINE] Triggering revenue optimization automation');
    
    this.emit('revenue_optimization_triggered', {
      reason: 'revenue_decline_detected',
      timestamp: Date.now()
    });
    
    // This would trigger the Revenue Agent to optimize revenue streams
  }
  
  /**
   * Add a funding opportunity
   */
  addFundingOpportunity(type, amount, probability, timeline, metadata = {}) {
    const opportunity = {
      id: uuidv4(),
      type, // 'grant', 'investment', 'loan', etc.
      amount,
      probability, // 0-1
      timeline, // days to decision
      metadata,
      status: 'identified',
      createdAt: Date.now()
    };
    
    this.fundingPipeline.set(opportunity.id, opportunity);
    
    console.log(`[FINANCIAL ENGINE] Added funding opportunity: ${type} - $${amount.toLocaleString()} (${(probability * 100).toFixed(1)}% probability)`);
    
    this.emit('funding_opportunity_added', opportunity);
    
    return opportunity;
  }
  
  /**
   * Update funding opportunity status
   */
  updateFundingOpportunity(opportunityId, status, updateData = {}) {
    const opportunity = this.fundingPipeline.get(opportunityId);
    
    if (!opportunity) {
      throw new Error(`Funding opportunity ${opportunityId} not found`);
    }
    
    opportunity.status = status;
    Object.assign(opportunity, updateData);
    opportunity.lastUpdated = Date.now();
    
    console.log(`[FINANCIAL ENGINE] Updated funding opportunity: ${opportunityId} -> ${status}`);
    
    this.emit('funding_opportunity_updated', opportunity);
    
    // If approved, update treasury
    if (status === 'approved') {
      this.handleFundingApproval(opportunity);
    }
    
    return opportunity;
  }
  
  /**
   * Handle approved funding
   */
  handleFundingApproval(opportunity) {
    const amount = opportunity.amount;
    
    // Update treasury
    this.treasury.totalAssets += amount;
    this.rebalanceTreasury();
    
    console.log(`[FINANCIAL ENGINE] Funding approved: $${amount.toLocaleString()} added to treasury`);
    
    this.emit('funding_approved', opportunity);
  }
  
  /**
   * Rebalance treasury allocations
   */
  rebalanceTreasury() {
    const totalAssets = this.treasury.totalAssets;
    
    // Calculate new allocations
    const newReserveFund = totalAssets * this.config.reserveRequirement;
    const newEmergencyFund = totalAssets * this.config.emergencyBuffer;
    const newInvestmentFund = totalAssets * this.config.investmentAllocation;
    const newOperatingFund = totalAssets - (newReserveFund + newEmergencyFund + newInvestmentFund);
    
    // Update treasury
    this.treasury.reserveFund = newReserveFund;
    this.treasury.emergencyFund = newEmergencyFund;
    this.treasury.investmentFund = newInvestmentFund;
    this.treasury.operatingFund = newOperatingFund;
    
    console.log('[FINANCIAL ENGINE] Treasury rebalanced');
  }
  
  /**
   * Check if budget rebalancing is needed
   */
  checkBudgetRebalancing(budget) {
    const totalSpent = budget.spent;
    const totalBudget = budget.totalAmount;
    const spentPercentage = totalSpent / totalBudget;
    
    // Rebalance if more than 80% spent or if categories are imbalanced
    if (spentPercentage > 0.8) {
      this.triggerBudgetRebalancing(budget);
    }
  }
  
  /**
   * Trigger budget rebalancing
   */
  triggerBudgetRebalancing(budget) {
    console.log(`[FINANCIAL ENGINE] Triggering budget rebalancing for: ${budget.name}`);
    
    // Calculate new allocations based on remaining budget and priorities
    const remainingBudget = budget.remaining;
    const newAllocations = this.calculateDynamicAllocations(
      remainingBudget,
      Object.entries(budget.allocations).map(([name, allocation]) => ({
        name,
        type: 'percentage',
        percentage: (allocation.allocated / budget.totalAmount) * 100
      })),
      budget.priorities
    );
    
    // Update budget allocations
    Object.keys(budget.allocations).forEach(category => {
      if (newAllocations[category]) {
        budget.allocations[category] = {
          ...budget.allocations[category],
          allocated: budget.allocations[category].allocated + newAllocations[category].allocated,
          remaining: budget.allocations[category].remaining + newAllocations[category].allocated
        };
      }
    });
    
    budget.lastRebalanced = Date.now();
    
    this.emit('budget_rebalanced', budget);
  }
  
  /**
   * Start background processes
   */
  startBackgroundProcesses() {
    // Periodic rebalancing
    setInterval(() => {
      this.performPeriodicRebalancing();
    }, this.config.rebalanceFrequency);
    
    // Metrics calculation
    setInterval(() => {
      this.updateMetrics();
    }, 60 * 1000); // Every minute
    
    // Alert checking
    setInterval(() => {
      this.checkAlerts();
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('[FINANCIAL ENGINE] Background processes started');
  }
  
  /**
   * Perform periodic rebalancing
   */
  performPeriodicRebalancing() {
    console.log('[FINANCIAL ENGINE] Performing periodic rebalancing');
    
    // Rebalance treasury
    this.rebalanceTreasury();
    
    // Check all budgets for rebalancing
    for (const budget of this.budgets.values()) {
      this.checkBudgetRebalancing(budget);
    }
    
    // Generate new forecast
    this.generateCashFlowForecast();
    
    this.emit('periodic_rebalancing_completed', {
      timestamp: Date.now()
    });
  }
  
  /**
   * Update financial metrics
   */
  updateMetrics() {
    // Calculate current metrics
    this.calculateBurnRate();
    this.calculateRunway();
    
    // Update cash position
    this.metrics.cashPosition = this.treasury.operatingFund + this.treasury.emergencyFund;
    
    // Calculate ROI (simplified)
    if (this.metrics.totalExpenses > 0) {
      this.metrics.roi = (this.metrics.netIncome / this.metrics.totalExpenses) * 100;
    }
    
    this.emit('metrics_updated', this.metrics);
  }
  
  /**
   * Check for alerts
   */
  checkAlerts() {
    const alerts = [];
    
    // Low cash alert
    if (this.metrics.cashPosition < this.treasury.totalAssets * this.config.alertThresholds.lowCash) {
      alerts.push({
        type: 'low_cash',
        severity: 'high',
        message: `Cash position $${this.metrics.cashPosition.toLocaleString()} below threshold`,
        recommendation: 'Reduce expenses or secure additional funding'
      });
    }
    
    // High burn rate alert
    const projectedBurn = this.calculateBurnRate().monthly;
    const currentBurn = this.metrics.burnRate;
    
    if (currentBurn > projectedBurn * 1.15) {
      alerts.push({
        type: 'high_burn_rate',
        severity: 'medium',
        message: `Burn rate $${currentBurn.toLocaleString()} exceeds projection by ${((currentBurn / projectedBurn - 1) * 100).toFixed(1)}%`,
        recommendation: 'Review and reduce discretionary expenses'
      });
    }
    
    // Low runway alert
    if (this.metrics.runway < 3) {
      alerts.push({
        type: 'low_runway',
        severity: 'critical',
        message: `Runway ${this.metrics.runway.toFixed(1)} months below safe threshold`,
        recommendation: 'Immediate action required to extend runway'
      });
    }
    
    // Emit alerts
    alerts.forEach(alert => {
      this.emit('financial_alert', alert);
    });
    
    this.alerts = alerts;
  }
  
  /**
   * Get comprehensive financial status
   */
  getFinancialStatus() {
    return {
      treasury: this.treasury,
      budgets: Array.from(this.budgets.values()),
      revenueStreams: Array.from(this.revenueStreams.values()),
      fundingPipeline: Array.from(this.fundingPipeline.values()),
      metrics: this.metrics,
      forecasts: Array.from(this.forecasts.values()).slice(-3), // Last 3 forecasts
      alerts: this.alerts,
      automationRules: Array.from(this.automationRules.values()).filter(rule => rule.enabled)
    };
  }
  
  /**
   * Get budget summary
   */
  getBudgetSummary(budgetId) {
    const budget = this.budgets.get(budgetId);
    
    if (!budget) {
      throw new Error(`Budget ${budgetId} not found`);
    }
    
    return {
      ...budget,
      expenses: this.expenses.get(budgetId) || [],
      utilizationRate: (budget.spent / budget.totalAmount) * 100,
      remainingDays: Math.floor(budget.remaining / (this.calculateBurnRate().monthly / 30))
    };
  }
  
  /**
   * Get revenue analysis
   */
  getRevenueAnalysis(timeWindow = 90 * 24 * 60 * 60 * 1000) {
    const recentRevenue = this.getRecentRevenue(timeWindow);
    
    return {
      totalRevenue: recentRevenue.reduce((sum, r) => sum + r.amount, 0),
      streamBreakdown: this.getRevenueByStream(recentRevenue),
      trend: this.calculateRevenueTrend(recentRevenue),
      growthRate: this.calculateGrowthRate(recentRevenue),
      projections: this.getLatestForecast()
    };
  }
  
  /**
   * Get revenue breakdown by stream
   */
  getRevenueByStream(revenueData) {
    const breakdown = {};
    
    for (const stream of this.revenueStreams.values()) {
      const streamRevenue = revenueData.filter(r => r.streamId === stream.id);
      breakdown[stream.name] = {
        total: streamRevenue.reduce((sum, r) => sum + r.amount, 0),
        count: streamRevenue.length,
        average: streamRevenue.length > 0 ? streamRevenue.reduce((sum, r) => sum + r.amount, 0) / streamRevenue.length : 0
      };
    }
    
    return breakdown;
  }
  
  /**
   * Calculate growth rate
   */
  calculateGrowthRate(revenueData) {
    if (revenueData.length < 2) return 0;
    
    // Sort by timestamp
    const sorted = revenueData.sort((a, b) => a.timestamp - b.timestamp);
    
    const firstPeriod = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondPeriod = sorted.slice(Math.floor(sorted.length / 2));
    
    const firstTotal = firstPeriod.reduce((sum, r) => sum + r.amount, 0);
    const secondTotal = secondPeriod.reduce((sum, r) => sum + r.amount, 0);
    
    return ((secondTotal - firstTotal) / firstTotal) * 100;
  }
  
  /**
   * Get latest forecast
   */
  getLatestForecast() {
    const forecasts = Array.from(this.forecasts.values());
    
    if (forecasts.length === 0) return null;
    
    return forecasts.sort((a, b) => b.generatedAt - a.generatedAt)[0];
  }
  
  /**
   * Execute automation rule
   */
  async executeAutomationRule(ruleId, context = {}) {
    const rule = this.automationRules.get(ruleId);
    
    if (!rule || !rule.enabled) {
      throw new Error(`Automation rule ${ruleId} not found or disabled`);
    }
    
    console.log(`[FINANCIAL ENGINE] Executing automation rule: ${rule.name}`);
    
    let result;
    
    switch (rule.action) {
      case 'rebalance_funds':
        result = await this.rebalanceFunds();
        break;
      
      case 'send_alert_and_reduce_expenses':
        result = await this.sendAlertAndReduceExpenses();
        break;
      
      case 'analyze_and_optimize_revenue_streams':
        result = await this.analyzeAndOptimizeRevenueStreams();
        break;
      
      case 'rebalance_investment_portfolio':
        result = await this.rebalanceInvestmentPortfolio();
        break;
      
      default:
        throw new Error(`Unknown automation action: ${rule.action}`);
    }
    
    this.emit('automation_executed', {
      ruleId,
      ruleName: rule.name,
      result,
      timestamp: Date.now()
    });
    
    return result;
  }
  
  /**
   * Rebalance funds
   */
  async rebalanceFunds() {
    this.rebalanceTreasury();
    
    return {
      action: 'funds_rebalanced',
      treasury: this.treasury,
      timestamp: Date.now()
    };
  }
  
  /**
   * Send alert and reduce expenses
   */
  async sendAlertAndReduceExpenses() {
    // This would integrate with alerting systems and expense management
    console.log('[FINANCIAL ENGINE] Sending burn rate alert and reducing expenses');
    
    return {
      action: 'expenses_reduced',
      reductionAmount: this.calculateBurnRate().monthly * 0.1, // 10% reduction
      timestamp: Date.now()
    };
  }
  
  /**
   * Analyze and optimize revenue streams
   */
  async analyzeAndOptimizeRevenueStreams() {
    const analysis = this.getRevenueAnalysis();
    
    // Identify underperforming streams
    const underperforming = [];
    
    for (const stream of this.revenueStreams.values()) {
      const streamRevenue = this.getRevenueByStream(this.getRecentRevenue());
      const performance = streamRevenue[stream.name];
      
      if (performance && performance.total < stream.expectedAmount * 0.8) {
        underperforming.push({
          streamId: stream.id,
          streamName: stream.name,
          expected: stream.expectedAmount,
          actual: performance.total,
          gap: stream.expectedAmount - performance.total
        });
      }
    }
    
    return {
      action: 'revenue_optimization',
      analysis,
      underperformingStreams: underperforming,
      recommendations: this.generateRevenueRecommendations(underperforming),
      timestamp: Date.now()
    };
  }
  
  /**
   * Generate revenue recommendations
   */
  generateRevenueRecommendations(underperforming) {
    return underperforming.map(stream => ({
      streamId: stream.streamId,
      recommendation: 'Increase marketing efforts or adjust pricing',
      potentialImprovement: stream.gap * 0.5, // Assume 50% recovery
      priority: 'high'
    }));
  }
  
  /**
   * Rebalance investment portfolio
   */
  async rebalanceInvestmentPortfolio() {
    // Simplified investment rebalancing
    const targetAllocation = {
      'stocks': 0.6,
      'bonds': 0.3,
      'alternatives': 0.1
    };
    
    // This would integrate with actual investment management systems
    console.log('[FINANCIAL ENGINE] Rebalancing investment portfolio');
    
    return {
      action: 'portfolio_rebalanced',
      targetAllocation,
      currentValue: this.treasury.investmentFund,
      timestamp: Date.now()
    };
  }
}

module.exports = ProtoForgeFinancialEngine;
