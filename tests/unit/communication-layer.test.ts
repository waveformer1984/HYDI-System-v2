/**
 * HEIDI Communication Layer — Comprehensive Test Suite
 *
 * Tests:
 *   - Policy model: authorization for each risk level
 *   - Message classifier: intent detection
 *   - Kill switch: activation, deactivation, emergency stop
 *   - Rate limiter: per-recipient and per-conversation limits
 *   - Conversation store: CRUD, idempotency, message history
 *   - Channel adapters: email validation, SMS validation, push categories
 *   - CommunicationLayer: end-to-end chat, outbound, inbound, audit
 *   - Revenue bridge: prospect outreach, follow-up, support
 *   - Security: kill switch blocks outbound, policy denies unauthorized
 */

import { CommunicationLayer } from '../../lib/communication/communicationLayer';
import { ConversationStore } from '../../lib/communication/conversationStore';
import { communicationPolicyModel } from '../../lib/communication/policyModel';
import { MessageClassifier } from '../../lib/communication/messageClassifier';
import { KillSwitch } from '../../lib/communication/killSwitch';
import { RateLimiter } from '../../lib/communication/rateLimiter';
import { EmailAdapter } from '../../lib/communication/channels/emailAdapter';
import { SmsAdapter } from '../../lib/communication/channels/smsAdapter';
import { HeidiCoreAdapter } from '../../lib/communication/channels/heidiCoreAdapter';
import { RevenueCommunicationBridge } from '../../lib/communication/revenueBridge';
import type { CommunicationActionType } from '../../lib/communication/types';

// Use a unique recipient per test to avoid rate limit interference
let testCounter = 0;
function uniqueRecipient(prefix = 'test'): string {
  testCounter++;
  return `${prefix}-${testCounter}-${Date.now()}@test.example`;
}

describe('Communication Policy Model', () => {
  test('R0 actions are autonomously allowed', () => {
    const result = communicationPolicyModel.evaluate('acknowledge', {
      actor: 'heidi',
      recipientId: 'user@test',
      conversationId: 'conv-1',
      hasExistingRelationship: false,
      hasConsent: false,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(true);
    expect(result.riskLevel).toBe('R0');
    expect(result.authorizationMode).toBe('autonomous');
  });

  test('R1 prospect outreach is autonomously allowed', () => {
    const result = communicationPolicyModel.evaluate('prospect_outreach', {
      actor: 'heidi',
      recipientId: 'prospect@test',
      conversationId: 'conv-1',
      hasExistingRelationship: false,
      hasConsent: false,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(true);
    expect(result.riskLevel).toBe('R1');
  });

  test('R2 sales follow-up requires existing relationship', () => {
    const result = communicationPolicyModel.evaluate('sales_follow_up', {
      actor: 'heidi',
      recipientId: 'prospect@test',
      conversationId: 'conv-1',
      hasExistingRelationship: false,
      hasConsent: false,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('existing relationship');
  });

  test('R3 contractual commitment requires human authorization', () => {
    const result = communicationPolicyModel.evaluate('contractual_commitment', {
      actor: 'heidi',
      recipientId: 'customer@test',
      conversationId: 'conv-1',
      hasExistingRelationship: true,
      hasConsent: true,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(false);
    expect(result.authorizationMode).toBe('human_required');
  });

  test('R5 unrestricted communication is prohibited', () => {
    const result = communicationPolicyModel.evaluate('unrestricted_communication', {
      actor: 'heidi',
      recipientId: 'anyone@test',
      conversationId: 'conv-1',
      hasExistingRelationship: true,
      hasConsent: true,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(false);
    expect(result.authorizationMode).toBe('prohibited');
  });

  test('R3 actions allowed when actor is human', () => {
    const result = communicationPolicyModel.evaluate('contractual_commitment', {
      actor: 'human-operator',
      recipientId: 'customer@test',
      conversationId: 'conv-1',
      hasExistingRelationship: true,
      hasConsent: true,
      isAutonomous: false,
    });
    expect(result.authorized).toBe(true);
  });

  test('unknown action type is denied', () => {
    const result = communicationPolicyModel.evaluate('unknown_action' as CommunicationActionType, {
      actor: 'heidi',
      recipientId: 'test@test',
      conversationId: 'conv-1',
      hasExistingRelationship: true,
      hasConsent: true,
      isAutonomous: true,
    });
    expect(result.authorized).toBe(false);
  });

  test('rate limits are returned correctly', () => {
    const limits = communicationPolicyModel.getRateLimits('prospect_outreach');
    expect(limits.maxPerRecipientPerHour).toBe(2);
    expect(limits.cooldownMs).toBe(3600000);
  });
});

describe('Message Classifier', () => {
  const classifier = new MessageClassifier();

  test('classifies lead messages', () => {
    const result = classifier.classify('I am interested in your pricing and want a demo');
    expect(result.classification).toBe('LEAD');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  test('classifies support messages', () => {
    const result = classifier.classify('I need help with a bug in the system');
    expect(result.classification).toBe('CUSTOMER_SUPPORT');
  });

  test('classifies escalation messages', () => {
    const result = classifier.classify('I want to escalate this to a manager');
    expect(result.classification).toBe('ESCALATION');
  });

  test('classifies security messages', () => {
    const result = classifier.classify('I think there was a security breach');
    expect(result.classification).toBe('SECURITY');
  });

  test('classifies general messages', () => {
    const result = classifier.classify('Hello, how are you?');
    expect(result.classification).toBe('GENERAL');
  });

  test('extracts email entities', () => {
    const result = classifier.classify('Please contact me at john@example.com');
    const emailEntity = result.entities.find((e) => e.type === 'email');
    expect(emailEntity).toBeDefined();
    expect(emailEntity!.value).toBe('john@example.com');
  });

  test('extracts amount entities', () => {
    const result = classifier.classify('I want a refund for $99.99');
    const amountEntity = result.entities.find((e) => e.type === 'amount');
    expect(amountEntity).toBeDefined();
    expect(amountEntity!.value).toBe('$99.99');
  });
});

describe('Email Adapter', () => {
  test('reports unconfigured when no API key', () => {
    const adapter = new EmailAdapter({ apiKey: undefined, fromAddress: undefined });
    expect(adapter.isConfigured()).toBe(false);
    const desc = adapter.getDescriptor();
    expect(desc.status).toBe('unconfigured');
    expect(desc.blocker).toContain('RESEND_API_KEY');
  });

  test('validates recipient email', () => {
    const adapter = new EmailAdapter({ apiKey: 'test-key', fromAddress: 'noreply@test.com' });
    expect(adapter.validateRecipient('valid@email.com')).toBe(true);
    expect(adapter.validateRecipient('invalid')).toBe(false);
    expect(adapter.validateRecipient('missing@domain')).toBe(false);
  });

  test('refuses to send when unconfigured', async () => {
    const adapter = new EmailAdapter({ apiKey: undefined, fromAddress: undefined });
    const result = await adapter.send({ to: 'test@test.com', subject: 'Test', text: 'Hello' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  test('rejects invalid recipient', async () => {
    const adapter = new EmailAdapter({ apiKey: 'test-key', fromAddress: 'noreply@test.com' });
    const result = await adapter.send({ to: 'invalid', subject: 'Test', text: 'Hello' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid recipient');
  });
});

describe('SMS Adapter', () => {
  test('reports unconfigured when no Twilio credentials', () => {
    const adapter = new SmsAdapter({});
    expect(adapter.isConfigured()).toBe(false);
    const desc = adapter.getDescriptor();
    expect(desc.status).toBe('unconfigured');
  });

  test('validates phone numbers', () => {
    const adapter = new SmsAdapter({ accountSid: 'test', authToken: 'test', fromNumber: '+1234567890' });
    expect(adapter.validatePhoneNumber('+1234567890')).toBe(true);
    expect(adapter.validatePhoneNumber('123')).toBe(false);
  });

  test('rejects SMS body over 1600 chars', async () => {
    const adapter = new SmsAdapter({ accountSid: 'test', authToken: 'test', fromNumber: '+1234567890' });
    const longBody = 'x'.repeat(1601);
    const result = await adapter.send({ to: '+1234567890', body: longBody });
    expect(result.success).toBe(false);
    expect(result.error).toContain('1600 character limit');
  });
});

describe('Heidi Core Adapter', () => {
  test('descriptor reports local-first configuration', () => {
    const adapter = new HeidiCoreAdapter({ baseUrl: 'http://localhost:3459' });
    const desc = adapter.getDescriptor();
    expect(desc.channelId).toBe('heidi_core');
    expect(desc.credentialsConfigured).toBe(true);
    expect(desc.metadata.baseUrl).toBe('http://localhost:3459');
  });

  test('checkReachability returns boolean', async () => {
    const adapter = new HeidiCoreAdapter({ baseUrl: 'http://localhost:3459', timeoutMs: 5000 });
    const reachable = await adapter.checkReachability();
    expect(typeof reachable).toBe('boolean');
  });
});

describe('Conversation Store (integration)', () => {
  let store: ConversationStore;

  beforeAll(() => {
    store = new ConversationStore();
  });

  afterAll(async () => {
    await store.close();
  });

  test('creates and retrieves a conversation', async () => {
    const conv = await store.createConversation({
      channelId: 'email',
      title: 'Test conversation',
      prospectId: 'prospect-test-1',
      metadata: { source: 'test' },
    });

    expect(conv.conversationId).toBeDefined();
    expect(conv.channelId).toBe('email');
    expect(conv.prospectId).toBe('prospect-test-1');

    const retrieved = await store.getConversation(conv.conversationId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.conversationId).toBe(conv.conversationId);
  });

  test('appends messages and retrieves them chronologically', async () => {
    const conv = await store.createConversation({
      channelId: 'web_chat',
      metadata: { source: 'test' },
    });

    const msg1 = await store.appendMessage({
      conversationId: conv.conversationId,
      messageId: `test-msg-1-${Date.now()}`,
      direction: 'inbound',
      senderType: 'user',
      senderId: 'user-1',
      recipientId: 'heidi',
      channelId: 'web_chat',
      content: 'Hello',
      deliveryStatus: 'delivered',
    });

    const msg2 = await store.appendMessage({
      conversationId: conv.conversationId,
      messageId: `test-msg-2-${Date.now()}`,
      direction: 'outbound',
      senderType: 'agent',
      senderId: 'heidi',
      recipientId: 'user-1',
      channelId: 'web_chat',
      content: 'Hi there!',
      deliveryStatus: 'sent',
    });

    const messages = await store.getMessages(conv.conversationId);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi there!');
  });

  test('idempotency: duplicate message_id returns existing message', async () => {
    const conv = await store.createConversation({
      channelId: 'email',
      metadata: { source: 'test' },
    });

    const messageId = `idempotent-msg-${Date.now()}`;
    const msg1 = await store.appendMessage({
      conversationId: conv.conversationId,
      messageId,
      direction: 'outbound',
      senderType: 'agent',
      senderId: 'heidi',
      recipientId: 'test@test.com',
      channelId: 'email',
      content: 'First insert',
      deliveryStatus: 'sent',
    });

    const msg2 = await store.appendMessage({
      conversationId: conv.conversationId,
      messageId,
      direction: 'outbound',
      senderType: 'agent',
      senderId: 'heidi',
      recipientId: 'test@test.com',
      channelId: 'email',
      content: 'Second insert should be ignored',
      deliveryStatus: 'sent',
    });

    expect(msg1.messageId).toBe(msg2.messageId);
    expect(msg2.content).toBe('First insert');
  });

  test('records and retrieves audit events', async () => {
    const event = await store.recordEvent({
      eventType: 'outbound_sent',
      channelId: 'email',
      actor: 'heidi',
      actionType: 'prospect_outreach',
      riskLevel: 'R1',
      authorized: true,
      metadata: { test: true },
    });

    expect(event.eventId).toBeDefined();
    expect(event.eventType).toBe('outbound_sent');

    const events = await store.getEvents({ actor: 'heidi', limit: 1 });
    expect(events.length).toBeGreaterThan(0);
  });

  test('kill switch status can be read and updated', async () => {
    const status = await store.getKillSwitchStatus();
    expect(status.status).toBe('active');

    await store.setKillSwitchStatus('disabled', 'test reason', 'test-actor');
    const updated = await store.getKillSwitchStatus();
    expect(updated.status).toBe('disabled');
    expect(updated.reason).toBe('test reason');

    // Reset for other tests
    await store.setKillSwitchStatus('active', undefined, 'test-actor');
  });
});

describe('Communication Layer (integration)', () => {
  let layer: CommunicationLayer;

  beforeAll(() => {
    layer = new CommunicationLayer();
  });

  afterAll(async () => {
    await layer.close();
  });

  test('getCapabilities returns all channels', async () => {
    const caps = await layer.getCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    const channelIds = caps.map((c) => c.channelId);
    expect(channelIds).toContain('heidi_core');
    expect(channelIds).toContain('email');
    expect(channelIds).toContain('notification');
    expect(channelIds).toContain('web_chat');
    expect(channelIds).toContain('sms');
  });

  test('createConversation and getConversation work', async () => {
    const conv = await layer.createConversation({
      channelId: 'email',
      title: 'E2E test',
      prospectId: 'prospect-e2e-1',
    });
    expect(conv.conversationId).toBeDefined();

    const retrieved = await layer.getConversation(conv.conversationId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('E2E test');
  });

  test('receiveMessage classifies and persists inbound', async () => {
    const result = await layer.receiveMessage({
      channelId: 'web_chat',
      senderId: 'test-user-1',
      recipientId: 'heidi',
      content: 'I am interested in your pricing',
      receivedAt: new Date().toISOString(),
    });

    expect(result.conversationId).toBeDefined();
    expect(result.classification.classification).toBe('LEAD');
    expect(result.auditReference).toBeDefined();
  });

  test('sendMessage denies R5 unrestricted communication', async () => {
    const result = await layer.sendMessage({
      channelId: 'email',
      recipientId: uniqueRecipient('deny'),
      content: 'test',
      actionType: 'unrestricted_communication',
      actor: 'heidi',
      purpose: 'test',
    });

    expect(result.deliveryStatus).toBe('suppressed');
    expect(result.authorization.authorized).toBe(false);
  });

  test('sendMessage denies R3 contractual for autonomous actor', async () => {
    const result = await layer.sendMessage({
      channelId: 'email',
      recipientId: uniqueRecipient('contract'),
      content: 'I commit to a contract',
      actionType: 'contractual_commitment',
      actor: 'heidi',
      purpose: 'test contractual',
      customerId: 'customer-1',
    });

    expect(result.deliveryStatus).toBe('suppressed');
    expect(result.authorization.authorizationMode).toBe('human_required');
  });

  test('kill switch blocks all outbound', async () => {
    await layer.activateKillSwitch('test activation', 'test-suite');

    const result = await layer.sendMessage({
      channelId: 'email',
      recipientId: uniqueRecipient('kill'),
      content: 'should be blocked',
      actionType: 'acknowledge',
      actor: 'heidi',
      purpose: 'test kill switch',
    });

    expect(result.deliveryStatus).toBe('killed');
    expect(result.error).toContain('kill switch');

    await layer.deactivateKillSwitch('test-suite');
  });

  test('audit trail records outbound events', async () => {
    const recipient = uniqueRecipient('audit');
    const result = await layer.sendMessage({
      channelId: 'email',
      recipientId: recipient,
      content: 'audit test',
      actionType: 'acknowledge',
      actor: 'heidi',
      purpose: 'audit test',
    });

    const events = await layer.auditCommunication({
      actor: 'heidi',
      limit: 10,
    });

    expect(events.length).toBeGreaterThan(0);
  });

  test('chat returns a response from Heidi Core (if reachable)', async () => {
    // Heidi Core streaming can take >30s on CPU — allow up to 120s
    const result = await layer.chat({
      message: 'hello',
      preferLocal: true,
    });

    expect(result.conversationId).toBeDefined();
    // text may be empty if Heidi Core is not running, but error should be set
    if (!result.text) {
      expect(result.error).toBeDefined();
    } else {
      expect(result.provider).toBe('heidi_core');
    }
  }, 120000);
});

describe('Revenue Communication Bridge (integration)', () => {
  let bridge: RevenueCommunicationBridge;
  let layer: CommunicationLayer;

  beforeAll(() => {
    layer = new CommunicationLayer();
    bridge = new RevenueCommunicationBridge(layer);
  });

  afterAll(async () => {
    await layer.close();
  });

  test('prospectOutreach creates a conversation linked to prospect', async () => {
    const recipient = uniqueRecipient('prospect');
    const result = await bridge.prospectOutreach({
      prospectId: 'prospect-bridge-1',
      prospectEmail: recipient,
      prospectName: 'Test Prospect',
      message: 'Hello, we would love to work with you!',
      actor: 'heidi',
    });

    expect(result.conversationId).toBeDefined();
    // Email is not configured in test env, so delivery will fail
    // but the conversation should still be created
    const conv = await layer.getConversation(result.conversationId);
    expect(conv).not.toBeNull();
    expect(conv!.prospectId).toBe('prospect-bridge-1');
  });

  test('getConversationsForProspect returns linked conversations', async () => {
    const recipient = uniqueRecipient('prospect-list');
    await bridge.prospectOutreach({
      prospectId: 'prospect-list-1',
      prospectEmail: recipient,
      message: 'Test message',
      actor: 'heidi',
    });

    const conversations = await bridge.getConversationsForProspect('prospect-list-1');
    expect(conversations.length).toBeGreaterThan(0);
    expect(conversations.some((c) => c.prospectId === 'prospect-list-1')).toBe(true);
  });
});
