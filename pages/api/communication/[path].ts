/**
 * HEIDI Communication Layer API
 *
 * The canonical API surface for all HYDI communication. Every authorized
 * subsystem calls this route instead of provider-specific endpoints.
 *
 * Endpoints:
 *   GET  /api/communication/capabilities    — list channel capabilities
 *   GET  /api/communication/health          — layer health + kill switch
 *   GET  /api/communication/conversations   — list conversations
 *   POST /api/communication/conversations   — create conversation
 *   GET  /api/communication/conversations/:id — get conversation
 *   GET  /api/communication/conversations/:id/messages — get messages
 *   POST /api/communication/chat            — AI chat (local-first)
 *   POST /api/communication/send            — outbound message
 *   POST /api/communication/receive         — inbound message
 *   POST /api/communication/kill-switch     — activate/deactivate
 *   GET  /api/communication/audit           — audit trail
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getCommunicationLayer, CommunicationLayer } from '../../../lib/communication/communicationLayer';
import type { ChannelId, CommunicationActionType, OutboundMessageRequest } from '../../../lib/communication/types';

type Handler = (req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) => Promise<void> | void;

// Simple routing — matches /api/communication/<path>
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const layer = getCommunicationLayer();
    const path = req.query.path as string[] | undefined;
    const route = path ? path.join('/') : '';

    // Route table
    if (route === 'capabilities' && req.method === 'GET') {
      return handleGetCapabilities(req, res, layer);
    }
    if (route === 'health' && req.method === 'GET') {
      return handleGetHealth(req, res, layer);
    }
    if (route === 'conversations' && req.method === 'GET') {
      return handleListConversations(req, res, layer);
    }
    if (route === 'conversations' && req.method === 'POST') {
      return handleCreateConversation(req, res, layer);
    }
    if (route?.startsWith('conversations/') && route.endsWith('/messages') && req.method === 'GET') {
      return handleGetMessages(req, res, layer);
    }
    if (route?.startsWith('conversations/') && req.method === 'GET') {
      return handleGetConversation(req, res, layer);
    }
    if (route === 'chat' && req.method === 'POST') {
      return handleChat(req, res, layer);
    }
    if (route === 'send' && req.method === 'POST') {
      return handleSend(req, res, layer);
    }
    if (route === 'receive' && req.method === 'POST') {
      return handleReceive(req, res, layer);
    }
    if (route === 'kill-switch' && req.method === 'POST') {
      return handleKillSwitch(req, res, layer);
    }
    if (route === 'audit' && req.method === 'GET') {
      return handleAudit(req, res, layer);
    }

    return res.status(404).json({ error: `Unknown route: ${route}` });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── Handlers ──────────────────────────────────────────────────────────

async function handleGetCapabilities(_req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const caps = await layer.getCapabilities();
  return res.status(200).json({ capabilities: caps });
}

async function handleGetHealth(_req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const health = await layer.getHealth();
  return res.status(200).json(health);
}

async function handleListConversations(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { ownerUserId, prospectId, customerId, channelId, status, limit } = req.query;
  const conversations = await layer.listConversations({
    ownerUserId: ownerUserId as string | undefined,
    prospectId: prospectId as string | undefined,
    customerId: customerId as string | undefined,
    channelId: channelId as ChannelId | undefined,
    status: status as ConversationStatus | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  });
  return res.status(200).json({ conversations });
}

async function handleCreateConversation(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { ownerUserId, channelId, title, prospectId, customerId, opportunityId, supportCaseId, metadata } = req.body;
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }
  const conv = await layer.createConversation({
    ownerUserId: ownerUserId || null,
    channelId,
    title: title || null,
    prospectId: prospectId || null,
    customerId: customerId || null,
    opportunityId: opportunityId || null,
    supportCaseId: supportCaseId || null,
    metadata,
  });
  return res.status(201).json({ conversation: conv });
}

async function handleGetConversation(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const path = req.query.path as string[];
  const conversationId = path[1];
  const conv = await layer.getConversation(conversationId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  return res.status(200).json({ conversation: conv });
}

async function handleGetMessages(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const path = req.query.path as string[];
  const conversationId = path[1];
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const messages = await layer.getMessages(conversationId, limit);
  return res.status(200).json({ messages });
}

async function handleChat(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { message, conversationId, channelId, userId, model, preferLocal } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // SSE streaming response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const result = await layer.chat({
      message,
      conversationId,
      channelId,
      userId,
      model,
      preferLocal: preferLocal !== false,
    });

    res.write(`data: ${JSON.stringify({
      type: 'metadata',
      conversationId: result.conversationId,
      provider: result.provider,
      model: result.model,
    })}\n\n`);

    if (result.text) {
      res.write(`data: ${JSON.stringify({ type: 'content', content: result.text })}\n\n`);
    }
    if (result.error) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: result.error })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    })}\n\n`);
  }

  res.end();
}

async function handleSend(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { channelId, recipientId, conversationId, content, contentType, actionType, actor, purpose, prospectId, customerId, opportunityId, metadata } = req.body;

  if (!channelId || !recipientId || !content || !actionType || !actor || !purpose) {
    return res.status(400).json({
      error: 'Missing required fields: channelId, recipientId, content, actionType, actor, purpose',
    });
  }

  const request: OutboundMessageRequest = {
    channelId,
    recipientId,
    conversationId,
    content,
    contentType,
    actionType: actionType as CommunicationActionType,
    actor,
    purpose,
    prospectId,
    customerId,
    opportunityId,
    metadata,
  };

  const result = await layer.sendMessage(request);
  return res.status(result.deliveryStatus === 'sent' ? 200 : 403).json({ result });
}

async function handleReceive(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { channelId, senderId, recipientId, content, conversationId, metadata } = req.body;

  if (!channelId || !senderId || !content) {
    return res.status(400).json({
      error: 'Missing required fields: channelId, senderId, content',
    });
  }

  const result = await layer.receiveMessage({
    channelId,
    senderId,
    recipientId: recipientId || 'heidi',
    content,
    conversationId,
    metadata,
    receivedAt: new Date().toISOString(),
  });

  return res.status(200).json({ result });
}

async function handleKillSwitch(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { action, reason, activatedBy } = req.body;

  if (action === 'activate') {
    await layer.activateKillSwitch(reason || 'manual activation', activatedBy || 'api');
    return res.status(200).json({ status: 'disabled', message: 'Kill switch activated — outbound communication blocked' });
  }
  if (action === 'deactivate') {
    await layer.deactivateKillSwitch(activatedBy || 'api');
    return res.status(200).json({ status: 'active', message: 'Kill switch deactivated — outbound communication resumed' });
  }
  if (action === 'status') {
    const status = await layer.getKillSwitchStatus();
    return res.status(200).json({ status });
  }

  return res.status(400).json({ error: "Unknown action; expected 'activate', 'deactivate', or 'status'" });
}

async function handleAudit(req: NextApiRequest, res: NextApiResponse, layer: CommunicationLayer) {
  const { conversationId, channelId, eventType, actor, limit } = req.query;
  const events = await layer.auditCommunication({
    conversationId: conversationId as string | undefined,
    channelId: channelId as ChannelId | undefined,
    eventType: eventType as string | undefined,
    actor: actor as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  });
  return res.status(200).json({ events });
}

// Type import for ConversationStatus
type ConversationStatus = import('../../../lib/communication/types').ConversationStatus;
