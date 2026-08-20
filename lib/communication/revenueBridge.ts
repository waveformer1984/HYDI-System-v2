/**
 * HEIDI Communication Layer — Revenue Integration Bridge
 *
 * Connects the CommunicationLayer to the existing revenue pipeline.
 * HEIDI can use the unified layer for:
 *   - lead acquisition (prospect outreach, follow-up, qualification)
 *   - sales (offer communication, proposal follow-up, appointment reminders)
 *   - customer operations (support, status, renewal, retention, upsell)
 *
 * Every commercial conversation is linkable to:
 *   prospect → opportunity → customer → offer → proposal → subscription
 *
 * This bridge does NOT bypass the revenue pipeline — it enhances it by
 * adding a communication channel that the revenue engine can use.
 */

import { CommunicationLayer } from './communicationLayer';
import type {
  ChannelId,
  OutboundMessageRequest,
  OutboundMessageResult,
  ConversationRecord,
} from './types';

export interface RevenueCommunicationContext {
  prospectId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  supportCaseId?: string | null;
}

export class RevenueCommunicationBridge {
  private layer: CommunicationLayer;

  constructor(layer: CommunicationLayer) {
    this.layer = layer;
  }

  // ─── Lead Acquisition ───────────────────────────────────────────────

  async prospectOutreach(input: {
    prospectId: string;
    prospectEmail: string;
    prospectName?: string;
    message: string;
    actor: string;
    channelId?: ChannelId;
  }): Promise<OutboundMessageResult> {
    const channelId = input.channelId || 'email';
    const request: OutboundMessageRequest = {
      channelId,
      recipientId: input.prospectEmail,
      content: input.message,
      actionType: 'prospect_outreach',
      actor: input.actor,
      purpose: `Initial outreach to prospect ${input.prospectName || input.prospectId}`,
      prospectId: input.prospectId,
      metadata: { prospectName: input.prospectName, source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  async prospectFollowUp(input: {
    prospectId: string;
    prospectEmail: string;
    conversationId?: string;
    message: string;
    actor: string;
    channelId?: ChannelId;
  }): Promise<OutboundMessageResult> {
    const channelId = input.channelId || 'email';
    const request: OutboundMessageRequest = {
      channelId,
      recipientId: input.prospectEmail,
      conversationId: input.conversationId,
      content: input.message,
      actionType: 'prospect_follow_up',
      actor: input.actor,
      purpose: `Follow-up with prospect ${input.prospectId}`,
      prospectId: input.prospectId,
      metadata: { source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  // ─── Sales ──────────────────────────────────────────────────────────

  async proposalFollowUp(input: {
    opportunityId: string;
    customerEmail: string;
    conversationId?: string;
    message: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'email',
      recipientId: input.customerEmail,
      conversationId: input.conversationId,
      content: input.message,
      actionType: 'proposal_follow_up',
      actor: input.actor,
      purpose: `Follow-up on proposal for opportunity ${input.opportunityId}`,
      opportunityId: input.opportunityId,
      metadata: { source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  async appointmentReminder(input: {
    customerId: string;
    customerEmail: string;
    conversationId?: string;
    appointmentDetails: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'email',
      recipientId: input.customerEmail,
      conversationId: input.conversationId,
      content: `Appointment reminder: ${input.appointmentDetails}`,
      actionType: 'appointment_reminder',
      actor: input.actor,
      purpose: 'Appointment reminder',
      customerId: input.customerId,
      metadata: { source: 'revenue_bridge', appointmentDetails: input.appointmentDetails },
    };
    return this.layer.sendMessage(request);
  }

  // ─── Customer Operations ────────────────────────────────────────────

  async supportResponse(input: {
    customerId: string;
    customerEmail: string;
    conversationId?: string;
    message: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'email',
      recipientId: input.customerEmail,
      conversationId: input.conversationId,
      content: input.message,
      actionType: 'support_response',
      actor: input.actor,
      purpose: 'Customer support response',
      customerId: input.customerId,
      metadata: { source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  async customerOnboarding(input: {
    customerId: string;
    customerEmail: string;
    conversationId?: string;
    message: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'email',
      recipientId: input.customerEmail,
      conversationId: input.conversationId,
      content: input.message,
      actionType: 'customer_onboarding',
      actor: input.actor,
      purpose: `Onboarding for customer ${input.customerId}`,
      customerId: input.customerId,
      metadata: { source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  async retentionMessage(input: {
    customerId: string;
    customerEmail: string;
    conversationId?: string;
    message: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'email',
      recipientId: input.customerEmail,
      conversationId: input.conversationId,
      content: input.message,
      actionType: 'retention_message',
      actor: input.actor,
      purpose: `Retention message for customer ${input.customerId}`,
      customerId: input.customerId,
      metadata: { source: 'revenue_bridge' },
    };
    return this.layer.sendMessage(request);
  }

  // ─── Operational Alerts ─────────────────────────────────────────────

  async operationalAlert(input: {
    recipientId: string;
    deviceId?: string;
    title: string;
    body: string;
    actor: string;
  }): Promise<OutboundMessageResult> {
    const request: OutboundMessageRequest = {
      channelId: 'notification',
      recipientId: input.recipientId,
      content: input.body,
      actionType: 'operational_alert',
      actor: input.actor,
      purpose: input.title,
      metadata: {
        source: 'revenue_bridge',
        category: 'deployment_failure',
        deviceId: input.deviceId,
        title: input.title,
      },
    };
    return this.layer.sendMessage(request);
  }

  // ─── Query ──────────────────────────────────────────────────────────

  async getConversationsForProspect(prospectId: string): Promise<ConversationRecord[]> {
    return this.layer.listConversations({ prospectId });
  }

  async getConversationsForCustomer(customerId: string): Promise<ConversationRecord[]> {
    return this.layer.listConversations({ customerId });
  }

  async getConversationsForOpportunity(opportunityId: string): Promise<ConversationRecord[]> {
    // The ConversationStore doesn't have a direct filter for opportunityId,
    // so we list all and filter. For production scale, add a DB index.
    const all = await this.layer.listConversations({ limit: 1000 });
    return all.filter((c) => c.opportunityId === opportunityId);
  }
}

// Singleton
let _bridge: RevenueCommunicationBridge | null = null;

export function getRevenueCommunicationBridge(layer?: CommunicationLayer): RevenueCommunicationBridge {
  if (!_bridge) {
    const commLayer = layer || require('./communicationLayer').getCommunicationLayer();
    _bridge = new RevenueCommunicationBridge(commLayer);
  }
  return _bridge;
}
