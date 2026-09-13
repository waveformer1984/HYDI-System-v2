/**
 * HYDI Durable Recovery Budget Store
 *
 * Phase 7 Fix — Persists recovery budget state to durable storage so that
 * a watchdog restart does NOT silently reset the recovery budget.
 *
 * Without this, a target that exhausted its budget and got escalated can
 * get a fresh budget after a restart and re-enter a retry loop the system
 * already decided was futile.
 *
 * Storage format: JSONL file at .hydi-operational/recovery-budget.jsonl
 * Each line is a budget state record keyed by component.
 * The store is loaded on construction and saved on every state change.
 */

import fs from 'fs';
import path from 'path';

export interface DurableBudgetState {
  component: string;
  retryCount: number;
  totalAttempts: number;
  totalSuccesses: number;
  consecutiveFailures: number;
  circuitBreakerTripped: boolean;
  circuitBreakerTrippedAt: string | null;
  lastFailureAt: string | null;
  // Track incident IDs that have been exhausted — they don't get a fresh budget
  exhaustedIncidents: string[];
  updatedAt: string;
}

export class DurableBudgetStore {
  private filePath: string;
  private state = new Map<string, DurableBudgetState>();

  constructor(root: string) {
    const dir = path.resolve(root, '.hydi-operational');
    this.filePath = path.resolve(dir, 'recovery-budget.jsonl');
    this.load();
  }

  /**
   * Load durable budget state from disk.
   */
  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const content = fs.readFileSync(this.filePath, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n').filter(Boolean);
      // Keep only the latest record per component (last write wins)
      for (const line of lines) {
        try {
          const record: DurableBudgetState = JSON.parse(line);
          this.state.set(record.component, record);
        } catch { /* skip malformed */ }
      }
    } catch { /* fresh start if file is corrupt */ }
  }

  /**
   * Save a single component's budget state to disk (append-only JSONL).
   */
  private saveComponent(component: string): void {
    const record = this.state.get(component);
    if (!record) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
  }

  /**
   * Get the budget state for a component (or null if not tracked).
   */
  getState(component: string): DurableBudgetState | null {
    const state = this.state.get(component);
    return state ? { ...state } : null;
  }

  /**
   * Update the budget state for a component and persist to disk.
   */
  updateState(component: string, update: Partial<DurableBudgetState>): void {
    const existing = this.state.get(component);
    const updated: DurableBudgetState = {
      component,
      retryCount: update.retryCount ?? existing?.retryCount ?? 0,
      totalAttempts: update.totalAttempts ?? existing?.totalAttempts ?? 0,
      totalSuccesses: update.totalSuccesses ?? existing?.totalSuccesses ?? 0,
      consecutiveFailures: update.consecutiveFailures ?? existing?.consecutiveFailures ?? 0,
      circuitBreakerTripped: update.circuitBreakerTripped ?? existing?.circuitBreakerTripped ?? false,
      circuitBreakerTrippedAt: update.circuitBreakerTrippedAt ?? existing?.circuitBreakerTrippedAt ?? null,
      lastFailureAt: update.lastFailureAt ?? existing?.lastFailureAt ?? null,
      exhaustedIncidents: update.exhaustedIncidents ?? existing?.exhaustedIncidents ?? [],
      updatedAt: new Date().toISOString(),
    };
    this.state.set(component, updated);
    this.saveComponent(component);
  }

  /**
   * Check if an incident has been exhausted (budget used up).
   * This prevents a watchdog restart from giving a fresh budget
   * to an incident that was already escalated.
   */
  isIncidentExhausted(component: string, incidentId: string): boolean {
    const state = this.state.get(component);
    if (!state) return false;
    return state.exhaustedIncidents.includes(incidentId);
  }

  /**
   * Mark an incident as exhausted for a component.
   * Creates the component state if it doesn't exist yet.
   */
  markIncidentExhausted(component: string, incidentId: string): void {
    const state = this.state.get(component);
    if (state) {
      if (!state.exhaustedIncidents.includes(incidentId)) {
        state.exhaustedIncidents.push(incidentId);
        this.updateState(component, { exhaustedIncidents: state.exhaustedIncidents });
      }
    } else {
      // Create new state for this component with the exhausted incident
      this.updateState(component, { exhaustedIncidents: [incidentId] });
    }
  }

  /**
   * Reset the retry count for a component (on successful recovery).
   */
  resetRetries(component: string): void {
    this.updateState(component, {
      retryCount: 0,
      consecutiveFailures: 0,
    });
  }

  /**
   * Get all tracked components' states (for diagnostics).
   */
  getAllStates(): DurableBudgetState[] {
    return Array.from(this.state.values()).map((s) => ({ ...s }));
  }
}
