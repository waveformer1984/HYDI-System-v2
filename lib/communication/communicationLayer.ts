/**
 * HEIDI Communication Layer
 *
 * The single authoritative communication interface for HYDI.
 * Every authorized HYDI subsystem uses this layer for:
 *   - conversations
 *   - messages
 *   - inbound communication
 *   - outbound communication
 *   - channel discovery
 *   - provider selection
 *   - authorization
 *   - policy
 *   - rate limiting
 *   - persistence
 *   - audit
 *   - delivery verification
 *   - escalation
 *   - autonomous communication
 *
 * Architecture:
 *
 *   SUBSYSTEM
 *      ↓
 *   CommunicationLayer
 *      ↓
 *   Policy / Authorization
 *      ↓
 *   Provider Adapter
 *      ↓
 *   External Provider
 *      ↓
 *   Verification
 *      ↓
 *   Audit
 *
 * Principles:
 *   - identity ≠ permission ≠ policy ≠ execution
 *   - autonomy must be governed
 *   - all communication is auditable
 *   - all outbound is idempotent
 *   - local-first AI (Ollama before cloud)
 *   - never fabricate delivery
 *   - never expose secrets
 */

import { ConversationStore } from './conversationStore';
import { KillSwitch } from './killSwitch';
import { RateLimiter } from './rateLimiter';
import { MessageClassifier } from './messageClassifier';
import { communicationPolicyModel } from './policyModel';
import { HeidiCoreAdapter } from './channels/heidiCoreAdapter';
import { EmailAdapter } from './channels/emailAdapter';
import { PushAdapter } from './channels/pushAdapter';
import { AnthropicAdapter } from './channels/anthropicAdapter';
import { SmsAdapter } from './channels/smsAdapter';
import type {
  ChannelId,
  ChannelDescriptor,
  ConversationRecord,
  MessageRecord,
  OutboundMessageRequest,
  OutboundMessageResult,
  InboundMessage,
  InboundProcessingResult,
  AuthorizationContext,
  ClassificationResult,
  CommunicationEvent,
  DeliveryStatus,
  ConversationStatus,
} from './types';

export interface CommunicationLayerConfig {
  store?: ConversationStore;
  heidiCore?: import('./channels/heidiCoreAdapter').HeidiCoreConfig;
  email?: import('./channels/emailAdapter').EmailAdapterConfig;
  push?: import('./channels/pushAdapter').PushAdapterConfig;
  anthropic?: import('./channels/anthropicAdapter').AnthropicAdapterConfig;
  sms?: import('./channels/smsAdapter').SmsAdapterConfig;
  supabase?: unknown; // for push adapter
}

export class CommunicationLayer {
  private store: ConversationStore;
  private killSwitch: KillSwitch;
  private rateLimiter: RateLimiter;
  private classifier: MessageClassifier;

  // Channel adapters
  private heidiCore: HeidiCoreAdapter;
  private email: EmailAdapter;
  private push: PushAdapter;
  private anthropic: AnthropicAdapter;
  private sms: SmsAdapter;

  // Capability cache
  private capabilityCache: Map<ChannelId, ChannelDescriptor> = new Map();
  private capabilityCacheAt: number = 0;
  private readonly capabilityCacheTtlMs = 10000;

  constructor(config?: CommunicationLayerConfig) {
    this.store = config?.store || new ConversationStore();
    this.killSwitch = new KillSwitch(this.store);
    this.rateLimiter = new RateLimiter(this.store);
    this.classifier = new MessageClassifier();

    this.heidiCore = new HeidiCoreAdapter(config?.heidiCore);
    this.email = new EmailAdapter(config?.email);
    this.push = new PushAdapter(config?.push ? { ...config.push, supabase: config.supabase } : { supabase: config?.supabase });
    this.anthropic = new AnthropicAdapter(config?.anthropic);
    this.sms = new SmsAdapter(config?.sms);
  }

  // ─── Capability Discovery ───────────────────────────────────────────

  async getCapabilities(): Promise<ChannelDescriptor[]> {
    if (Date.now() - this.capabilityCacheAt < this.capabilityCacheTtlMs && this.capabilityCache.size > 0) {
      return Array.from(this.capabilityCache.values());
    }

    const descriptors: ChannelDescriptor[] = [];

    // Heidi Core — check reachability
    const heidiDesc = this.heidiCore.getDescriptor();
    heidiDesc.runtimeReachable = await this.heidiCore.checkReachability();
    if (!heidiDesc.runtimeReachable) {
      heidiDesc.status = 'degraded';
      heidiDesc.blocker = 'Heidi Core not reachable at configured URL';
    }
    descriptors.push(heidiDesc);

    // Email
    descriptors.push(this.email.getDescriptor());

    // Push
    const pushDesc = this.push.getDescriptor();
    descriptors.push(pushDesc);

    // Anthropic
    const anthropicDesc = this.anthropic.getDescriptor();
    if (anthropicDesc.credentialsConfigured) {
      anthropicDesc.runtimeReachable = await this.anthropic.checkReachability();
    }
    descriptors.push(anthropicDesc);

    // SMS
    descriptors.push(this.sms.getDescriptor());

    // Update cache
    this.capabilityCache.clear();
    for (const d of descriptors) {
      this.capabilityCache.set(d.channelId, d);
    }
    this.capabilityCacheAt = Date.now();

    return descriptors;
  }

  async getChannelStatus(channelId: ChannelId): Promise<ChannelDescriptor | null> {
    const caps = await this.getCapabilities();
    return caps.find((c) => c.channelId === channelId) || null;
  }

  // ─── Conversations ──────────────────────────────────────────────────

  async createConversation(input: {
    ownerUserId?: string | null;
    channelId: ChannelId;
    title?: string | null;
    prospectId?: string | null;
    customerId?: string | null;
    opportunityId?: string | null;
    supportCaseId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConversationRecord> {
    const conv = await this.store.createConversation(input);
    await this.store.recordEvent({
      eventType: 'conversation_created',
      channelId: input.channelId,
      conversationId: conv.conversationId,
      actor: input.ownerUserId || 'system',
      metadata: { title: input.title, prospectId: input.prospectId, customerId: input.customerId },
    });
    return conv;
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    return this.store.getConversation(conversationId);
  }

  async listConversations(filter: {
    ownerUserId?: string;
    prospectId?: string;
    customerId?: string;
    channelId?: ChannelId;
    status?: ConversationStatus;
    limit?: number;
  }): Promise<ConversationRecord[]> {
    return this.store.listConversations(filter);
  }

  async closeConversation(conversationId: string, actor: string): Promise<ConversationRecord | null> {
    const conv = await this.store.updateConversationStatus(conversationId, 'closed');
    if (conv) {
      await this.store.recordEvent({
        eventType: 'conversation_closed',
        channelId: conv.channelId,
        conversationId,
        actor,
        metadata: {},
      });
    }
    return conv;
  }

  async escalateConversation(conversationId: string, actor: string, reason: string): Promise<ConversationRecord | null> {
    const conv = await this.store.updateConversationStatus(conversationId, 'escalated');
    if (conv) {
      await this.store.recordEvent({
        eventType: 'conversation_escalated',
        channelId: conv.channelId,
        conversationId,
        actor,
        metadata: { reason },
      });
    }
    return conv;
  }

  // ─── Messages ───────────────────────────────────────────────────────

  async getMessages(conversationId: string, limit?: number): Promise<MessageRecord[]> {
    return this.store.getMessages(conversationId, { limit });
  }

  // ─── Inbound ────────────────────────────────────────────────────────

  async receiveMessage(message: InboundMessage): Promise<InboundProcessingResult> {
    // 1. Classify
    const classification = this.classifier.classify(message.content);

    // 2. Find or create conversation
    let conversation: ConversationRecord | null = null;
    if (message.conversationId) {
      conversation = await this.store.getConversation(message.conversationId);
    }
    if (!conversation) {
      conversation = await this.store.createConversation({
        channelId: message.channelId,
        classification: classification.classification,
        metadata: { source: 'inbound', senderId: message.senderId },
      });
    }

    // 3. Persist inbound message
    const inboundMsgId = `in-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const msg = await this.store.appendMessage({
      conversationId: conversation.conversationId,
      messageId: inboundMsgId,
      direction: 'inbound',
      senderType: 'user',
      senderId: message.senderId,
      recipientId: message.recipientId,
      channelId: message.channelId,
      content: message.content,
      contentType: message.contentType || 'text',
      deliveryStatus: 'delivered',
      processingStatus: 'processed',
      metadata: { ...message.metadata, classification },
    });

    // 4. Record audit event
    const auditEvent = await this.store.recordEvent({
      eventType: 'inbound_received',
      channelId: message.channelId,
      conversationId: conversation.conversationId,
      messageId: msg.messageId,
      actor: message.senderId,
      metadata: { classification: classification.classification, confidence: classification.confidence },
    });

    // 5. Determine if escalation is needed
    const escalated = classification.classification === 'ESCALATION' || classification.classification === 'SECURITY';
    if (escalated) {
      await this.store.updateConversationStatus(conversation.conversationId, 'escalated');
    }

    // 6. Build authorization context for any potential response
    const authContext: AuthorizationContext = {
      actor: 'heidi',
      actionType: 'answer_faq',
      riskLevel: 'R0',
      authorizationMode: 'autonomous',
      authorized: true,
      reason: 'inbound response — autonomous within policy',
      policyReference: 'answer_faq',
      timestamp: new Date().toISOString(),
    };

    return {
      messageId: msg.messageId,
      conversationId: conversation.conversationId,
      classification,
      authorization: authContext,
      response: null, // response is generated by the caller or HEIDI decision engine
      escalated,
      auditReference: auditEvent.eventId,
    };
  }

  // ─── Outbound ───────────────────────────────────────────────────────

  async sendMessage(request: OutboundMessageRequest): Promise<OutboundMessageResult> {
    const messageId = `out-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 1. Kill switch check
    if (!(await this.killSwitch.isOutboundAllowed())) {
      const ksStatus = await this.killSwitch.getStatus();
      return this.denyOutbound(request, messageId, 'killed', `kill switch active: ${ksStatus}`);
    }

    // 2. Policy evaluation
    const hasExistingRelationship = !!(request.prospectId || request.customerId || request.opportunityId);
    const evaluation = communicationPolicyModel.evaluate(request.actionType, {
      actor: request.actor,
      recipientId: request.recipientId,
      conversationId: request.conversationId || 'none',
      hasExistingRelationship,
      hasConsent: hasExistingRelationship, // assume consent for existing relationships
      isAutonomous: request.actor === 'heidi' || request.actor === 'system',
    });

    if (!evaluation.authorized) {
      const authContext = communicationPolicyModel.buildAuthorizationContext(request.actionType, request.actor, evaluation);
      await this.store.recordEvent({
        eventType: 'authorization_denied',
        channelId: request.channelId,
        conversationId: request.conversationId || null,
        actor: request.actor,
        actionType: request.actionType,
        riskLevel: evaluation.riskLevel,
        authorizationMode: evaluation.authorizationMode,
        authorized: false,
        metadata: { reason: evaluation.reason, messageId },
      });
      return this.denyOutbound(request, messageId, 'suppressed', evaluation.reason, authContext);
    }

    // 3. Rate limit check
    let conversationId = request.conversationId;
    if (!conversationId) {
      const conv = await this.store.createConversation({
        channelId: request.channelId,
        prospectId: request.prospectId,
        customerId: request.customerId,
        opportunityId: request.opportunityId,
        metadata: { source: 'outbound', purpose: request.purpose },
      });
      conversationId = conv.conversationId;
    }

    const rateLimitResult = await this.rateLimiter.check(
      request.actionType,
      request.recipientId,
      conversationId,
      request.channelId,
    );

    if (!rateLimitResult.allowed) {
      return this.denyOutbound(request, messageId, 'rate_limited', rateLimitResult.reason, undefined, conversationId);
    }

    // 4. Execute via channel adapter
    const authContext = communicationPolicyModel.buildAuthorizationContext(request.actionType, request.actor, evaluation);
    let deliveryStatus: DeliveryStatus = 'pending';
    let providerResponse: Record<string, unknown> | null = null;
    let error: string | null = null;
    let providerMessageId: string | null = null;

    try {
      const result = await this.executeViaChannel(request);
      if (result.success) {
        deliveryStatus = 'sent';
        providerResponse = result as unknown as Record<string, unknown>;
        providerMessageId = result.providerMessageId || null;
      } else {
        deliveryStatus = 'failed';
        error = result.error || 'Unknown provider error';
      }
    } catch (e) {
      deliveryStatus = 'failed';
      error = e instanceof Error ? e.message : 'Unknown error';
    }

    // 5. Persist outbound message
    const msg = await this.store.appendMessage({
      conversationId,
      messageId,
      direction: 'outbound',
      senderType: request.actor === 'heidi' || request.actor === 'system' ? 'agent' : 'operator',
      senderId: request.actor,
      recipientId: request.recipientId,
      channelId: request.channelId,
      content: request.content,
      contentType: request.contentType || 'text',
      deliveryStatus,
      processingStatus: deliveryStatus === 'sent' ? 'processed' : 'failed',
      authorizationContext: authContext as unknown as Record<string, unknown>,
      providerMessageId,
      metadata: {
        ...request.metadata,
        purpose: request.purpose,
        actionType: request.actionType,
        riskLevel: evaluation.riskLevel,
      },
    });

    // 6. Update delivery status if provider gave us a message ID
    if (providerMessageId && deliveryStatus === 'sent') {
      await this.store.updateDeliveryStatus(messageId, 'sent', providerMessageId);
    }

    // 7. Record audit event
    const eventType = deliveryStatus === 'sent' ? 'outbound_sent' :
      deliveryStatus === 'failed' ? 'outbound_failed' :
        deliveryStatus === 'killed' ? 'outbound_killed' :
          deliveryStatus === 'rate_limited' ? 'outbound_rate_limited' :
            'outbound_suppressed';

    const auditEvent = await this.store.recordEvent({
      eventType,
      channelId: request.channelId,
      conversationId,
      messageId: msg.messageId,
      actor: request.actor,
      actionType: request.actionType,
      riskLevel: evaluation.riskLevel,
      authorizationMode: evaluation.authorizationMode,
      authorized: evaluation.authorized,
      metadata: {
        recipientId: request.recipientId,
        providerMessageId,
        error,
        purpose: request.purpose,
      },
    });

    return {
      messageId: msg.messageId,
      conversationId,
      deliveryStatus,
      authorization: authContext,
      auditReference: auditEvent.eventId,
      providerResponse,
      error,
    };
  }

  // ─── Chat (AI conversation) ─────────────────────────────────────────

  async chat(input: {
    message: string;
    conversationId?: string;
    channelId?: ChannelId;
    userId?: string;
    model?: string;
    preferLocal?: boolean;
  }): Promise<{ text: string; provider: string; model: string; conversationId: string; error: string | null }> {
    const channelId = input.channelId || 'heidi_core';
    const preferLocal = input.preferLocal !== false; // default to local-first

    // Find or create conversation
    let conversation: ConversationRecord | null = null;
    if (input.conversationId) {
      conversation = await this.store.getConversation(input.conversationId);
    }
    if (!conversation) {
      conversation = await this.store.createConversation({
        channelId,
        ownerUserId: input.userId,
        metadata: { source: 'chat' },
      });
    }

    // Persist the user's message
    const userMsgId = `chat-in-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.store.appendMessage({
      conversationId: conversation.conversationId,
      messageId: userMsgId,
      direction: 'inbound',
      senderType: 'user',
      senderId: input.userId || 'anonymous',
      recipientId: 'heidi',
      channelId,
      content: input.message,
      deliveryStatus: 'delivered',
      processingStatus: 'processed',
    });

    // Provider selection: local-first
    let text = '';
    let provider = '';
    let model = '';
    let error: string | null = null;

    if (preferLocal) {
      // Try Heidi Core first
      const heidiStatus = await this.heidiCore.checkReachability();
      if (heidiStatus) {
        const result = await this.heidiCore.chat({ message: input.message, model: input.model });
        if (result.text) {
          text = result.text;
          provider = result.provider;
          model = result.model;
        } else {
          error = result.error;
        }
      }
    }

    // Fallback to Anthropic if local failed and cloud is configured
    if (!text && this.anthropic.isConfigured() && !preferLocal) {
      const result = await this.anthropic.chat({
        message: input.message,
        sessionId: conversation.conversationId,
        userId: input.userId || 'anonymous',
      });
      if (result.text) {
        text = result.text;
        provider = result.provider;
        model = result.model;
      } else {
        error = result.error;
      }
    }

    if (!text && !error) {
      error = 'No AI provider available — both local and cloud providers failed or are unconfigured';
    }

    // Persist the assistant's response
    const assistantMsgId = `chat-out-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.store.appendMessage({
      conversationId: conversation.conversationId,
      messageId: assistantMsgId,
      direction: 'outbound',
      senderType: 'agent',
      senderId: 'heidi',
      recipientId: input.userId || 'anonymous',
      channelId,
      content: text || `[error: ${error}]`,
      deliveryStatus: text ? 'sent' : 'failed',
      processingStatus: text ? 'processed' : 'failed',
      authorizationContext: {
        actor: 'heidi',
        actionType: 'answer_faq',
        riskLevel: 'R0',
        authorizationMode: 'autonomous',
        authorized: true,
      },
      metadata: { provider, model, error },
    });

    // Record audit
    await this.store.recordEvent({
      eventType: text ? 'outbound_sent' : 'outbound_failed',
      channelId,
      conversationId: conversation.conversationId,
      messageId: assistantMsgId,
      actor: 'heidi',
      actionType: 'answer_faq',
      riskLevel: 'R0',
      authorizationMode: 'autonomous',
      authorized: true,
      metadata: { provider, model, error, userMessageId: userMsgId },
    });

    return {
      text,
      provider,
      model,
      conversationId: conversation.conversationId,
      error,
    };
  }

  // ─── Authorization ──────────────────────────────────────────────────

  authorizeAction(actionType: OutboundMessageRequest['actionType'], context: {
    actor: string;
    recipientId: string;
    hasExistingRelationship: boolean;
    hasConsent: boolean;
  }): AuthorizationContext {
    const evaluation = communicationPolicyModel.evaluate(actionType, {
      actor: context.actor,
      recipientId: context.recipientId,
      conversationId: 'authorization_check',
      hasExistingRelationship: context.hasExistingRelationship,
      hasConsent: context.hasConsent,
      isAutonomous: context.actor === 'heidi' || context.actor === 'system',
    });
    return communicationPolicyModel.buildAuthorizationContext(actionType, context.actor, evaluation);
  }

  // ─── Delivery Verification ──────────────────────────────────────────

  async verifyDelivery(messageId: string): Promise<{ status: DeliveryStatus; providerMessageId: string | null }> {
    const msg = await this.store.getMessage(messageId);
    if (!msg) return { status: 'failed', providerMessageId: null };
    return { status: msg.deliveryStatus, providerMessageId: msg.providerMessageId };
  }

  // ─── Audit ──────────────────────────────────────────────────────────

  async auditCommunication(filter: {
    conversationId?: string;
    channelId?: ChannelId;
    eventType?: string;
    actor?: string;
    limit?: number;
  }): Promise<CommunicationEvent[]> {
    return this.store.getEvents(filter);
  }

  // ─── Kill Switch ────────────────────────────────────────────────────

  async activateKillSwitch(reason: string, activatedBy: string): Promise<void> {
    await this.killSwitch.activate(reason, activatedBy);
    await this.store.recordEvent({
      eventType: 'kill_switch_activated',
      channelId: 'notification',
      actor: activatedBy,
      metadata: { reason },
    });
  }

  async deactivateKillSwitch(activatedBy: string): Promise<void> {
    await this.killSwitch.deactivate(activatedBy);
    await this.store.recordEvent({
      eventType: 'kill_switch_deactivated',
      channelId: 'notification',
      actor: activatedBy,
      metadata: {},
    });
  }

  async getKillSwitchStatus(): Promise<{ status: string; reason: string | null }> {
    return this.store.getKillSwitchStatus();
  }

  // ─── Health ─────────────────────────────────────────────────────────

  async getHealth(): Promise<{
    killSwitch: string;
    channels: Array<{ channelId: ChannelId; status: string; reachable: boolean }>;
  }> {
    const caps = await this.getCapabilities();
    const ksStatus = await this.killSwitch.getStatus();
    return {
      killSwitch: ksStatus,
      channels: caps.map((c) => ({
        channelId: c.channelId,
        status: c.status,
        reachable: c.runtimeReachable,
      })),
    };
  }

  // ─── Internal: Channel Execution ────────────────────────────────────

  private async executeViaChannel(request: OutboundMessageRequest): Promise<{
    success: boolean;
    providerMessageId: string | null;
    error: string | null;
  }> {
    switch (request.channelId) {
      case 'email': {
        const result = await this.email.send({
          to: request.recipientId,
          subject: request.metadata?.subject as string || request.purpose,
          text: request.content,
          html: request.metadata?.html as string | undefined,
        });
        return result;
      }
      case 'sms': {
        const result = await this.sms.send({
          to: request.recipientId,
          body: request.content,
        });
        return result;
      }
      case 'notification': {
        const result = await this.push.send({
          category: (request.metadata?.category as string) || 'task_completed',
          title: request.purpose,
          body: request.content,
          deviceId: request.metadata?.deviceId as string | undefined,
          metadata: request.metadata,
        });
        return { success: result.success, providerMessageId: result.notificationId, error: result.error };
      }
      case 'heidi_core':
      case 'web_chat':
      case 'mobile_chat': {
        // Chat channels don't use sendMessage — they use chat()
        return {
          success: false,
          providerMessageId: null,
          error: `Channel ${request.channelId} uses chat(), not sendMessage()`,
        };
      }
      default:
        return {
          success: false,
          providerMessageId: null,
          error: `Unsupported outbound channel: ${request.channelId}`,
        };
    }
  }

  private async denyOutbound(
    request: OutboundMessageRequest,
    messageId: string,
    status: DeliveryStatus,
    reason: string,
    authContext?: AuthorizationContext,
    conversationId?: string,
  ): Promise<OutboundMessageResult> {
    const convId = conversationId || request.conversationId || '';

    // Still persist the denied message for audit
    if (convId) {
      await this.store.appendMessage({
        conversationId: convId,
        messageId,
        direction: 'outbound',
        senderType: request.actor === 'heidi' || request.actor === 'system' ? 'agent' : 'operator',
        senderId: request.actor,
        recipientId: request.recipientId,
        channelId: request.channelId,
        content: request.content,
        deliveryStatus: status,
        processingStatus: 'failed',
        authorizationContext: authContext as unknown as Record<string, unknown> | undefined,
        metadata: { reason, purpose: request.purpose, actionType: request.actionType },
      });
    }

    await this.store.recordEvent({
      eventType: status === 'killed' ? 'outbound_killed' :
        status === 'rate_limited' ? 'outbound_rate_limited' :
          'outbound_suppressed',
      channelId: request.channelId,
      conversationId: convId || null,
      actor: request.actor,
      actionType: request.actionType,
      authorized: false,
      metadata: { reason, recipientId: request.recipientId },
    });

    return {
      messageId,
      conversationId: convId,
      deliveryStatus: status,
      authorization: authContext || {
        actor: request.actor,
        actionType: request.actionType,
        riskLevel: 'R5',
        authorizationMode: 'prohibited',
        authorized: false,
        reason,
        policyReference: null,
        timestamp: new Date().toISOString(),
      },
      auditReference: messageId,
      providerResponse: null,
      error: reason,
    };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.store.close();
  }
}

// Singleton instance
let _instance: CommunicationLayer | null = null;

export function getCommunicationLayer(config?: CommunicationLayerConfig): CommunicationLayer {
  if (!_instance) {
    _instance = new CommunicationLayer(config);
  }
  return _instance;
}

export function resetCommunicationLayer(): void {
  if (_instance) {
    _instance.close().catch(() => { });
    _instance = null;
  }
}
