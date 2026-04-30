/**
 * FINANCE AGENT - ProtoForge Business Layer
 * 
 * Focus: Cash flow management, budgeting, forecasting
 * Constraints: Prevent overspending, maintain runway
 * Output: Financial reports, alerts, budget adjustments
 */

import { BaseAgent } from '../base.agent';

export interface FinancialSystem {
  id: string;
  name: string;
  treasury: Treasury;
  budgets: Map<string, Budget>;
  cashFlow: CashFlow;
  forecasts: Map<string, Forecast>;
  alerts: FinancialAlert[];
  metrics: FinancialMetrics;
  controls: FinancialControls;
}

export interface Treasury {
  totalAssets: number;
  cashOnHand: number;
  reserveFund: number;
  emergencyFund: number;
  operatingFund: number;
  investmentFund: number;
  accounts: Map<string, Account>;
  lastUpdated: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'investment' | 'reserve' | 'emergency';
  balance: number;
  currency: string;
  interestRate: number;
  minimumBalance: number;
  transactionHistory: Transaction[];
  accountNumber: string;
  bankName: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  amount: number;
  description: string;
  category: string;
  timestamp: string;
  reference: string;
  status: 'pending' | 'completed' | 'failed';
  metadata: any;
}

export interface Budget {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual' | 'project';
  totalAmount: number;
  allocatedAmount: number;
  spentAmount: number;
  remainingAmount: number;
  categories: Map<string, BudgetCategory>;
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'suspended';
  alerts: BudgetAlert[];
}

export interface BudgetCategory {
  name: string;
  allocatedAmount: number;
  spentAmount: number;
  remainingAmount: number;
  percentage: number;
  transactions: Transaction[];
  alerts: CategoryAlert[];
}

export interface CashFlow {
  inflows: CashFlowItem[];
  outflows: CashFlowItem[];
  netFlow: number;
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  startDate: string;
  endDate: string;
  trends: CashFlowTrend[];
}

export interface CashFlowItem {
  source: string;
  amount: number;
  category: string;
  timestamp: string;
  description: string;
  recurring: boolean;
  frequency?: string;
}

export interface CashFlowTrend {
  period: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  growthRate: number;
  prediction: number;
}

export interface Forecast {
  id: string;
  type: 'cash_flow' | 'revenue' | 'expenses' | 'runway';
  period: string;
  horizon: number; // days
  confidence: number;
  predictions: ForecastPoint[];
  assumptions: ForecastAssumption[];
  scenarios: ForecastScenario[];
  lastUpdated: string;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  actual?: number;
  confidence: number;
  upperBound: number;
  lowerBound: number;
}

export interface ForecastAssumption {
  name: string;
  value: any;
  source: string;
  reliability: 'high' | 'medium' | 'low';
}

export interface ForecastScenario {
  name: string;
  description: string;
  probability: number;
  adjustments: any;
  results: ForecastPoint[];
}

export interface FinancialAlert {
  id: string;
  type: 'runway' | 'budget' | 'cash_flow' | 'expense' | 'revenue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: string;
  resolved: boolean;
  actionRequired: boolean;
  recommendedActions: string[];
  data: any;
}

export interface BudgetAlert {
  type: 'overbudget' | 'near_limit' | 'underutilized';
  category: string;
  percentage: number;
  amount: number;
  threshold: number;
}

export interface CategoryAlert {
  type: 'overbudget' | 'near_limit' | 'underutilized';
  percentage: number;
  amount: number;
  threshold: number;
}

export interface FinancialMetrics {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  burnRate: number;
  runway: number;
  cashPosition: number;
  budgetUtilization: number;
  revenueGrowthRate: number;
  expenseGrowthRate: number;
  profitMargin: number;
  operatingMargin: number;
  cashFlowMargin: number;
}

export interface FinancialControls {
  spendingLimits: Map<string, SpendingLimit>;
  approvalThresholds: Map<string, number>;
  reserveRequirements: ReserveRequirement;
  alertThresholds: AlertThreshold;
  budgetLocks: BudgetLock[];
  autoAdjustments: AutoAdjustment[];
}

export interface SpendingLimit {
  category: string;
  limit: number;
  period: 'daily' | 'weekly' | 'monthly';
  currentSpend: number;
  remainingSpend: number;
  alerts: boolean;
}

export interface ReserveRequirement {
  emergencyFundRatio: number; // percentage of monthly expenses
  operatingFundRatio: number; // percentage of monthly expenses
  minimumCashBalance: number;
  reserveTarget: number;
}

export interface AlertThreshold {
  runwayCritical: number; // days
  runwayWarning: number; // days
  budgetExceedance: number; // percentage
  cashFlowDeficit: number; // amount
  reserveDepletion: number; // percentage
}

export interface BudgetLock {
  budgetId: string;
  reason: string;
  lockedBy: string;
  timestamp: string;
  unlockDate?: string;
}

export interface AutoAdjustment {
  type: 'reallocate' | 'freeze' | 'alert' | 'escalate';
  trigger: string;
  condition: any;
  action: any;
  enabled: boolean;
}

export class FinanceAgent extends BaseAgent {
  private financialSystems: Map<string, FinancialSystem> = new Map();
  private treasury: Treasury = {
    totalAssets: 1000000,
    cashOnHand: 800000,
    reserveFund: 150000,
    emergencyFund: 100000,
    operatingFund: 300000,
    investmentFund: 250000,
    accounts: new Map(),
    lastUpdated: new Date().toISOString()
  };
  private budgets: Map<string, Budget> = new Map();
  private cashFlow: CashFlow = {
    inflows: [],
    outflows: [],
    netFlow: 0,
    period: 'monthly',
    startDate: '',
    endDate: '',
    trends: []
  };
  private forecasts: Map<string, Forecast> = new Map();
  private alerts: FinancialAlert[] = [];
  private controls: FinancialControls = {
    spendingLimits: new Map(),
    approvalThresholds: new Map([
      ['large_expense', 10000],
      ['capital_expenditure', 50000],
      ['emergency_expense', 1000]
    ]),
    reserveRequirements: {
      emergencyFundRatio: 0.15,
      operatingFundRatio: 0.45,
      minimumCashBalance: 50000,
      reserveTarget: 250000
    },
    alertThresholds: {
      runwayCritical: 30,
      runwayWarning: 60,
      budgetExceedance: 0.9,
      cashFlowDeficit: 10000,
      reserveDepletion: 0.8
    },
    budgetLocks: [],
    autoAdjustments: []
  };
  private metrics: FinancialMetrics = {
    totalRevenue: 0,
    totalExpenses: 0,
    netIncome: 0,
    burnRate: 0,
    runway: 0,
    cashPosition: 800000,
    budgetUtilization: 0,
    revenueGrowthRate: 0,
    expenseGrowthRate: 0,
    profitMargin: 0,
    operatingMargin: 0,
    cashFlowMargin: 0
  };

  constructor() {
    super('finance_agent', [
      'cash_flow_management',
      'budget_allocation',
      'financial_forecasting',
      'expense_monitoring',
      'runway_tracking',
      'financial_reporting',
      'spending_controls',
      'revenue_tracking'
    ]);
    
    this.initializeFinancialSystem();
    this.setupFinancialControls();
  }

  /**
   * Initialize the financial system
   */
  private initializeFinancialSystem(): void {
    console.log('[Finance Agent] Initializing financial management system');
    
    // Initialize treasury
    this.treasury = {
      totalAssets: 1000000, // $1M starting capital
      cashOnHand: 800000,
      reserveFund: 150000,
      emergencyFund: 100000,
      operatingFund: 300000,
      investmentFund: 250000,
      accounts: new Map(),
      lastUpdated: new Date().toISOString()
    };
    
    // Initialize default accounts
    this.initializeAccounts();
    
    // Initialize controls
    this.controls = {
      spendingLimits: new Map(),
      approvalThresholds: new Map([
        ['large_expense', 10000],
        ['capital_expenditure', 50000],
        ['emergency_expense', 1000]
      ]),
      reserveRequirements: {
        emergencyFundRatio: 0.15, // 15% of monthly expenses
        operatingFundRatio: 0.45, // 45% of monthly expenses
        minimumCashBalance: 50000,
        reserveTarget: 250000
      },
      alertThresholds: {
        runwayCritical: 30,
        runwayWarning: 60,
        budgetExceedance: 0.9,
        cashFlowDeficit: 10000,
        reserveDepletion: 0.8
      },
      budgetLocks: [],
      autoAdjustments: []
    };
    
    // Initialize metrics
    this.metrics = {
      totalRevenue: 0,
      totalExpenses: 0,
      netIncome: 0,
      burnRate: 0,
      runway: 0,
      cashPosition: this.treasury.cashOnHand,
      budgetUtilization: 0,
      revenueGrowthRate: 0,
      expenseGrowthRate: 0,
      profitMargin: 0,
      operatingMargin: 0,
      cashFlowMargin: 0
    };
    
    console.log('[Finance Agent] Financial system initialized');
  }

  /**
   * Initialize default accounts
   */
  private initializeAccounts(): void {
    const defaultAccounts: Account[] = [
      {
        id: 'main_checking',
        name: 'Main Checking Account',
        type: 'checking',
        balance: 500000,
        currency: 'USD',
        interestRate: 0.01,
        minimumBalance: 10000,
        transactionHistory: [],
        accountNumber: '123456789',
        bankName: 'ProtoForge Bank'
      },
      {
        id: 'reserve_savings',
        name: 'Reserve Savings',
        type: 'savings',
        balance: 150000,
        currency: 'USD',
        interestRate: 0.025,
        minimumBalance: 1000,
        transactionHistory: [],
        accountNumber: '987654321',
        bankName: 'ProtoForge Bank'
      },
      {
        id: 'emergency_fund',
        name: 'Emergency Fund',
        type: 'reserve',
        balance: 100000,
        currency: 'USD',
        interestRate: 0.02,
        minimumBalance: 50000,
        transactionHistory: [],
        accountNumber: '456789012',
        bankName: 'ProtoForge Bank'
      },
      {
        id: 'investment_account',
        name: 'Investment Account',
        type: 'investment',
        balance: 250000,
        currency: 'USD',
        interestRate: 0.05,
        minimumBalance: 0,
        transactionHistory: [],
        accountNumber: '789012345',
        bankName: 'ProtoForge Investments'
      }
    ];
    
    defaultAccounts.forEach(account => {
      this.treasury.accounts.set(account.id, account);
    });
  }

  /**
   * Setup financial controls
   */
  private setupFinancialControls(): void {
    console.log('[Finance Agent] Setting up financial controls');
    
    // Set spending limits
    this.controls.spendingLimits.set('operations', {
      category: 'operations',
      limit: 50000,
      period: 'monthly',
      currentSpend: 0,
      remainingSpend: 50000,
      alerts: true
    });
    
    this.controls.spendingLimits.set('marketing', {
      category: 'marketing',
      limit: 15000,
      period: 'monthly',
      currentSpend: 0,
      remainingSpend: 15000,
      alerts: true
    });
    
    this.controls.spendingLimits.set('development', {
      category: 'development',
      limit: 30000,
      period: 'monthly',
      currentSpend: 0,
      remainingSpend: 30000,
      alerts: true
    });
    
    // Set up auto-adjustments
    this.controls.autoAdjustments = [
      {
        type: 'alert',
        trigger: 'runway_below_threshold',
        condition: { threshold: 60 },
        action: { type: 'escalate', priority: 'high' },
        enabled: true
      },
      {
        type: 'alert',
        trigger: 'budget_exceeds_90_percent',
        condition: {},
        action: { type: 'freeze', duration: '7_days' },
        enabled: true
      },
      {
        type: 'alert',
        trigger: 'reserve_below_target',
        condition: { target_ratio: 0.8 },
        action: { type: 'reallocate', from: 'investment', to: 'reserve' },
        enabled: true
      }
    ];
  }

  /**
   * Handle incoming events
   */
  async handle_event(event: any): Promise<void> {
    console.log(`[Finance Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'EXPENSE_APPROVED':
        await this.handleExpenseApproved(event);
        break;
      case 'REVENUE_RECEIVED':
        await this.handleRevenueReceived(event);
        break;
      case 'BUDGET_REQUEST':
        await this.handleBudgetRequest(event);
        break;
      case 'FINANCIAL_STATUS_REQUEST':
        await this.handleFinancialStatusRequest(event);
        break;
      case 'FORECAST_REQUEST':
        await this.handleForecastRequest(event);
        break;
      case 'SPENDING_LIMIT_UPDATE':
        await this.handleSpendingLimitUpdate(event);
        break;
      case 'RESERVE_ADJUSTMENT':
        await this.handleReserveAdjustment(event);
        break;
      default:
        console.log(`[Finance Agent] Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Handle approved expense
   */
  private async handleExpenseApproved(event: any): Promise<void> {
    console.log('[Finance Agent] Processing approved expense');
    
    const { amount, category, description, account_id, metadata } = event.payload;
    
    // Check spending limits
    const spendingLimit = this.controls.spendingLimits.get(category);
    if (spendingLimit) {
      if (spendingLimit.currentSpend + amount > spendingLimit.limit) {
        await this.triggerSpendingLimitAlert(spendingLimit, amount, category);
        return; // Block the expense
      }
    }
    
    // Check approval thresholds
    const approvalThreshold = this.controls.approvalThresholds.get('large_expense') || 10000;
    if (amount > approvalThreshold) {
      await this.triggerHighValueAlert(amount, category);
    }
    
    // Process the expense
    await this.processExpense(amount, category, description, account_id, metadata);
    
    // Update metrics
    this.updateMetrics();
    
    // Check for alerts
    await this.checkFinancialAlerts();
    
    console.log(`[Finance Agent] Expense processed: $${amount} for ${category}`);
  }

  /**
   * Process expense transaction
   */
  private async processExpense(amount: number, category: string, description: string, accountId: string, metadata: any): Promise<void> {
    const transaction: Transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      accountId,
      type: 'withdrawal',
      amount,
      description,
      category,
      timestamp: new Date().toISOString(),
      reference: metadata?.reference || '',
      status: 'completed',
      metadata
    };
    
    // Update account balance
    const account = this.treasury.accounts.get(accountId);
    if (account) {
      account.balance -= amount;
      account.transactionHistory.push(transaction);
    }
    
    // Update treasury
    this.treasury.cashOnHand -= amount;
    this.treasury.totalAssets -= amount;
    
    // Update spending limit
    const spendingLimit = this.controls.spendingLimits.get(category);
    if (spendingLimit) {
      spendingLimit.currentSpend += amount;
      spendingLimit.remainingSpend = spendingLimit.limit - spendingLimit.currentSpend;
    }
    
    // Update metrics
    this.metrics.totalExpenses += amount;
    this.metrics.netIncome = this.metrics.totalRevenue - this.metrics.totalExpenses;
    this.metrics.cashPosition = this.treasury.cashOnHand;
    
    // Emit financial update
    this.emit_event('FINANCIAL_UPDATE', {
      type: 'expense_processed',
      amount,
      category,
      description,
      account_balance: account?.balance,
      cash_position: this.treasury.cashOnHand,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  /**
   * Handle revenue received
   */
  private async handleRevenueReceived(event: any): Promise<void> {
    console.log('[Finance Agent] Processing revenue received');
    
    const { amount, source, category, account_id, metadata } = event.payload;
    
    // Process the revenue transaction
    const transaction: Transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      accountId: account_id || 'main_checking',
      type: 'deposit',
      amount,
      description: `Revenue from ${source}`,
      category: category || 'revenue',
      timestamp: new Date().toISOString(),
      reference: metadata?.reference || '',
      status: 'completed',
      metadata
    };
    
    // Update account balance
    const account = this.treasury.accounts.get(account_id || 'main_checking');
    if (account) {
      account.balance += amount;
      account.transactionHistory.push(transaction);
    }
    
    // Update treasury
    this.treasury.cashOnHand += amount;
    this.treasury.totalAssets += amount;
    
    // Update metrics
    this.metrics.totalRevenue += amount;
    this.metrics.netIncome = this.metrics.totalRevenue - this.metrics.totalExpenses;
    this.metrics.cashPosition = this.treasury.cashOnHand;
    
    // Recalculate runway
    this.metrics.runway = this.calculateRunway();
    
    // Check for positive runway changes
    if (this.metrics.runway > this.controls.alertThresholds.runwayWarning) {
      await this.resolveRunwayAlerts();
    }
    
    // Update forecasts
    await this.updateForecasts();
    
    console.log(`[Finance Agent] Revenue processed: $${amount} from ${source}`);
  }

  /**
   * Handle budget request
   */
  private async handleBudgetRequest(event: any): Promise<void> {
    console.log('[Finance Agent] Processing budget request');
    
    const { budgetId, name, period, totalAmount, categories, startDate, endDate } = event.payload;
    
    // Check if budget already exists
    if (this.budgets.has(budgetId)) {
      throw new Error(`Budget ${budgetId} already exists`);
    }
    
    // Create budget
    const budget: Budget = {
      id: budgetId,
      name,
      period,
      totalAmount,
      allocatedAmount: totalAmount,
      spentAmount: 0,
      remainingAmount: totalAmount,
      categories: new Map(),
      startDate,
      endDate,
      status: 'active',
      alerts: []
    };
    
    // Create budget categories
    categories.forEach((cat: any) => {
      budget.categories.set(cat.name, {
        name: cat.name,
        allocatedAmount: cat.amount,
        spentAmount: 0,
        remainingAmount: cat.amount,
        percentage: (cat.amount / totalAmount) * 100,
        transactions: [],
        alerts: []
      });
    });
    
    // Store budget
    this.budgets.set(budgetId, budget);
    
    // Emit budget created event
    this.emit_event('BUDGET_CREATED', {
      budgetId,
      name,
      period,
      totalAmount,
      categories: Array.from(budget.categories.entries()),
      status: 'active',
      created_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
    
    console.log(`[Finance Agent] Budget created: ${name} ($${totalAmount})`);
  }

  /**
   * Handle financial status request
   */
  private async handleFinancialStatusRequest(event: any): Promise<void> {
    console.log('[Finance Agent] Generating financial status report');
    
    const status = {
      treasury: this.treasury,
      budgets: Array.from(this.budgets.values()),
      cashFlow: this.cashFlow,
      forecasts: Array.from(this.forecasts.values()),
      metrics: this.metrics,
      controls: this.controls,
      alerts: this.alerts,
      runway: this.metrics.runway,
      burnRate: this.metrics.burnRate,
      timestamp: new Date().toISOString()
    };
    
    this.emit_event('FINANCIAL_STATUS_REPORT', {
      status,
      generated_by: this.id,
      timestamp: new Date().toISOString()
    }, event.source || 'broadcast', 'medium');
    
    console.log('[Finance Agent] Financial status report generated');
  }

  /**
   * Handle forecast request
   */
  private async handleForecastRequest(event: any): Promise<void> {
    console.log('[Finance Agent] Generating financial forecast');
    
    const { type, horizon, confidence } = event.payload;
    
    const forecast = await this.generateForecast(type, horizon, confidence);
    
    this.forecasts.set(forecast.id, forecast);
    
    this.emit_event('FINANCIAL_FORECAST', {
      forecast,
      generated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
    
    console.log(`[Finance Agent] ${type} forecast generated for ${horizon} days`);
  }

  /**
   * Generate financial forecast
   */
  private async generateForecast(type: string, horizon: number, confidence: number): Promise<Forecast> {
    const forecastId = `forecast_${type}_${Date.now()}`;
    
    const predictions: ForecastPoint[] = [];
    const assumptions: ForecastAssumption[] = [];
    
    // Generate assumptions based on historical data
    if (type === 'cash_flow') {
      assumptions.push(
        { name: 'monthly_expenses', value: this.metrics.totalExpenses, source: 'historical', reliability: 'high' },
        { name: 'monthly_revenue', value: this.metrics.totalRevenue, source: 'historical', reliability: 'medium' },
        { name: 'seasonal_adjustment', value: 1.1, source: 'seasonal_trends', reliability: 'medium' }
      );
      
      // Generate predictions
      for (let day = 1; day <= horizon; day++) {
        const date = new Date(Date.now() + day * 24 * 60 * 60 * 1000);
        const predicted = this.predictCashFlow(date, assumptions);
        
        predictions.push({
          date: date.toISOString(),
          predicted: predicted,
          confidence: confidence * (1 - day / horizon), // Decreasing confidence
          upperBound: predicted * 1.2,
          lowerBound: predicted * 0.8
        });
      }
    } else if (type === 'runway') {
      assumptions.push(
        { name: 'current_burn_rate', value: this.metrics.burnRate, source: 'current', reliability: 'high' },
        { name: 'cash_position', value: this.metrics.cashPosition, source: 'current', reliability: 'high' }
      );
      
      for (let day = 1; day <= horizon; day++) {
        const date = new Date(Date.now() + day * 24 * 60 * 60 * 1000);
        const predicted = this.predictRunway(date, assumptions);
        
        predictions.push({
          date: date.toISOString(),
          predicted,
          confidence: confidence,
          upperBound: predicted * 1.5,
          lowerBound: predicted * 0.5
        });
      }
    }
    
    return {
      id: forecastId,
      type: type as any,
      period: 'daily',
      horizon,
      confidence,
      predictions,
      assumptions,
      scenarios: [],
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Predict cash flow for a specific date
   */
  private predictCashFlow(date: Date, assumptions: ForecastAssumption[]): number {
    const monthlyExpenses = assumptions.find(a => a.name === 'monthly_expenses')?.value || 0;
    const monthlyRevenue = assumptions.find(a => a.name === 'monthly_revenue')?.value || 0;
    const seasonalAdjustment = assumptions.find(a => a.name === 'seasonal_adjustment')?.value || 1;
    
    // Simplified prediction
    const dailyRevenue = (monthlyRevenue / 30) * seasonalAdjustment;
    const dailyExpenses = monthlyExpenses / 30;
    
    return dailyRevenue - dailyExpenses;
  }

  /**
   * Predict runway for a specific date
   */
  private predictRunway(date: Date, assumptions: ForecastAssumption[]): number {
    const burnRate = assumptions.find(a => a.name === 'current_burn_rate')?.value || 0;
    const cashPosition = assumptions.find(a => a.name === 'cash_position')?.value || 0;
    
    const daysElapsed = (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    
    return Math.max(0, cashPosition - (burnRate * daysElapsed));
  }

  /**
   * Handle spending limit update
   */
  private async handleSpendingLimitUpdate(event: any): Promise<void> {
    console.log('[Finance Agent] Updating spending limits');
    
    const { category, limit, period } = event.payload;
    
    const spendingLimit = this.controls.spendingLimits.get(category);
    if (spendingLimit) {
      spendingLimit.limit = limit;
      spendingLimit.period = period;
      spendingLimit.remainingSpend = limit - spendingLimit.currentSpend;
      
      this.emit_event('SPENDING_LIMIT_UPDATED', {
        category,
        limit,
        period,
        currentSpend: spendingLimit.currentSpend,
        remainingSpend: spendingLimit.remainingSpend,
        updated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    }
  }

  /**
   * Handle reserve adjustment
   */
  private async handleReserveAdjustment(event: any): Promise<void> {
    console.log('[Finance Agent] Adjusting reserves');
    
    const { type, amount, reason } = event.payload;
    
    if (type === 'emergency_fund') {
      this.treasury.emergencyFund += amount;
      this.treasury.cashOnHand -= amount;
    } else if (type === 'reserve_fund') {
      this.treasury.reserveFund += amount;
      this.treasury.cashOnHand -= amount;
    } else if (type === 'investment_fund') {
      this.treasury.investmentFund += amount;
      this.treasury.cashOnHand -= amount;
    }
    
    this.treasury.lastUpdated = new Date().toISOString();
    
    this.emit_event('RESERVE_ADJUSTED', {
      type,
      amount,
      reason,
      new_balances: {
        emergency_fund: this.treasury.emergencyFund,
        reserve_fund: this.treasury.reserveFund,
        investment_fund: this.treasury.investmentFund,
        cash_on_hand: this.treasury.cashOnHand
      },
      adjusted_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  /**
   * Update financial metrics
   */
  private updateMetrics(): void {
    // Calculate burn rate
    this.metrics.burnRate = this.calculateBurnRate();
    
    // Calculate runway
    this.metrics.runway = this.calculateRunway();
    
    // Calculate budget utilization
    this.metrics.budgetUtilization = this.calculateBudgetUtilization();
    
    // Calculate growth rates
    this.metrics.revenueGrowthRate = this.calculateGrowthRate('revenue');
    this.metrics.expenseGrowthRate = this.calculateGrowthRate('expenses');
    
    // Calculate margins
    if (this.metrics.totalRevenue > 0) {
      this.metrics.profitMargin = (this.metrics.netIncome / this.metrics.totalRevenue) * 100;
      this.metrics.operatingMargin = ((this.metrics.totalRevenue - this.metrics.totalExpenses * 0.8) / this.metrics.totalRevenue) * 100;
    }
    
    if (this.metrics.totalRevenue + this.metrics.totalExpenses > 0) {
      this.metrics.cashFlowMargin = ((this.metrics.totalRevenue - this.metrics.totalExpenses) / (this.metrics.totalRevenue + this.metrics.totalExpenses)) * 100;
    }
  }

  /**
   * Calculate burn rate
   */
  private calculateBurnRate(): number {
    // Simplified burn rate calculation
    return this.metrics.totalExpenses / 30; // Monthly expenses / 30 days
  }

  /**
   * Calculate runway
   */
  private calculateRunway(): number {
    if (this.metrics.burnRate <= 0) return 999; // Infinite runway
    
    return Math.floor(this.treasury.cashOnHand / this.metrics.burnRate);
  }

  /**
   * Calculate budget utilization
   */
  private calculateBudgetUtilization(): number {
    let totalAllocated = 0;
    let totalSpent = 0;
    
    for (const budget of this.budgets.values()) {
      totalAllocated += budget.allocatedAmount;
      totalSpent += budget.spentAmount;
    }
    
    return totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
  }

  /**
   * Calculate growth rate
   */
  private calculateGrowthRate(type: 'revenue' | 'expenses'): number {
    // Simplified growth rate calculation
    // In a real system, this would use historical data
    return type === 'revenue' ? 0.15 : 0.05; // 15% revenue growth, 5% expense growth
  }

  /**
   * Check for financial alerts
   */
  private async checkFinancialAlerts(): Promise<void> {
    const alerts: FinancialAlert[] = [];
    
    // Check runway
    if (this.metrics.runway < this.controls.alertThresholds.runwayCritical) {
      alerts.push({
        id: `runway_critical_${Date.now()}`,
        type: 'runway',
        severity: 'critical',
        title: 'Critical Runway Alert',
        message: `Runway is ${this.metrics.runway} days - immediate action required`,
        timestamp: new Date().toISOString(),
        resolved: false,
        actionRequired: true,
        recommendedActions: [
          'Seek immediate funding',
          'Reduce non-essential expenses',
          'Consider emergency measures'
        ],
        data: { runway: this.metrics.runway, burnRate: this.metrics.burnRate }
      });
    } else if (this.metrics.runway < this.controls.alertThresholds.runwayWarning) {
      alerts.push({
        id: `runway_warning_${Date.now()}`,
        type: 'runway',
        severity: 'high',
        title: 'Runway Warning',
        message: `Runway is ${this.metrics.runway} days - monitor closely`,
        timestamp: new Date().toISOString(),
        resolved: false,
        actionRequired: true,
        recommendedActions: [
          'Monitor spending trends',
          'Plan funding strategies',
          'Review budget allocations'
        ],
        data: { runway: this.metrics.runway, burnRate: this.metrics.burnRate }
      });
    }
    
    // Check cash position
    if (this.treasury.cashOnHand < this.controls.reserveRequirements.minimumCashBalance) {
      alerts.push({
        id: `cash_critical_${Date.now()}`,
        type: 'cash_flow',
        severity: 'critical',
        title: 'Critical Cash Position',
        message: `Cash balance $${this.treasury.cashOnHand} below minimum $${this.controls.reserveRequirements.minimumCashBalance}`,
        timestamp: new Date().toISOString(),
        resolved: false,
        actionRequired: true,
        recommendedActions: [
          'Transfer from reserves',
          'Seek immediate funding',
          'Reduce expenses'
        ],
        data: { cashPosition: this.treasury.cashOnHand, minimumBalance: this.controls.reserveRequirements.minimumCashBalance }
      });
    }
    
    // Check reserves
    const totalReserves = this.treasury.emergencyFund + this.treasury.reserveFund;
    const reserveTarget = this.controls.reserveRequirements.reserveTarget;
    
    if (totalReserves < reserveTarget * this.controls.alertThresholds.reserveDepletion) {
      alerts.push({
        id: `reserve_depletion_${Date.now()}`,
        type: 'cash_flow',
        severity: 'medium',
        title: 'Reserve Depletion Warning',
        message: `Reserves at ${totalReserves} below target of ${reserveTarget}`,
        timestamp: new Date().toISOString(),
        resolved: false,
        actionRequired: true,
        recommendedActions: [
          'Replenish reserves',
          'Review reserve allocation',
          'Consider reserve requirements'
        ],
        data: { totalReserves, reserveTarget, depletionRatio: totalReserves / reserveTarget }
      });
    }
    
    // Check budget utilization
    if (this.metrics.budgetUtilization > this.controls.alertThresholds.budgetExceedance * 100) {
      alerts.push({
        id: `budget_exceeded_${Date.now()}`,
        type: 'budget',
        severity: 'medium',
        title: 'Budget Utilization Alert',
        message: `Budget utilization at ${this.metrics.budgetUtilization.toFixed(1)}% exceeds threshold`,
        timestamp: new Date().toISOString(),
        resolved: false,
        actionRequired: true,
        recommendedActions: [
          'Review budget allocations',
          'Consider budget reallocation',
          'Implement spending controls'
        ],
        data: { utilization: this.metrics.budgetUtilization, threshold: this.controls.alertThresholds.budgetExceedance }
      });
    }
    
    // Update alerts
    this.alerts = alerts;
    
    // Emit alerts
    for (const alert of alerts) {
      this.emit_event('FINANCIAL_ALERT', alert, 'broadcast', alert.severity);
    }
    
    if (alerts.length > 0) {
      console.log(`[Finance Agent] Generated ${alerts.length} financial alerts`);
    }
  }

  /**
   * Trigger spending limit alert
   */
  private async triggerSpendingLimitAlert(spendingLimit: SpendingLimit, amount: number, category: string): Promise<void> {
    const alert: FinancialAlert = {
      id: `spending_limit_${category}_${Date.now()}`,
      type: 'expense',
      severity: 'high',
      title: 'Spending Limit Exceeded',
      message: `Spending limit for ${category} exceeded by $${amount - spendingLimit.limit}`,
      timestamp: new Date().toISOString(),
      resolved: false,
      actionRequired: true,
      recommendedActions: [
        'Review spending priorities',
        'Increase spending limit',
        'Defer non-essential expenses'
      ],
      data: { category, limit: spendingLimit.limit, currentSpend: spendingLimit.currentSpend, attemptedAmount: amount }
    };
    
    this.alerts.push(alert);
    this.emit_event('FINANCIAL_ALERT', alert, 'broadcast', 'high');
    
    console.log(`[Finance Agent] Spending limit exceeded for ${category}`);
  }

  /**
   * Trigger high value alert
   */
  private async triggerHighValueAlert(amount: number, category: string): Promise<void> {
    const alert: FinancialAlert = {
      id: `high_value_${category}_${Date.now()}`,
      type: 'expense',
      severity: 'medium',
      title: 'High Value Expense Alert',
      message: `High value expense of $${amount} in ${category} requires review`,
      timestamp: new Date().toISOString(),
      resolved: false,
      actionRequired: true,
      recommendedActions: [
        'Review expense justification',
        'Check approval process',
        'Consider alternative options'
      ],
      data: { amount, category }
    };
    
    this.alerts.push(alert);
    this.emit_event('FINANCIAL_ALERT', alert, 'broadcast', 'medium');
    
    console.log(`[Finance Agent] High value expense alert: $${amount} in ${category}`);
  }

  /**
   * Resolve runway alerts
   */
  private async resolveRunwayAlerts(): Promise<void> {
    const runwayAlerts = this.alerts.filter(a => a.type === 'runway');
    
    for (const alert of runwayAlerts) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
    }
    
    if (runwayAlerts.length > 0) {
      this.emit_event('FINANCIAL_ALERTS_RESOLVED', {
        resolved_alerts: runwayAlerts,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'low');
    }
  }

  /**
   * Update forecasts
   */
  private async updateForecasts(): Promise<void> {
    // Update existing forecasts with new data
    for (const forecast of this.forecasts.values()) {
      // This would update the forecast with new actual data
      forecast.lastUpdated = new Date().toISOString();
    }
  }

  /**
   * Get financial system status
   */
  public getFinancialSystemStatus(): any {
    return {
      treasury: this.treasury,
      budgets: Array.from(this.budgets.values()),
      cashFlow: this.cashFlow,
      forecasts: Array.from(this.forecasts.values()),
      metrics: this.metrics,
      controls: this.controls,
      alerts: this.alerts,
      accounts: Array.from(this.treasury.accounts.values()),
      spendingLimits: Array.from(this.controls.spendingLimits.values())
    };
  }

  /**
   * Get financial metrics
   */
  public getFinancialMetrics(): FinancialMetrics {
    return this.metrics;
  }

  /**
   * Get alerts
   */
  public getAlerts(): FinancialAlert[] {
    return this.alerts;
  }

  /**
   * Get budgets
   */
  public getBudgets(): Budget[] {
    return Array.from(this.budgets.values());
  }

  /**
   * Get budget by ID
   */
  public getBudget(budgetId: string): Budget | undefined {
    return this.budgets.get(budgetId);
  }

  /**
   * Get forecasts
   */
  public getForecasts(): Forecast[] {
    return Array.from(this.forecasts.values());
  }

  /**
   * Get forecast by ID
   */
  public getForecast(forecastId: string): Forecast | undefined {
    return this.forecasts.get(forecastId);
  }

  /**
   * Get treasury status
   */
  public getTreasuryStatus(): Treasury {
    return this.treasury;
  }

  /**
   * Create financial report
   */
  public createFinancialReport(type: string): any {
    const report = {
      type,
      generated_at: new Date().toISOString(),
      generated_by: this.id,
      treasury: this.treasury,
      metrics: this.metrics,
      alerts: this.alerts,
      recommendations: this.generateRecommendations(),
      summary: this.generateSummary()
    };
    
    return report;
  }

  /**
   * Generate financial recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    // Runway recommendations
    if (this.metrics.runway < 30) {
      recommendations.push('Seek immediate funding to extend runway beyond 30 days');
    } else if (this.metrics.runway < 60) {
      recommendations.push('Plan funding strategies to maintain healthy runway');
    }
    
    // Cash position recommendations
    if (this.treasury.cashOnHand < this.controls.reserveRequirements.minimumCashBalance) {
      recommendations.push('Replenish cash position to meet minimum balance requirements');
    }
    
    // Budget recommendations
    if (this.metrics.budgetUtilization > 90) {
      recommendations.push('Review and adjust budget allocations to prevent overspending');
    }
    
    // Reserve recommendations
    const totalReserves = this.treasury.emergencyFund + this.treasury.reserveFund;
    const reserveTarget = this.controls.reserveRequirements.reserveTarget;
    
    if (totalReserves < reserveTarget) {
      recommendations.push('Build up reserves to meet target of $' + reserveTarget.toLocaleString());
    }
    
    return recommendations;
  }

  /**
   * Generate financial summary
   */
  private generateSummary(): any {
    return {
      total_assets: this.treasury.totalAssets,
      cash_position: this.treasury.cashOnHand,
      total_reserves: this.treasury.emergencyFund + this.treasury.reserveFund,
      runway_days: this.metrics.runway,
      burn_rate: this.metrics.burnRate,
      budget_utilization: this.metrics.budgetUtilization,
      net_income: this.metrics.netIncome,
      profit_margin: this.metrics.profitMargin,
      active_alerts: this.alerts.filter(a => !a.resolved).length
    };
  }
}