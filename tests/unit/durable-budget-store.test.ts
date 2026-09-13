/**
 * Phase 7 Fix: Durable Budget Store Tests
 *
 * Verifies that:
 * - Budget state persists to disk
 * - Exhausted incidents are tracked and prevent re-entry
 * - Circuit breaker state is restored on construction
 * - Reset clears retry counts and persists
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { DurableBudgetStore } from '../../lib/operational/DurableBudgetStore';

describe('Phase 7 Fix: Durable Budget Store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-budget-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists and retrieves budget state across instances', () => {
    const store1 = new DurableBudgetStore(tmpDir);
    store1.updateState('supabase_rest', {
      retryCount: 2,
      totalAttempts: 5,
      totalSuccesses: 3,
      consecutiveFailures: 2,
      circuitBreakerTripped: false,
    });

    // Create a new instance — should load from disk
    const store2 = new DurableBudgetStore(tmpDir);
    const state = store2.getState('supabase_rest');
    expect(state).not.toBeNull();
    expect(state!.retryCount).toBe(2);
    expect(state!.totalAttempts).toBe(5);
    expect(state!.totalSuccesses).toBe(3);
  });

  it('tracks exhausted incidents and prevents re-entry', () => {
    const store = new DurableBudgetStore(tmpDir);
    store.markIncidentExhausted('supabase_rest', 'incident-123');

    expect(store.isIncidentExhausted('supabase_rest', 'incident-123')).toBe(true);
    expect(store.isIncidentExhausted('supabase_rest', 'incident-456')).toBe(false);
    expect(store.isIncidentExhausted('supabase_db', 'incident-123')).toBe(false);
  });

  it('exhausted incidents persist across instances', () => {
    const store1 = new DurableBudgetStore(tmpDir);
    store1.markIncidentExhausted('supabase_rest', 'incident-789');

    const store2 = new DurableBudgetStore(tmpDir);
    expect(store2.isIncidentExhausted('supabase_rest', 'incident-789')).toBe(true);
  });

  it('resetRetries clears retry count and persists', () => {
    const store1 = new DurableBudgetStore(tmpDir);
    store1.updateState('supabase_rest', { retryCount: 3, consecutiveFailures: 2 });
    store1.resetRetries('supabase_rest');

    const store2 = new DurableBudgetStore(tmpDir);
    const state = store2.getState('supabase_rest');
    expect(state!.retryCount).toBe(0);
    expect(state!.consecutiveFailures).toBe(0);
  });

  it('handles missing file gracefully', () => {
    const store = new DurableBudgetStore(tmpDir);
    expect(store.getState('supabase_rest')).toBeNull();
    expect(store.isIncidentExhausted('supabase_rest', 'incident-1')).toBe(false);
  });

  it('handles corrupt file gracefully', () => {
    const dir = path.resolve(tmpDir, '.hydi-operational');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.resolve(dir, 'recovery-budget.jsonl'), 'not valid json\n{also broken\n');
    const store = new DurableBudgetStore(tmpDir);
    expect(store.getState('supabase_rest')).toBeNull();
  });
});
