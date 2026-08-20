/**
 * HEIDI Communication Layer — Canonical Types
 *
 * Every communication action in HYDI must use these types.
 * This ensures that identity, authorization, policy, execution,
 * causality, and observation remain separable and auditable.
 *
 * Design principles:
 *   - identity ≠ permission ≠ policy ≠ execution ≠ causality ≠ observation
 *   - autonomy must be governed
 *   - all communication is auditable
 *   - all outbound is idempotent
 *   - message content never grants authority
 */

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ChannelId =
  | 'heidi_core'           // Local Heidi Core brain (Ollama-backed)
  | 'web_chat'              // Next.js streaming chat (/api/chat)
  | 'mobile_chat'           // Mobile chat server (port 3006)
  | 'websocket'             // WebSocket chat portal (port 3005)
  | 'sse_events'            // SSE event stream (api/events/stream.js)
  | 'notification'          // Web-push notification framework
  | 'email'                 // Email via Resend/SendGrid/SMTP
  | 'sms'                   // SMS via Twilio
  | 'webhook'               // Outbound webhook delivery
  | 'pao_notification'      // PAO notification service
  | 'chat_operator'         // Supabase chat-operator edge function
  ;

export type ChannelDirection = 'inbound' | 'outbound' | 'bidirectional';

export type ChannelStatus =
  | 'active'                // operational and reachable
  | 'degraded'              // partially working
  | 'disabled'              // intentionally disabled
  | 'unconfigured'          // missing credentials/configuration
  | 'stub'                  // implementation is a stub/mock
  | 'not_found'             // not implemented
  ;

export interface ChannelDescriptor {
  channelId: ChannelId;
  name: string;
  direction: ChannelDirection;
  status: ChannelStatus;
  inboundSupport: boolean;
  outboundSupport: boolean;
  persistenceSupport: boolean;
  credentialsConfigured: boolean;
  runtimeReachable: boolean;
  autonomySupport: boolean;
  blocker: string | null;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type ConversationStatus = 'active' | 'closed' | 'escalated' | 'archived';

export interface ConversationRecord {
  conversationId: string;
  ownerUserId: string | null;
  channelId: ChannelId;
  status: ConversationStatus;
  title: string | null;
  prospectId: string | null;
  customerId: string | null;
  opportunityId: string | null;
  supportCaseId: string | null;
  classification: MessageClassification | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderType = 'user' | 'system' | 'agent' | 'operator';
export type DeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'suppressed'
  | 'rate_limited'
  | 'killed';

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  senderId: string;
  recipientId: string;
  channelId: ChannelId;
  content: string;
  contentType: 'text' | 'json' | 'html' | 'system';
  replyTo: string | null;
  deliveryStatus: DeliveryStatus;
  processingStatus: 'pending' | 'processed' | 'failed' | 'escalated';
  authorizationContext: AuthorizationContext | null;
  auditReference: string | null;
  providerMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  deliveredAt: string | null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type MessageClassification =
  | 'GENERAL'
  | 'CUSTOMER_SUPPORT'
  | 'SALES'
  | 'LEAD'
  | 'OPERATIONS'
  | 'SYSTEM_ALERT'
  | 'SECURITY'
  | 'ESCALATION'
  | 'SPAM'
  | 'UNKNOWN';

export interface ClassificationResult {
  classification: MessageClassification;
  confidence: number;
  reason: string;
  entities: ExtractedEntity[];
}

export interface ExtractedEntity {
  type: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export type CommunicationRiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export type AuthorizationMode =
  | 'autonomous'
  | 'policy_authorized'
  | 'human_required'
  | 'prohibited';

export interface AuthorizationContext {
  actor: string;
  actionType: CommunicationActionType;
  riskLevel: CommunicationRiskLevel;
  authorizationMode: AuthorizationMode;
  authorized: boolean;
  reason: string;
  policyReference: string | null;
  timestamp: string;
}

export type CommunicationActionType =
  // R0 — autonomous, no financial impact
  | 'acknowledge'
  | 'answer_faq'
  | 'provide_status'
  | 'system_notification'
  // R1 — autonomous within compliance
  | 'prospect_outreach'
  | 'prospect_follow_up'
  | 'appointment_reminder'
  // R2 — policy-authorized within limits
  | 'sales_follow_up'
  | 'proposal_follow_up'
  | 'customer_onboarding'
  | 'support_response'
  | 'retention_message'
  | 'operational_alert'
  // R3 — human required
  | 'contractual_commitment'
  | 'price_change'
  | 'refund_communication'
  | 'legal_communication'
  // R4 — human required, high impact
  | 'escalation'
  | 'security_action'
  // R5 — prohibited autonomously
  | 'unrestricted_communication'
  ;

// ---------------------------------------------------------------------------
// Outbound Request
// ---------------------------------------------------------------------------

export interface OutboundMessageRequest {
  channelId: ChannelId;
  recipientId: string;
  conversationId?: string | null;
  content: string;
  contentType?: 'text' | 'json' | 'html';
  replyTo?: string | null;
  actionType: CommunicationActionType;
  actor: string;
  purpose: string;
  prospectId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessageResult {
  messageId: string;
  conversationId: string;
  deliveryStatus: DeliveryStatus;
  authorization: AuthorizationContext;
  auditReference: string;
  providerResponse: Record<string, unknown> | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Inbound Message
// ---------------------------------------------------------------------------

export interface InboundMessage {
  channelId: ChannelId;
  senderId: string;
  recipientId: string;
  content: string;
  contentType?: 'text' | 'json' | 'html';
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
  receivedAt: string;
}

export interface InboundProcessingResult {
  messageId: string;
  conversationId: string;
  classification: ClassificationResult;
  authorization: AuthorizationContext;
  response: MessageRecord | null;
  escalated: boolean;
  auditReference: string;
}

// ---------------------------------------------------------------------------
// Kill Switch
// ---------------------------------------------------------------------------

export type KillSwitchStatus = 'active' | 'disabled' | 'emergency_stop';

export interface KillSwitchState {
  status: KillSwitchStatus;
  reason: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
}

// ---------------------------------------------------------------------------
// Rate Limits
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  perChannelLimit: number;      // max messages per channel per window
  perRecipientLimit: number;    // max messages per recipient per window
  windowMs: number;             // time window in milliseconds
  retryLimit: number;           // max retries on failure
  retryDelayMs: number;         // delay between retries
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perChannelLimit: 100,
  perRecipientLimit: 10,
  windowMs: 60 * 1000,  // 1 minute
  retryLimit: 3,
  retryDelayMs: 5000,
};

// ---------------------------------------------------------------------------
// Communication Event (audit)
// ---------------------------------------------------------------------------

export interface CommunicationEvent {
  eventId: string;
  eventType: 'inbound_received' | 'outbound_sent' | 'outbound_failed' |
    'outbound_suppressed' | 'outbound_killed' | 'outbound_rate_limited' |
    'conversation_created' | 'conversation_closed' | 'conversation_escalated' |
    'authorization_granted' | 'authorization_denied' | 'kill_switch_activated' |
    'kill_switch_deactivated' | 'channel_status_changed';
  channelId: ChannelId;
  conversationId: string | null;
  messageId: string | null;
  actor: string;
  actionType: CommunicationActionType | null;
  riskLevel: CommunicationRiskLevel | null;
  authorizationMode: AuthorizationMode | null;
  authorized: boolean | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export type CommunicationEventInput = {
  eventId?: string;
  timestamp?: string;
  eventType: CommunicationEvent['eventType'];
  channelId: ChannelId;
  conversationId?: string | null;
  messageId?: string | null;
  actor: string;
  actionType?: CommunicationActionType | null;
  riskLevel?: CommunicationRiskLevel | null;
  authorizationMode?: AuthorizationMode | null;
  authorized?: boolean | null;
  metadata?: Record<string, unknown>;
};
