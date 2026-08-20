/**
 * HEIDI Message Classifier
 *
 * Classifies inbound messages into communication categories. Uses
 * keyword-based intent detection (extracted from the chat-operator
 * edge function) with a deterministic fallback. This is NOT an LLM —
 * it is a fast, deterministic first-pass classifier that decides
 * routing and authorization class.
 *
 * The classifier never grants authority. It only suggests a class.
 * The CommunicationLayer's policy model decides what is authorized.
 */

import type { ClassificationResult, MessageClassification, ExtractedEntity } from './types';

interface ClassificationRule {
  classification: MessageClassification;
  keywords: string[];
  confidence: number;
}

const RULES: ClassificationRule[] = [
  // Sales / Lead
  {
    classification: 'LEAD',
    keywords: ['interested', 'pricing', 'quote', 'demo', 'trial', 'sign up', 'subscribe', 'buy', 'purchase'],
    confidence: 0.8,
  },
  {
    classification: 'SALES',
    keywords: ['offer', 'proposal', 'contract', 'discount', 'deal', 'upgrade', 'plan'],
    confidence: 0.75,
  },

  // Customer Support
  {
    classification: 'CUSTOMER_SUPPORT',
    keywords: ['help', 'support', 'ticket', 'issue', 'problem', 'broken', 'not working', 'error', 'bug'],
    confidence: 0.8,
  },
  {
    classification: 'CUSTOMER_SUPPORT',
    keywords: ['refund', 'cancel', 'cancel subscription', 'money back', 'chargeback'],
    confidence: 0.9,
  },

  // Operations
  {
    classification: 'OPERATIONS',
    keywords: ['status', 'order', 'track', 'shipping', 'delivery', 'invoice', 'receipt'],
    confidence: 0.7,
  },

  // Escalation
  {
    classification: 'ESCALATION',
    keywords: ['escalate', 'manager', 'supervisor', 'complaint', 'legal', 'attorney', 'lawyer'],
    confidence: 0.9,
  },

  // Security
  {
    classification: 'SECURITY',
    keywords: ['security', 'breach', 'hack', 'unauthorized', 'password', 'credential', 'phishing'],
    confidence: 0.9,
  },

  // System Alert
  {
    classification: 'SYSTEM_ALERT',
    keywords: ['alert', 'down', 'outage', 'maintenance', 'degraded', 'unavailable'],
    confidence: 0.8,
  },

  // Spam
  {
    classification: 'SPAM',
    keywords: ['viagra', 'casino', 'lottery', 'winner', 'free money', 'click here', 'limited time'],
    confidence: 0.7,
  },
];

export class MessageClassifier {
  classify(message: string): ClassificationResult {
    const lower = message.toLowerCase();
    const entities = this.extractEntities(message);

    for (const rule of RULES) {
      for (const keyword of rule.keywords) {
        if (lower.includes(keyword)) {
          return {
            classification: rule.classification,
            confidence: rule.confidence,
            reason: `matched keyword "${keyword}" → ${rule.classification}`,
            entities,
          };
        }
      }
    }

    return {
      classification: 'GENERAL',
      confidence: 0.5,
      reason: 'no specific keywords matched — classified as general inquiry',
      entities,
    };
  }

  private extractEntities(message: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Email addresses
    const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g);
    if (emailMatch) {
      for (const email of emailMatch) {
        entities.push({ type: 'email', value: email });
      }
    }

    // Phone numbers (basic)
    const phoneMatch = message.match(/\+?[1-9]\d{6,14}/g);
    if (phoneMatch) {
      for (const phone of phoneMatch) {
        if (phone.length >= 7) entities.push({ type: 'phone', value: phone });
      }
    }

    // Order/invoice/ticket IDs
    const idMatch = message.match(/(?:order|invoice|ticket|case)\s*#?\s*(\w+)/gi);
    if (idMatch) {
      for (const m of idMatch) {
        const parts = m.split(/[#\s]+/);
        if (parts.length > 1) {
          entities.push({ type: 'reference_id', value: parts[parts.length - 1] });
        }
      }
    }

    // Amounts
    const amountMatch = message.match(/\$(\d+(?:\.\d{2})?)/g);
    if (amountMatch) {
      for (const amt of amountMatch) {
        entities.push({ type: 'amount', value: amt });
      }
    }

    return entities;
  }
}
