/**
 * HEIDI Communication Kill Switch
 *
 * Global outbound emergency stop. When activated:
 *   - all outbound communication is blocked immediately
 *   - conversations and historical records are preserved
 *   - inbound messages continue to be received and persisted
 *   - the kill switch state is durable (stored in DB)
 *
 * The kill switch can be activated in two modes:
 *   - 'disabled': outbound paused, can be reactivated
 *   - 'emergency_stop': outbound halted, requires explicit human reset
 */

import { ConversationStore } from './conversationStore';
import type { KillSwitchStatus } from './types';

export class KillSwitch {
  private store: ConversationStore;
  private cachedStatus: KillSwitchStatus = 'active';
  private cachedAt: number = 0;
  private readonly cacheTtlMs = 5000; // 5 second cache

  constructor(store: ConversationStore) {
    this.store = store;
  }

  async getStatus(): Promise<KillSwitchStatus> {
    // Use cached value if fresh
    if (Date.now() - this.cachedAt < this.cacheTtlMs) {
      return this.cachedStatus;
    }

    const row = await this.store.getKillSwitchStatus();
    this.cachedStatus = (row.status as KillSwitchStatus) || 'active';
    this.cachedAt = Date.now();
    return this.cachedStatus;
  }

  async isOutboundAllowed(): Promise<boolean> {
    const status = await this.getStatus();
    return status === 'active';
  }

  async activate(reason: string, activatedBy: string): Promise<void> {
    await this.store.setKillSwitchStatus('disabled', reason, activatedBy);
    this.cachedStatus = 'disabled';
    this.cachedAt = Date.now();
  }

  async emergencyStop(reason: string, activatedBy: string): Promise<void> {
    await this.store.setKillSwitchStatus('emergency_stop', reason, activatedBy);
    this.cachedStatus = 'emergency_stop';
    this.cachedAt = Date.now();
  }

  async deactivate(activatedBy: string): Promise<void> {
    // Emergency stop requires explicit acknowledgment
    const current = await this.getStatus();
    if (current === 'emergency_stop') {
      throw new Error('Cannot deactivate emergency_stop without explicit reset — call resetEmergencyStop()');
    }
    await this.store.setKillSwitchStatus('active', undefined, activatedBy);
    this.cachedStatus = 'active';
    this.cachedAt = Date.now();
  }

  async resetEmergencyStop(activatedBy: string): Promise<void> {
    await this.store.setKillSwitchStatus('active', undefined, activatedBy);
    this.cachedStatus = 'active';
    this.cachedAt = Date.now();
  }

  invalidateCache(): void {
    this.cachedAt = 0;
  }
}
