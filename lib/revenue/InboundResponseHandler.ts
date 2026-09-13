/**
 * Inbound Response Handler
 *
 * Handles inbound communications from prospects/customers.
 *
 * HEIDI may autonomously:
 * - receive messages
 * - classify them
 * - store them
 * - summarize them
 * - identify intent
 * - associate with an opportunity
 * - update opportunity state
 * - recommend next action
 * - prepare a response draft
 *
 * HEIDI must NOT:
 * - impersonate the human owner
 * - make contractual commitments
 * - negotiate unrestricted pricing
 * - promise refunds
 * - accept binding agreements
 */

import type { ProspectRecord, OpportunityRecord } from './types';
import { MessageClassifier } from '../communication/messageClassifier';
import type { ClassificationResult } from '../communication/types';

export interface InboundMessage {
  messageId: string;
  receivedAt: string;
  channel: 'email' | 'sms' | 'linkedin' | 'web_form';
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  body: string;
  prospectId: string | null;
  opportunityId: string | null;
}

export interface InboundResponseResult {
  messageId: string;
  classification: ClassificationResult;
  intent: InboundIntent;
  associatedProspectId: string | null;
  associatedOpportunityId: string | null;
  recommendedNextAction: string;
  responseDraft: string | null;
  opportunityStatusUpdate: string | null;
  requiresHumanAction: boolean;
  humanActionReason: string | null;
}

export type InboundIntent =
  | 'interested'
  | 'requesting_more_info'
  | 'scheduling_request'
  | 'pricing_inquiry'
  | 'objection'
  | 'not_interested'
  | 'opt_out'
  | 'support_request'
  | 'spam'
  | 'unknown';

export class InboundResponseHandler {
  private classifier: MessageClassifier;

  constructor() {
    this.classifier = new MessageClassifier();
  }

  /**
   * Process an inbound message.
   *
   * This is an R0 action — HEIDI may autonomously receive, classify,
   * and store inbound messages. However, responding autonomously
   * may require R2 authorization depending on the intent.
   */
  async processInbound(
    message: InboundMessage,
    prospects: ProspectRecord[],
    opportunities: OpportunityRecord[],
  ): Promise<InboundResponseResult> {
    // 1. Classify the message
    const classification = this.classifier.classify(message.body || message.subject || '');

    // 2. Identify intent
    const intent = this.identifyIntent(message, classification);

    // 3. Associate with prospect (if not already)
    let associatedProspectId = message.prospectId;
    if (!associatedProspectId) {
      const matched = this.matchProspect(message, prospects);
      if (matched) {
        associatedProspectId = matched.prospectId;
      }
    }

    // 4. Associate with opportunity
    let associatedOpportunityId = message.opportunityId;
    if (!associatedOpportunityId && associatedProspectId) {
      const opp = opportunities.find((o) => o.prospectId === associatedProspectId && o.status === 'open');
      if (opp) {
        associatedOpportunityId = opp.opportunityId;
      }
    }

    // 5. Determine recommended next action
    const { recommendedNextAction, opportunityStatusUpdate, requiresHumanAction, humanActionReason } =
      this.determineNextAction(intent, classification);

    // 6. Prepare response draft (if appropriate)
    const responseDraft = this.prepareResponseDraft(intent, message, associatedProspectId);

    return {
      messageId: message.messageId,
      classification,
      intent,
      associatedProspectId,
      associatedOpportunityId,
      recommendedNextAction,
      responseDraft,
      opportunityStatusUpdate,
      requiresHumanAction,
      humanActionReason,
    };
  }

  private identifyIntent(message: InboundMessage, classification: ClassificationResult): InboundIntent {
    const text = `${message.subject || ''} ${message.body || ''}`.toLowerCase();

    // Opt-out check (highest priority — compliance)
    if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('stop') || text.includes('remove me')) {
      return 'opt_out';
    }

    // Spam check
    if (classification.classification === 'SPAM') {
      return 'spam';
    }

    // Interest signals
    if (text.includes('interested') || text.includes('tell me more') || text.includes('sounds good')) {
      return 'interested';
    }

    // More info request
    if (text.includes('more information') || text.includes('more info') || text.includes('details') || text.includes('what does it include')) {
      return 'requesting_more_info';
    }

    // Scheduling
    if (text.includes('schedule') || text.includes('call') || text.includes('meeting') || text.includes('appointment') || text.includes('demo')) {
      return 'scheduling_request';
    }

    // Pricing
    if (text.includes('price') || text.includes('cost') || text.includes('how much') || text.includes('pricing') || text.includes('budget')) {
      return 'pricing_inquiry';
    }

    // Objection
    if (text.includes('not sure') || text.includes('concern') || text.includes('but') || text.includes('however')) {
      return 'objection';
    }

    // Not interested
    if (text.includes('not interested') || text.includes('no thanks') || text.includes('pass') || text.includes('decline')) {
      return 'not_interested';
    }

    // Support
    if (classification.classification === 'CUSTOMER_SUPPORT') {
      return 'support_request';
    }

    return 'unknown';
  }

  private matchProspect(message: InboundMessage, prospects: ProspectRecord[]): ProspectRecord | null {
    // Try to match by email
    if (message.fromAddress) {
      const emailMatch = prospects.find((p) => p.contactEmail === message.fromAddress);
      if (emailMatch) return emailMatch;
    }

    // Try to match by name in body
    if (message.fromName) {
      const nameMatch = prospects.find((p) => p.contactName === message.fromName);
      if (nameMatch) return nameMatch;
    }

    return null;
  }

  private determineNextAction(
    intent: InboundIntent,
    classification: ClassificationResult,
  ): {
    recommendedNextAction: string;
    opportunityStatusUpdate: string | null;
    requiresHumanAction: boolean;
    humanActionReason: string | null;
  } {
    switch (intent) {
      case 'interested':
        return {
          recommendedNextAction: 'Advance opportunity to "qualified" status and schedule a discovery call',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Scheduling a call requires R2 authorization (appointment scheduling)',
        };

      case 'requesting_more_info':
        return {
          recommendedNextAction: 'Prepare and send detailed information about AI Operations',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Sending outbound information requires R2 authorization',
        };

      case 'scheduling_request':
        return {
          recommendedNextAction: 'Schedule a discovery call with the prospect',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Appointment scheduling requires R2 authorization',
        };

      case 'pricing_inquiry':
        return {
          recommendedNextAction: 'Prepare pricing response with offer details',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Pricing discussions require human authorization to ensure consistency',
        };

      case 'objection':
        return {
          recommendedNextAction: 'Prepare objection response with evidence',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Objection handling requires human judgment',
        };

      case 'not_interested':
        return {
          recommendedNextAction: 'Mark opportunity as lost and add prospect to low-priority list',
          opportunityStatusUpdate: 'lost',
          requiresHumanAction: false,
          humanActionReason: null,
        };

      case 'opt_out':
        return {
          recommendedNextAction: 'Add prospect to suppression list immediately',
          opportunityStatusUpdate: 'opted_out',
          requiresHumanAction: false,
          humanActionReason: null,
        };

      case 'support_request':
        return {
          recommendedNextAction: 'Route to support team and prepare support response',
          opportunityStatusUpdate: null,
          requiresHumanAction: true,
          humanActionReason: 'Support responses require human authorization',
        };

      case 'spam':
        return {
          recommendedNextAction: 'Ignore and mark as spam',
          opportunityStatusUpdate: null,
          requiresHumanAction: false,
          humanActionReason: null,
        };

      default:
        return {
          recommendedNextAction: 'Review message and determine appropriate response',
          opportunityStatusUpdate: 'responded',
          requiresHumanAction: true,
          humanActionReason: 'Unknown intent requires human review',
        };
    }
  }

  private prepareResponseDraft(
    intent: InboundIntent,
    message: InboundMessage,
    prospectId: string | null,
  ): string | null {
    // Only prepare drafts for intents that warrant a response
    if (intent === 'opt_out' || intent === 'spam' || intent === 'not_interested') {
      return null;
    }

    if (intent === 'interested') {
      return `Thank you for your interest! I'd be happy to schedule a brief discovery call to learn more about your needs and show you how our AI Operations can help. What times work best for you this week?

— Prepared by HEIDI (requires human approval before sending)`;
    }

    if (intent === 'requesting_more_info') {
      return `Thank you for reaching out. Here's more information about our AI Operations Setup:

- AI-powered lead capture and qualification
- Automated customer communication workflows
- Monitoring and analytics dashboard
- Integration with your existing tools

The setup is $500 one-time, with an optional $299/month for ongoing optimization.

Would you like to schedule a call to discuss specifics?

— Prepared by HEIDI (requires human approval before sending)`;
    }

    if (intent === 'scheduling_request') {
      return `I'd be happy to schedule a call! Please let me know a few times that work for you, and we'll get it set up.

— Prepared by HEIDI (requires human approval before sending)`;
    }

    if (intent === 'pricing_inquiry') {
      return `Our AI Operations pricing is straightforward:

- Setup: $500 one-time
- Monthly service: $299/month (optional, can cancel anytime)

The setup includes lead capture, automated workflows, and analytics. The monthly service covers ongoing optimization and support.

Would you like to proceed?

— Prepared by HEIDI (requires human approval before sending)`;
    }

    return `Thank you for your message. I've received it and will get back to you shortly.

— Prepared by HEIDI (requires human approval before sending)`;
  }
}
