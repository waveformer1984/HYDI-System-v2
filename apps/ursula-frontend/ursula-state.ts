/**
 * URSULA-STATE LAYER
 * 
 * Stores: active tasks, financial state, system health, user context
 */

import { EventEmitter } from 'events';
import { TaskExecution } from './ursula-action';

// Types
export interface SystemState {
  activeTasks: TaskExecution[];
  financialState: FinancialState;
  systemHealth: SystemHealth;
  userContext: UserContext;
  lastUpdated: Date;
}

export interface FinancialState {
  revenue: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  expenses: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  profit: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  portfolio: {
    totalValue: number;
    positions: Position[];
    lastUpdated: Date;
  };
  transactions: Transaction[];
}

export interface Position {
  symbol: string;
  quantity: number;
  value: number;
  costBasis: number;
  unrealizedPnL: number;
}

export interface Transaction {
  id: string;
  type: 'revenue' | 'expense' | 'investment';
  amount: number;
  currency: string;
  timestamp: Date;
  description: string;
  category: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  services: ServiceHealth[];
  metrics: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  alerts: Alert[];
  uptime: number;
  lastCheck: Date;
}

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  lastCheck: Date;
  errorRate?: number;
}

export interface Alert {
  id: string;
  type: 'error' | 'warning' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  source: string;
  timestamp: Date;
  acknowledged: boolean;
  resolved: boolean;
}

export interface UserContext {
  currentGoals: Goal[];
  activeProjects: Project[];
  preferences: UserPreferences;
  sessionHistory: SessionEvent[];
  permissions: Permission[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline: Date;
  priority: 'low' | 'medium' | 'high';
  status: 'active' | 'completed' | 'paused';
  createdAt: Date;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'planning' | 'active' | 'testing' | 'completed' | 'archived';
  progress: number; // 0-100
  team: TeamMember[];
  milestones: Milestone[];
  budget: number;
  spent: number;
  startDate: Date;
  endDate?: Date;
  lastActivity: Date;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'inactive';
  joinedAt: Date;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  dueDate: Date;
  status: 'pending' | 'completed' | 'overdue';
  completedAt?: Date;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  dashboard: {
    layout: string;
    widgets: string[];
  };
}

export interface SessionEvent {
  id: string;
  type: 'login' | 'logout' | 'action' | 'error';
  description: string;
  timestamp: Date;
  userId: string;
  metadata?: any;
}

export interface Permission {
  resource: string;
  actions: string[];
  granted: boolean;
  grantedBy: string;
  grantedAt: Date;
}

// State Manager
export class UrsulaState extends EventEmitter {
  private state: SystemState;
  private persistenceInterval!: NodeJS.Timeout;
  private readonly PERSISTENCE_INTERVAL = 30 * 1000; // 30 seconds
  
  constructor() {
    super();
    this.state = this.initializeState();
    this.startPersistence();
    this.loadPersistedState();
  }
  
  private initializeState(): SystemState {
    return {
      activeTasks: [],
      financialState: this.initializeFinancialState(),
      systemHealth: this.initializeSystemHealth(),
      userContext: this.initializeUserContext(),
      lastUpdated: new Date()
    };
  }
  
  private initializeFinancialState(): FinancialState {
    return {
      revenue: { daily: 0, weekly: 0, monthly: 0, yearly: 0 },
      expenses: { daily: 0, weekly: 0, monthly: 0, yearly: 0 },
      profit: { daily: 0, weekly: 0, monthly: 0, yearly: 0 },
      portfolio: {
        totalValue: 0,
        positions: [],
        lastUpdated: new Date()
      },
      transactions: []
    };
  }
  
  private initializeSystemHealth(): SystemHealth {
    return {
      status: 'healthy',
      services: [
        { name: 'database', status: 'up', responseTime: 50, lastCheck: new Date() },
        { name: 'api', status: 'up', responseTime: 120, lastCheck: new Date() },
        { name: 'cache', status: 'up', responseTime: 10, lastCheck: new Date() },
        { name: 'queue', status: 'up', responseTime: 25, lastCheck: new Date() }
      ],
      metrics: {
        cpu: 45,
        memory: 62,
        disk: 38,
        network: 15
      },
      alerts: [],
      uptime: 0,
      lastCheck: new Date()
    };
  }
  
  private initializeUserContext(): UserContext {
    return {
      currentGoals: [],
      activeProjects: [],
      preferences: {
        theme: 'auto',
        language: 'en',
        timezone: 'UTC',
        notifications: {
          email: true,
          push: true,
          sms: false
        },
        dashboard: {
          layout: 'default',
          widgets: ['revenue', 'tasks', 'health', 'alerts']
        }
      },
      sessionHistory: [],
      permissions: [
        { resource: '*', actions: ['*'], granted: true, grantedBy: 'system', grantedAt: new Date() }
      ]
    };
  }
  
  // Active Tasks Management
  addActiveTask(task: TaskExecution): void {
    this.state.activeTasks.push(task);
    this.state.lastUpdated = new Date();
    this.emit('task:added', task);
  }
  
  removeActiveTask(taskId: string): boolean {
    const index = this.state.activeTasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.state.activeTasks.splice(index, 1)[0];
      this.state.lastUpdated = new Date();
      this.emit('task:removed', task);
      return true;
    }
    return false;
  }
  
  updateActiveTask(taskId: string, updates: Partial<TaskExecution>): boolean {
    const task = this.state.activeTasks.find(t => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      this.state.lastUpdated = new Date();
      this.emit('task:updated', task);
      return true;
    }
    return false;
  }
  
  getActiveTasks(): TaskExecution[] {
    return [...this.state.activeTasks];
  }
  
  getActiveTask(taskId: string): TaskExecution | null {
    return this.state.activeTasks.find(t => t.id === taskId) || null;
  }
  
  // Financial State Management
  updateFinancialState(updates: Partial<FinancialState>): void {
    Object.assign(this.state.financialState, updates);
    this.state.lastUpdated = new Date();
    this.emit('financial:updated', this.state.financialState);
  }
  
  addTransaction(transaction: Omit<Transaction, 'id'>): Transaction {
    const newTransaction: Transaction = {
      ...transaction,
      id: this.generateId('txn')
    };
    
    this.state.financialState.transactions.push(newTransaction);
    this.recalculateFinancialMetrics();
    this.state.lastUpdated = new Date();
    this.emit('transaction:added', newTransaction);
    
    return newTransaction;
  }
  
  updatePortfolio(positions: Position[]): void {
    this.state.financialState.portfolio = {
      totalValue: positions.reduce((sum, pos) => sum + pos.value, 0),
      positions,
      lastUpdated: new Date()
    };
    this.state.lastUpdated = new Date();
    this.emit('portfolio:updated', this.state.financialState.portfolio);
  }
  
  private recalculateFinancialMetrics(): void {
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;
    const oneYear = 365 * oneDay;
    
    const transactions = this.state.financialState.transactions.filter(t => t.status === 'completed');
    
    // Calculate revenue
    const revenueTransactions = transactions.filter(t => t.type === 'revenue');
    this.state.financialState.revenue = {
      daily: this.sumTransactionsByDate(revenueTransactions, now, oneDay),
      weekly: this.sumTransactionsByDate(revenueTransactions, now, oneWeek),
      monthly: this.sumTransactionsByDate(revenueTransactions, now, oneMonth),
      yearly: this.sumTransactionsByDate(revenueTransactions, now, oneYear)
    };
    
    // Calculate expenses
    const expenseTransactions = transactions.filter(t => t.type === 'expense');
    this.state.financialState.expenses = {
      daily: this.sumTransactionsByDate(expenseTransactions, now, oneDay),
      weekly: this.sumTransactionsByDate(expenseTransactions, now, oneWeek),
      monthly: this.sumTransactionsByDate(expenseTransactions, now, oneMonth),
      yearly: this.sumTransactionsByDate(expenseTransactions, now, oneYear)
    };
    
    // Calculate profit
    this.state.financialState.profit = {
      daily: this.state.financialState.revenue.daily - this.state.financialState.expenses.daily,
      weekly: this.state.financialState.revenue.weekly - this.state.financialState.expenses.weekly,
      monthly: this.state.financialState.revenue.monthly - this.state.financialState.expenses.monthly,
      yearly: this.state.financialState.revenue.yearly - this.state.financialState.expenses.yearly
    };
  }
  
  private sumTransactionsByDate(transactions: Transaction[], now: Date, period: number): number {
    const cutoff = new Date(now.getTime() - period);
    return transactions
      .filter(t => t.timestamp >= cutoff)
      .reduce((sum, t) => sum + t.amount, 0);
  }
  
  // System Health Management
  updateSystemHealth(updates: Partial<SystemHealth>): void {
    Object.assign(this.state.systemHealth, updates);
    this.state.lastUpdated = new Date();
    this.emit('health:updated', this.state.systemHealth);
  }
  
  updateServiceHealth(serviceName: string, health: Partial<ServiceHealth>): void {
    const service = this.state.systemHealth.services.find(s => s.name === serviceName);
    if (service) {
      Object.assign(service, health);
      service.lastCheck = new Date();
      this.recalculateSystemStatus();
      this.state.lastUpdated = new Date();
      this.emit('service:updated', service);
    }
  }
  
  addAlert(alert: Omit<Alert, 'id'>): Alert {
    const newAlert: Alert = {
      ...alert,
      id: this.generateId('alert')
    };
    
    this.state.systemHealth.alerts.push(newAlert);
    this.recalculateSystemStatus();
    this.state.lastUpdated = new Date();
    this.emit('alert:added', newAlert);
    
    return newAlert;
  }
  
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.state.systemHealth.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.state.lastUpdated = new Date();
      this.emit('alert:acknowledged', alert);
      return true;
    }
    return false;
  }
  
  resolveAlert(alertId: string): boolean {
    const alert = this.state.systemHealth.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.recalculateSystemStatus();
      this.state.lastUpdated = new Date();
      this.emit('alert:resolved', alert);
      return true;
    }
    return false;
  }
  
  private recalculateSystemStatus(): void {
    const services = this.state.systemHealth.services;
    const criticalAlerts = this.state.systemHealth.alerts.filter(a => 
      a.severity === 'critical' && !a.resolved
    );
    
    if (criticalAlerts.length > 0 || services.some(s => s.status === 'down')) {
      this.state.systemHealth.status = 'critical';
    } else if (services.some(s => s.status === 'degraded') || 
               this.state.systemHealth.alerts.some(a => a.severity === 'high' && !a.resolved)) {
      this.state.systemHealth.status = 'warning';
    } else {
      this.state.systemHealth.status = 'healthy';
    }
  }
  
  // User Context Management
  updateUserContext(updates: Partial<UserContext>): void {
    Object.assign(this.state.userContext, updates);
    this.state.lastUpdated = new Date();
    this.emit('context:updated', this.state.userContext);
  }
  
  addGoal(goal: Omit<Goal, 'id' | 'createdAt'>): Goal {
    const newGoal: Goal = {
      ...goal,
      id: this.generateId('goal'),
      createdAt: new Date()
    };
    
    this.state.userContext.currentGoals.push(newGoal);
    this.state.lastUpdated = new Date();
    this.emit('goal:added', newGoal);
    
    return newGoal;
  }
  
  updateGoal(goalId: string, updates: Partial<Goal>): boolean {
    const goal = this.state.userContext.currentGoals.find(g => g.id === goalId);
    if (goal) {
      Object.assign(goal, updates);
      this.state.lastUpdated = new Date();
      this.emit('goal:updated', goal);
      return true;
    }
    return false;
  }
  
  addProject(project: Omit<Project, 'id' | 'lastActivity'>): Project {
    const newProject: Project = {
      ...project,
      id: this.generateId('project'),
      lastActivity: new Date()
    };
    
    this.state.userContext.activeProjects.push(newProject);
    this.state.lastUpdated = new Date();
    this.emit('project:added', newProject);
    
    return newProject;
  }
  
  updateProject(projectId: string, updates: Partial<Project>): boolean {
    const project = this.state.userContext.activeProjects.find(p => p.id === projectId);
    if (project) {
      Object.assign(project, updates);
      project.lastActivity = new Date();
      this.state.lastUpdated = new Date();
      this.emit('project:updated', project);
      return true;
    }
    return false;
  }
  
  addSessionEvent(event: Omit<SessionEvent, 'id'>): SessionEvent {
    const newEvent: SessionEvent = {
      ...event,
      id: this.generateId('event')
    };
    
    this.state.userContext.sessionHistory.push(newEvent);
    this.state.lastUpdated = new Date();
    this.emit('session:event', newEvent);
    
    return newEvent;
  }
  
  // State Retrieval
  getFullState(): SystemState {
    return { ...this.state };
  }
  
  getFinancialState(): FinancialState {
    return { ...this.state.financialState };
  }
  
  getSystemHealth(): SystemHealth {
    return { ...this.state.systemHealth };
  }
  
  getUserContext(): UserContext {
    return { ...this.state.userContext };
  }
  
  // Persistence
  private startPersistence(): void {
    this.persistenceInterval = setInterval(() => {
      this.persistState();
    }, this.PERSISTENCE_INTERVAL);
  }
  
  private persistState(): void {
    try {
      // In a real implementation, this would save to a database
      console.log('Persisting state to storage...');
      // localStorage.setItem('ursula_state', JSON.stringify(this.state));
    } catch (error) {
      console.error('Failed to persist state:', error);
      this.emit('persistence:error', error);
    }
  }
  
  private loadPersistedState(): void {
    try {
      // In a real implementation, this would load from a database
      console.log('Loading persisted state...');
      // const persisted = localStorage.getItem('ursula_state');
      // if (persisted) {
      //   this.state = { ...this.state, ...JSON.parse(persisted) };
      //   this.emit('state:loaded', this.state);
      // }
    } catch (error) {
      console.error('Failed to load persisted state:', error);
    }
  }
  
  // Cleanup
  destroy(): void {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
    }
    this.persistState();
  }
  
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const ursulaState = new UrsulaState();
