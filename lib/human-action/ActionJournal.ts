/**
 * HYDI Action Journal — Persistent Audit Trail
 *
 * Every action records:
 *   - goal
 *   - action
 *   - actor
 *   - authorization
 *   - timestamp
 *   - target
 *   - parameters with secrets redacted
 *   - execution result
 *   - verification result
 *   - rollback result
 *   - failure
 *   - recovery
 *   - final state
 *
 * The journal survives daemon restarts by persisting to a JSONL file.
 * Secret material is NEVER recorded — parameters are redacted before storage.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  ActionJournalEntry,
  HumanAction,
  HumanActionResult,
  HumanInterventionRequest,
  ActionParameters,
  RollbackResult,
} from './HumanActionTypes';

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERNS = [
  /password/i, /secret/i, /token/i, /api[_-]?key/i, /private[_-]?key/i,
  /credential/i, /auth/i, /pass/i, /key/i, /passwd/i,
];

const SECRET_VALUE_PATTERNS = [
  /^sk_live_/, /^sk_test_/, /^SG\./, /^Bearer\s/i,
  /^[A-Za-z0-9+/]{40,}$/, // long base64 strings
];

/**
 * Redact secret values from parameters before recording.
 * Replaces secret values with '[REDACTED]' and keeps structure.
 */
export function redactParameters(params: ActionParameters): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((p) => p.test(value))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 100 && value.startsWith('-----BEGIN')) {
      redacted[key] = '[REDACTED:PEM_KEY]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactParameters(value as ActionParameters);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((v) =>
        typeof v === 'object' && v !== null
          ? redactParameters(v as ActionParameters)
          : v,
      );
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Action Journal
// ---------------------------------------------------------------------------

export class ActionJournal {
  private journalPath: string;
  private entries: ActionJournalEntry[] = [];
  private maxEntries: number;
  private writeBuffer: ActionJournalEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs: number;

  constructor(
    journalPath: string,
    options?: { maxEntries?: number; flushIntervalMs?: number },
  ) {
    this.journalPath = journalPath;
    this.maxEntries = options?.maxEntries ?? 10000;
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;
    this.load();
  }

  /**
   * Record an action entry. Secrets are redacted before storage.
   */
  record(
    action: HumanAction,
    result: HumanActionResult | null,
    options?: {
      verificationResult?: string | null;
      rollbackResult?: RollbackResult | null;
      failure?: string | null;
      recovery?: string | null;
      interventionRequest?: HumanInterventionRequest | null;
    },
  ): ActionJournalEntry {
    const entry: ActionJournalEntry = {
      entryId: randomUUID(),
      actionId: action.actionId,
      goalId: action.goalId,
      actor: action.actor,
      authorizedBy: action.authorizedBy,
      timestamp: new Date().toISOString(),
      category: action.category,
      capability: action.capability,
      operation: action.operation,
      target: action.target,
      parametersRedacted: redactParameters(action.parameters),
      state: action.state,
      result: result ? this.redactResult(result) : null,
      verificationResult: options?.verificationResult ?? null,
      rollbackResult: options?.rollbackResult ?? null,
      failure: options?.failure ?? null,
      recovery: options?.recovery ?? null,
      finalState: action.state,
      interventionRequest: options?.interventionRequest ?? null,
    };

    this.entries.push(entry);
    this.writeBuffer.push(entry);

    // Trim if exceeding max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Schedule flush
    this.scheduleFlush();

    return entry;
  }

  /**
   * Get all entries for a goal.
   */
  getEntriesForGoal(goalId: string): ActionJournalEntry[] {
    return this.entries.filter((e) => e.goalId === goalId);
  }

  /**
   * Get all entries for an action.
   */
  getEntriesForAction(actionId: string): ActionJournalEntry[] {
    return this.entries.filter((e) => e.actionId === actionId);
  }

  /**
   * Get recent entries.
   */
  getRecentEntries(count: number = 50): ActionJournalEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Get all entries.
   */
  getAllEntries(): ActionJournalEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by category.
   */
  getEntriesByCategory(category: string): ActionJournalEntry[] {
    return this.entries.filter((e) => e.category === category);
  }

  /**
   * Get failed actions.
   */
  getFailedActions(): ActionJournalEntry[] {
    return this.entries.filter(
      (e) => e.finalState === 'EXECUTION_FAILED' || e.finalState === 'VERIFICATION_FAILED',
    );
  }

  /**
   * Get actions that required human intervention.
   */
  getHumanInterventionRequests(): HumanInterventionRequest[] {
    return this.entries
      .filter((e) => e.interventionRequest !== null)
      .map((e) => e.interventionRequest!)
      .filter((r): r is HumanInterventionRequest => r !== null);
  }

  /**
   * Flush pending writes to disk.
   */
  async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const toWrite = [...this.writeBuffer];
    this.writeBuffer = [];
    try {
      const lines = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.promises.appendFile(this.journalPath, lines, { encoding: 'utf-8' });
    } catch (error) {
      // If write fails, put entries back in buffer
      this.writeBuffer.unshift(...toWrite);
      throw error;
    }
  }

  /**
   * Close the journal, flushing any pending writes.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Get journal statistics.
   */
  getStats(): {
    totalEntries: number;
    byCategory: Record<string, number>;
    byFinalState: Record<string, number>;
    failedCount: number;
    humanInterventionCount: number;
  } {
    const byCategory: Record<string, number> = {};
    const byFinalState: Record<string, number> = {};
    for (const e of this.entries) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      byFinalState[e.finalState] = (byFinalState[e.finalState] ?? 0) + 1;
    }
    return {
      totalEntries: this.entries.length,
      byCategory,
      byFinalState,
      failedCount: this.getFailedActions().length,
      humanInterventionCount: this.getHumanInterventionRequests().length,
    };
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private load(): void {
    try {
      if (!fs.existsSync(this.journalPath)) return;
      const content = fs.readFileSync(this.journalPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as ActionJournalEntry;
          this.entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
      // Trim to max
      if (this.entries.length > this.maxEntries) {
        this.entries = this.entries.slice(-this.maxEntries);
      }
    } catch {
      // Journal file not readable — start fresh
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    // Use unref so the timer doesn't keep the process alive
    this.flushTimer = setTimeout(() => {
      this.flush().catch(() => {
        // Flush failed — will retry on next schedule
      });
    }, this.flushIntervalMs);
    // Allow the process to exit even if the timer is pending
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private redactResult(result: HumanActionResult): HumanActionResult {
    return {
      ...result,
      result: this.redactSafeValue(result.result),
    };
  }

  private redactSafeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      // Check if the string looks like a secret
      if (SECRET_VALUE_PATTERNS.some((p) => p.test(value))) {
        return '[REDACTED]';
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redactSafeValue(v));
    }
    if (value && typeof value === 'object') {
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY_PATTERNS.some((p) => p.test(k))) {
          redacted[k] = '[REDACTED]';
        } else {
          redacted[k] = this.redactSafeValue(v);
        }
      }
      return redacted;
    }
    return value;
  }
}

/**
 * Create an action journal at the default location.
 */
export function createActionJournal(
  rootDir: string,
  options?: { maxEntries?: number; flushIntervalMs?: number },
): ActionJournal {
  const journalDir = path.resolve(rootDir, '.hydi-operational');
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }
  const journalPath = path.resolve(journalDir, 'action-journal.jsonl');
  return new ActionJournal(journalPath, options);
}
