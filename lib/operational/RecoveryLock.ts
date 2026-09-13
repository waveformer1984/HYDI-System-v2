/**
 * HYDI Recovery Lock — Concurrency Safety
 *
 * Phase 4 — Prevents two Heidi instances from simultaneously recovering
 * the same component.
 *
 * Implements a recovery lease mechanism:
 *   - When recovery starts, a lease is acquired for the component
 *   - Other recovery requests for the same component see the lease and observe
 *   - The lease has a timeout to prevent deadlocks if the holder crashes
 *   - When recovery completes, the lease is released
 *
 * Test: two recovery requests, same component, same incident
 * Expected: one executes, one observes existing recovery
 * Never: competing autonomous recovery loops
 */

import { randomUUID } from 'crypto';
import type { RecoveryLease } from './types';
import type { SystemStateModel } from './SystemStateModel';

const DEFAULT_LEASE_TIMEOUT_MS = 120000; // 2 minutes

export class RecoveryLockManager {
  private leases = new Map<string, RecoveryLease>();
  private stateModel: SystemStateModel;
  private leaseTimeoutMs: number;

  constructor(stateModel: SystemStateModel, leaseTimeoutMs?: number) {
    this.stateModel = stateModel;
    this.leaseTimeoutMs = leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
  }

  /**
   * Try to acquire a recovery lease for a component.
   * Returns the lease if acquired, or null if another recovery is in progress.
   */
  acquire(component: string): RecoveryLease | null {
    // Check for existing active lease
    const existing = this.leases.get(component);
    if (existing && existing.active) {
      // Check if the lease has expired
      const now = Date.now();
      const expiresAt = new Date(existing.expiresAt).getTime();
      if (now < expiresAt) {
        // Lease is still active — deny
        return null;
      }
      // Lease expired — clean it up
      this.leases.delete(component);
    }

    // Acquire new lease
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.leaseTimeoutMs);
    const lease: RecoveryLease = {
      component,
      holderId: randomUUID(),
      acquiredAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      active: true,
    };

    this.leases.set(component, lease);

    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: now.toISOString(),
      type: 'recovery_lock_acquired',
      component,
      action: 'recovery_lock',
      actionResult: 'success',
      detail: { holderId: lease.holderId, expiresAt: lease.expiresAt },
    });

    return lease;
  }

  /**
   * Release a recovery lease.
   */
  release(component: string, holderId: string): boolean {
    const lease = this.leases.get(component);
    if (!lease || lease.holderId !== holderId) {
      return false; // not our lease
    }

    lease.active = false;
    this.leases.delete(component);

    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'recovery_lock_released',
      component,
      action: 'recovery_lock',
      actionResult: 'success',
      detail: { holderId },
    });

    return true;
  }

  /**
   * Check if a component has an active recovery lease.
   */
  isLocked(component: string): boolean {
    const lease = this.leases.get(component);
    if (!lease || !lease.active) return false;
    // Check expiry
    const now = Date.now();
    const expiresAt = new Date(lease.expiresAt).getTime();
    if (now >= expiresAt) {
      this.leases.delete(component);
      return false;
    }
    return true;
  }

  /**
   * Get the active lease for a component (if any).
   */
  getLease(component: string): RecoveryLease | null {
    const lease = this.leases.get(component);
    if (!lease || !lease.active) return null;
    const now = Date.now();
    const expiresAt = new Date(lease.expiresAt).getTime();
    if (now >= expiresAt) {
      this.leases.delete(component);
      return null;
    }
    return { ...lease };
  }

  /**
   * Get all active leases (for diagnostics).
   */
  getActiveLeases(): RecoveryLease[] {
    const now = Date.now();
    const active: RecoveryLease[] = [];
    for (const [component, lease] of this.leases) {
      if (!lease.active) continue;
      const expiresAt = new Date(lease.expiresAt).getTime();
      if (now >= expiresAt) {
        this.leases.delete(component);
        continue;
      }
      active.push({ ...lease });
    }
    return active;
  }

  /**
   * Clean up expired leases.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [component, lease] of this.leases) {
      const expiresAt = new Date(lease.expiresAt).getTime();
      if (now >= expiresAt) {
        this.leases.delete(component);
        cleaned++;
      }
    }
    return cleaned;
  }
}
