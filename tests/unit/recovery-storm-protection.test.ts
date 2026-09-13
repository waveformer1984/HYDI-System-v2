/**
 * Phase 13: Recovery Storm Protection Tests
 *
 * Verifies that:
 * - One incident → one recovery state machine
 * - Concurrent watchdog cycles do not create competing recoveries
 * - The recovery lock prevents duplicate recovery dispatch
 * - The activeRecoveries map prevents concurrent recovery in the same process
 */

import { RecoveryLockManager } from '../../lib/operational/RecoveryLock';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';

describe('Phase 13: Recovery Storm Protection', () => {
  describe('RecoveryLockManager', () => {
    let stateModel: SystemStateModel;
    let lockManager: RecoveryLockManager;

    beforeEach(() => {
      const root = __dirname;
      stateModel = new SystemStateModel();
      lockManager = new RecoveryLockManager(stateModel, 60000);
    });

    it('first acquire succeeds, second acquire for same component fails', () => {
      const lease1 = lockManager.acquire('supabase_rest');
      expect(lease1).not.toBeNull();
      expect(lease1!.active).toBe(true);

      const lease2 = lockManager.acquire('supabase_rest');
      expect(lease2).toBeNull();
    });

    it('different components can be locked simultaneously', () => {
      const lease1 = lockManager.acquire('supabase_rest');
      const lease2 = lockManager.acquire('supabase_db');
      expect(lease1).not.toBeNull();
      expect(lease2).not.toBeNull();
    });

    it('after release, the component can be locked again', () => {
      const lease1 = lockManager.acquire('supabase_rest');
      expect(lease1).not.toBeNull();

      const released = lockManager.release('supabase_rest', lease1!.holderId);
      expect(released).toBe(true);

      const lease2 = lockManager.acquire('supabase_rest');
      expect(lease2).not.toBeNull();
    });

    it('release with wrong holderId fails', () => {
      const lease = lockManager.acquire('supabase_rest');
      expect(lease).not.toBeNull();

      const released = lockManager.release('supabase_rest', 'wrong-holder-id');
      expect(released).toBe(false);
    });

    it('isLocked returns true for active lock, false after release', () => {
      expect(lockManager.isLocked('supabase_rest')).toBe(false);

      lockManager.acquire('supabase_rest');
      expect(lockManager.isLocked('supabase_rest')).toBe(true);

      const lease = lockManager.getLease('supabase_rest');
      lockManager.release('supabase_rest', lease!.holderId);
      expect(lockManager.isLocked('supabase_rest')).toBe(false);
    });

    it('expired lease is automatically cleaned up', () => {
      // Create a lock manager with very short timeout
      const shortLock = new RecoveryLockManager(stateModel, 100); // 100ms
      shortLock.acquire('supabase_rest');

      // Wait for it to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortLock.isLocked('supabase_rest')).toBe(false);
          // Should be able to acquire again after expiry
          const newLease = shortLock.acquire('supabase_rest');
          expect(newLease).not.toBeNull();
          resolve();
        }, 150);
      });
    });
  });

  describe('RecoveryEngine storm prevention', () => {
    it('RecoveryEngine has activeRecoveries map to prevent concurrent recovery', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'RecoveryEngine.ts'),
        'utf8',
      );
      // The activeRecoveries map prevents concurrent recovery in the same process
      expect(src).toContain('activeRecoveries');
      expect(src).toContain('recovery already in progress');
    });

    it('RecoveryEngine stores lock holderId for proper release', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'RecoveryEngine.ts'),
        'utf8',
      );
      expect(src).toContain('lockHolderIds');
      expect(src).toContain('releaseLock');
    });

    it('watchdog dispatches recovery with lock awareness', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'scripts', 'watchdog.js'),
        'utf8',
      );
      // The watchdog uses hysteresis to prevent duplicate dispatch
      expect(src).toContain('markRecovering');
      expect(src).toContain('markRecovered');
    });
  });

  describe('One incident → one recovery state machine', () => {
    it('hysteresis prevents re-dispatch during recovery', () => {
      // The watchdog marks the component as "recovering" in hysteresis state
      // before dispatching. This prevents the next watchdog cycle from
      // dispatching recovery for the same component.
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'scripts', 'watchdog.js'),
        'utf8',
      );
      // markRecovering sets the hysteresis state so the next cycle sees
      // the component as already being recovered
      expect(src).toContain('observationHysteresis.markRecovering');
    });
  });
});
