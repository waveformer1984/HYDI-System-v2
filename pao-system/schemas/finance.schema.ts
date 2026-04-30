export interface FinancialTransaction {
  id: string;
  type: 'expense' | 'revenue';
  source: string;
  amount: number;
  timestamp: string;
  category?: string;
  description?: string;
}

export interface BudgetAllocation {
  id: string;
  category: string;
  allocated_amount: number;
  spent_amount: number;
  remaining_amount: number;
  period: string;
}

export interface FinancialReport {
  id: string;
  period: string;
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  cash_flow: number;
  burn_rate: number;
  runway_months: number;
  transactions: FinancialTransaction[];
  budget_allocations: BudgetAllocation[];
}