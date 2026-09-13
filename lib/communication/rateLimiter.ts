/**
 * HEIDI Communication Rate Limiter
 *
 * Enforces per-recipient and per-conversation rate limits using the
 * communication policy model. Counts are persisted in the database
 * via the ConversationStore, making them durable across restarts.
 */

import { ConversationStore } from './conversationStore';
import { communicationPolicyModel } from './policyModel';
import type { ChannelId, CommunicationActionType } from './types';

export interface RateLimitResult {
  allowed: boolean;
  reason: string;
  perRecipientCount: number;
  perRecipientLimit: number;
  perConversationCount: number;
  perConversationLimit: number;
  cooldownRemainingMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

export class RateLimiter {
  private store: ConversationStore;

  constructor(store: ConversationStore) {
    this.store = store;
  }

  async check(
    actionType: CommunicationActionType,
    recipientId: string,
    conversationId: string,
    channelId: ChannelId,
  ): Promise<RateLimitResult> {
    const limits = communicationPolicyModel.getRateLimits(actionType);

    // Zero limit means prohibited autonomously
    if (limits.maxPerRecipientPerHour === 0) {
      return {
        allowed: false,
        reason: `${actionType} has zero rate limit — human authorization required`,
        perRecipientCount: 0,
        perRecipientLimit: 0,
        perConversationCount: 0,
        perConversationLimit: 0,
        cooldownRemainingMs: 0,
      };
    }

    const perRecipientCount = await this.store.countOutboundInWindow(
      recipientId, channelId, HOUR_MS,
    );
    const perConversationCount = await this.store.countOutboundInConversationInWindow(
      conversationId, HOUR_MS,
    );

    if (perRecipientCount >= limits.maxPerRecipientPerHour) {
      return {
        allowed: false,
        reason: `rate limit exceeded: ${perRecipientCount}/${limits.maxPerRecipientPerHour} per recipient per hour`,
        perRecipientCount,
        perRecipientLimit: limits.maxPerRecipientPerHour,
        perConversationCount,
        perConversationLimit: limits.maxPerConversationPerHour,
        cooldownRemainingMs: HOUR_MS,
      };
    }

    if (perConversationCount >= limits.maxPerConversationPerHour) {
      return {
        allowed: false,
        reason: `rate limit exceeded: ${perConversationCount}/${limits.maxPerConversationPerHour} per conversation per hour`,
        perRecipientCount,
        perRecipientLimit: limits.maxPerRecipientPerHour,
        perConversationCount,
        perConversationLimit: limits.maxPerConversationPerHour,
        cooldownRemainingMs: HOUR_MS,
      };
    }

    // Cooldown check
    let cooldownRemainingMs = 0;
    if (limits.cooldownMs > 0) {
      const lastSent = await this.store.lastOutboundTimestamp(recipientId, channelId);
      if (lastSent) {
        const elapsed = Date.now() - new Date(lastSent).getTime();
        if (elapsed < limits.cooldownMs) {
          cooldownRemainingMs = limits.cooldownMs - elapsed;
          return {
            allowed: false,
            reason: `cooldown active: ${cooldownRemainingMs}ms remaining`,
            perRecipientCount,
            perRecipientLimit: limits.maxPerRecipientPerHour,
            perConversationCount,
            perConversationLimit: limits.maxPerConversationPerHour,
            cooldownRemainingMs,
          };
        }
      }
    }

    return {
      allowed: true,
      reason: 'within rate limits',
      perRecipientCount,
      perRecipientLimit: limits.maxPerRecipientPerHour,
      perConversationCount,
      perConversationLimit: limits.maxPerConversationPerHour,
      cooldownRemainingMs: 0,
    };
  }
}
