/**
 * HEIDI Communication Layer — Conversation Store
 *
 * Persistence layer for conversations and messages. Uses the existing
 * chat_conversations, chat_messages, and communication_events tables
 * via direct PostgreSQL (same pattern as lib/revenue/RevenueDatabase.ts).
 *
 * Responsibilities:
 *   - create / get / list / close / escalate conversations
 *   - append inbound and outbound messages
 *   - retrieve message history (chronological)
 *   - update delivery / processing status
 *   - record audit events
 *   - enforce idempotency via message_id uniqueness
 *
 * Does NOT perform authorization or policy checks — that is the
 * CommunicationLayer's job. This module is a pure data access layer.
 */

import { Pool, QueryResultRow } from 'pg';
import type {
  ConversationRecord,
  MessageRecord,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  DeliveryStatus,
  ChannelId,
  CommunicationEvent,
  CommunicationEventInput,
} from './types';

interface DBConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

interface ConversationRow extends QueryResultRow {
  id: string;
  owner_user_id: string | null;
  channel: string;
  title: string | null;
  status: string;
  prospect_id: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  support_case_id: string | null;
  classification: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface MessageRow extends QueryResultRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  sender_type: string;
  sender_id: string | null;
  recipient_id: string | null;
  direction: string;
  channel: string;
  content: string;
  content_type: string;
  reply_to: string | null;
  delivery_status: string;
  processing_status: string;
  authorization_context: Record<string, unknown> | null;
  audit_reference: string | null;
  provider_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  delivered_at: string | null;
}

export class ConversationStore {
  private pool: Pool;

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  private async queryOne<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null> {
    const result = await this.pool.query<T>(text, params as never[]);
    return result.rows.length > 0 ? result.rows[0] : null;
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
    classification?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConversationRecord> {
    const row = await this.queryOne<ConversationRow>(
      `INSERT INTO chat_conversations
         (owner_user_id, channel, title, prospect_id, customer_id, opportunity_id, support_case_id, classification, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.ownerUserId || null,
        input.channelId,
        input.title || null,
        input.prospectId || null,
        input.customerId || null,
        input.opportunityId || null,
        input.supportCaseId || null,
        input.classification || null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    if (!row) throw new Error('Conversation insert returned no row');
    return this.mapConversation(row);
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    const row = await this.queryOne<ConversationRow>(
      `SELECT * FROM chat_conversations WHERE id = $1`,
      [conversationId],
    );
    return row ? this.mapConversation(row) : null;
  }

  async listConversations(filter: {
    ownerUserId?: string;
    prospectId?: string;
    customerId?: string;
    channelId?: ChannelId;
    status?: ConversationStatus;
    limit?: number;
  }): Promise<ConversationRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.ownerUserId) {
      conditions.push(`owner_user_id = $${idx++}`);
      params.push(filter.ownerUserId);
    }
    if (filter.prospectId) {
      conditions.push(`prospect_id = $${idx++}`);
      params.push(filter.prospectId);
    }
    if (filter.customerId) {
      conditions.push(`customer_id = $${idx++}`);
      params.push(filter.customerId);
    }
    if (filter.channelId) {
      conditions.push(`channel = $${idx++}`);
      params.push(filter.channelId);
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 50;
    params.push(limit);

    const rows = await this.pool.query<ConversationRow>(
      `SELECT * FROM chat_conversations ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return rows.rows.map((r) => this.mapConversation(r));
  }

  async updateConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<ConversationRecord | null> {
    const closedAt = status === 'closed' || status === 'archived' ? new Date().toISOString() : null;
    const row = await this.queryOne<ConversationRow>(
      `UPDATE chat_conversations
       SET status = $1, closed_at = COALESCE($2, closed_at)
       WHERE id = $3
       RETURNING *`,
      [status, closedAt, conversationId],
    );
    return row ? this.mapConversation(row) : null;
  }

  // ─── Messages ───────────────────────────────────────────────────────

  async appendMessage(input: {
    conversationId: string;
    messageId: string;
    direction: MessageDirection;
    senderType: MessageSenderType;
    senderId: string;
    recipientId: string;
    channelId: ChannelId;
    content: string;
    contentType?: 'text' | 'json' | 'html' | 'system';
    replyTo?: string | null;
    deliveryStatus?: DeliveryStatus;
    processingStatus?: 'pending' | 'processed' | 'failed' | 'escalated';
    authorizationContext?: Record<string, unknown> | null;
    auditReference?: string | null;
    providerMessageId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<MessageRecord> {
    // Idempotency: if message_id already exists, return the existing row
    const existing = await this.queryOne<MessageRow>(
      `SELECT * FROM chat_messages WHERE message_id = $1`,
      [input.messageId],
    );
    if (existing) return this.mapMessage(existing);

    const row = await this.queryOne<MessageRow>(
      `INSERT INTO chat_messages
         (conversation_id, message_id, direction, sender_type, sender_id, recipient_id,
          channel, content, content_type, reply_to, delivery_status, processing_status,
          authorization_context, audit_reference, provider_message_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        input.conversationId,
        input.messageId,
        input.direction,
        input.senderType,
        input.senderId,
        input.recipientId,
        input.channelId,
        input.content,
        input.contentType || 'text',
        input.replyTo || null,
        input.deliveryStatus || 'pending',
        input.processingStatus || 'pending',
        input.authorizationContext ? JSON.stringify(input.authorizationContext) : null,
        input.auditReference || null,
        input.providerMessageId || null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    if (!row) throw new Error('Message insert returned no row');
    return this.mapMessage(row);
  }

  async getMessage(messageId: string): Promise<MessageRecord | null> {
    // messageId can be either our internal message_id or the UUID primary key
    const row = await this.queryOne<MessageRow>(
      // `id::text` rather than `id = $1`. `id` is uuid and `message_id` is text,
      // and CommunicationLayer generates ids like "out-1757...-a1b2" — never
      // uuids. Comparing those against a uuid column made Postgres reject the
      // whole query with "invalid input syntax for type uuid", so getMessage()
      // threw for every real message rather than returning null. Casting the
      // column keeps the uuid lookup working without parsing the parameter.
      `SELECT * FROM chat_messages WHERE message_id = $1 OR id::text = $1`,
      [messageId],
    );
    return row ? this.mapMessage(row) : null;
  }

  async getMessages(
    conversationId: string,
    options?: { limit?: number; before?: string },
  ): Promise<MessageRecord[]> {
    const limit = options?.limit || 100;
    if (options?.before) {
      const rows = await this.pool.query<MessageRow>(
        `SELECT * FROM chat_messages
         WHERE conversation_id = $1 AND created_at < $2
         ORDER BY created_at DESC LIMIT $3`,
        [conversationId, options.before, limit],
      );
      return rows.rows.reverse().map((r) => this.mapMessage(r));
    }
    const rows = await this.pool.query<MessageRow>(
      `SELECT * FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC LIMIT $2`,
      [conversationId, limit],
    );
    return rows.rows.map((r) => this.mapMessage(r));
  }

  async updateDeliveryStatus(
    messageId: string,
    status: DeliveryStatus,
    providerMessageId?: string,
  ): Promise<MessageRecord | null> {
    const deliveredAt = status === 'delivered' || status === 'read' ? new Date().toISOString() : null;
    const row = await this.queryOne<MessageRow>(
      `UPDATE chat_messages
       SET delivery_status = $1, delivered_at = COALESCE($2, delivered_at),
           provider_message_id = COALESCE($3, provider_message_id)
       WHERE message_id = $4 OR id = $4
       RETURNING *`,
      [status, deliveredAt, providerMessageId || null, messageId],
    );
    return row ? this.mapMessage(row) : null;
  }

  async updateProcessingStatus(
    messageId: string,
    status: 'pending' | 'processed' | 'failed' | 'escalated',
  ): Promise<MessageRecord | null> {
    const row = await this.queryOne<MessageRow>(
      `UPDATE chat_messages SET processing_status = $1 WHERE message_id = $2 OR id = $2 RETURNING *`,
      [status, messageId],
    );
    return row ? this.mapMessage(row) : null;
  }

  // ─── Audit Events ───────────────────────────────────────────────────

  async recordEvent(event: CommunicationEventInput): Promise<CommunicationEvent> {
    const eventId = event.eventId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const row = await this.queryOne<QueryResultRow>(
      `INSERT INTO communication_events
         (event_id, event_type, channel, conversation_id, message_id, actor,
          action_type, risk_level, authorization_mode, authorized, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        eventId,
        event.eventType,
        event.channelId,
        event.conversationId ?? null,
        event.messageId ?? null,
        event.actor,
        event.actionType ?? null,
        event.riskLevel ?? null,
        event.authorizationMode ?? null,
        event.authorized ?? null,
        JSON.stringify(event.metadata || {}),
      ],
    );
    if (!row) throw new Error('Event insert returned no row');
    return {
      eventId: row.event_id,
      eventType: row.event_type,
      channelId: row.channel,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      actor: row.actor,
      actionType: row.action_type,
      riskLevel: row.risk_level,
      authorizationMode: row.authorization_mode,
      authorized: row.authorized,
      metadata: row.metadata,
      timestamp: row.created_at,
    };
  }

  async getEvents(filter: {
    conversationId?: string;
    channelId?: ChannelId;
    eventType?: string;
    actor?: string;
    limit?: number;
  }): Promise<CommunicationEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.conversationId) {
      conditions.push(`conversation_id = $${idx++}`);
      params.push(filter.conversationId);
    }
    if (filter.channelId) {
      conditions.push(`channel = $${idx++}`);
      params.push(filter.channelId);
    }
    if (filter.eventType) {
      conditions.push(`event_type = $${idx++}`);
      params.push(filter.eventType);
    }
    if (filter.actor) {
      conditions.push(`actor = $${idx++}`);
      params.push(filter.actor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 100;
    params.push(limit);

    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM communication_events ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return rows.rows.map((r) => ({
      eventId: r.event_id,
      eventType: r.event_type,
      channelId: r.channel,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      actor: r.actor,
      actionType: r.action_type,
      riskLevel: r.risk_level,
      authorizationMode: r.authorization_mode,
      authorized: r.authorized,
      metadata: r.metadata,
      timestamp: r.created_at,
    }));
  }

  // ─── Kill Switch ────────────────────────────────────────────────────

  async getKillSwitchStatus(): Promise<{ status: string; reason: string | null; activatedAt: string | null; activatedBy: string | null }> {
    const row = await this.queryOne<QueryResultRow>(
      `SELECT status, reason, activated_at, activated_by FROM communication_kill_switch WHERE id = 1`,
    );
    if (!row) return { status: 'active', reason: null, activatedAt: null, activatedBy: null };
    return {
      status: row.status,
      reason: row.reason,
      activatedAt: row.activated_at,
      activatedBy: row.activated_by,
    };
  }

  async setKillSwitchStatus(
    status: 'active' | 'disabled' | 'emergency_stop',
    reason?: string | null,
    activatedBy?: string | null,
  ): Promise<void> {
    const activatedAt = status !== 'active' ? new Date().toISOString() : null;
    await this.pool.query(
      `UPDATE communication_kill_switch
       SET status = $1, reason = $2, activated_at = $3, activated_by = $4, updated_at = now()
       WHERE id = 1`,
      [status, reason ?? null, activatedAt, activatedBy ?? null],
    );
  }

  // ─── Rate Limit Counters ────────────────────────────────────────────

  async countOutboundInWindow(
    recipientId: string,
    channelId: ChannelId,
    windowMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const row = await this.queryOne<{ count: string }>(
      `SELECT count(*) as count FROM chat_messages
       WHERE direction = 'outbound' AND recipient_id = $1 AND channel = $2
         AND created_at >= $3 AND delivery_status NOT IN ('killed', 'suppressed')`,
      [recipientId, channelId, since],
    );
    return row ? parseInt(row.count, 10) : 0;
  }

  async countOutboundInConversationInWindow(
    conversationId: string,
    windowMs: number,
  ): Promise<number> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const row = await this.queryOne<{ count: string }>(
      `SELECT count(*) as count FROM chat_messages
       WHERE direction = 'outbound' AND conversation_id = $1
         AND created_at >= $2 AND delivery_status NOT IN ('killed', 'suppressed')`,
      [conversationId, since],
    );
    return row ? parseInt(row.count, 10) : 0;
  }

  async lastOutboundTimestamp(
    recipientId: string,
    channelId: ChannelId,
  ): Promise<string | null> {
    const row = await this.queryOne<{ created_at: string }>(
      `SELECT created_at FROM chat_messages
       WHERE direction = 'outbound' AND recipient_id = $1 AND channel = $2
         AND delivery_status NOT IN ('killed', 'suppressed')
       ORDER BY created_at DESC LIMIT 1`,
      [recipientId, channelId],
    );
    return row?.created_at || null;
  }

  // ─── Mapping ────────────────────────────────────────────────────────

  private mapConversation(row: ConversationRow): ConversationRecord {
    return {
      conversationId: row.id,
      ownerUserId: row.owner_user_id,
      channelId: row.channel as ChannelId,
      status: row.status as ConversationStatus,
      title: row.title,
      prospectId: row.prospect_id,
      customerId: row.customer_id,
      opportunityId: row.opportunity_id,
      supportCaseId: row.support_case_id,
      classification: row.classification as ConversationRecord['classification'],
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
    };
  }

  private mapMessage(row: MessageRow): MessageRecord {
    return {
      messageId: row.message_id || row.id,
      conversationId: row.conversation_id,
      direction: row.direction as MessageDirection,
      senderType: row.sender_type as MessageSenderType,
      senderId: row.sender_id || '',
      recipientId: row.recipient_id || '',
      channelId: row.channel as ChannelId,
      content: row.content,
      contentType: row.content_type as MessageRecord['contentType'],
      replyTo: row.reply_to,
      deliveryStatus: row.delivery_status as DeliveryStatus,
      processingStatus: row.processing_status as MessageRecord['processingStatus'],
      authorizationContext: row.authorization_context as MessageRecord['authorizationContext'],
      auditReference: row.audit_reference,
      providerMessageId: row.provider_message_id,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

