/**
 * HYDI Offer Catalog
 *
 * Configurable commercial offers for the three revenue engines.
 * Pricing is configurable — the operator sets the actual price.
 * Defaults are sensible initial proposals that are easy to change.
 *
 * Engine 1: AI Operations Service (managed service)
 * Engine 2: Lead Generation (feeds Engine 1 and 3)
 * Engine 3: Productized Web + AI Deployment
 */

import type { CommercialOffer, OfferId } from './types';

// ---------------------------------------------------------------------------
// Default Offers — configurable via OfferCatalog.configure()
// ---------------------------------------------------------------------------

const DEFAULT_OFFERS: Record<OfferId, CommercialOffer> = {
  // Engine 1: AI Operations Service
  ai_operations_setup: {
    offerId: 'ai_operations_setup',
    name: 'AI Operations Setup',
    description: 'One-time setup of HEIDI AI Business Operations Package: lead capture, qualification, follow-up workflows, FAQ triage, and operational monitoring configuration.',
    category: 'ai_operations',
    setupPrice: 50000,       // $500.00 in cents
    recurringPrice: 0,
    billingInterval: 'one_time',
    includedCapabilities: [
      'lead_capture_setup',
      'lead_qualification_config',
      'follow_up_workflow',
      'faq_triage_setup',
      'email_response_assist',
      'operational_monitoring',
      'weekly_performance_report',
    ],
    usageLimits: {},
    implementationRequirements: [
      'business_process_discovery_call',
      'crm_or_lead_system_integration',
      'faq_knowledge_base_creation',
      'monitoring_threshold_configuration',
    ],
    marginTarget: 0.70,
    upgradePath: 'ai_operations_monthly',
    cancellationBehavior: 'Setup fee is non-refundable after work begins. Service continues until monthly subscription is cancelled.',
    active: true,
  },

  ai_operations_monthly: {
    offerId: 'ai_operations_monthly',
    name: 'AI Operations Monthly',
    description: 'Monthly managed AI Business Operations service: inbound lead capture, lead qualification, customer follow-up, appointment scheduling, FAQ triage, email response assistance, operational monitoring, weekly reporting, and human escalation when required.',
    category: 'ai_operations',
    setupPrice: 0,
    recurringPrice: 29900,   // $299.00/month in cents
    billingInterval: 'monthly',
    includedCapabilities: [
      'inbound_lead_capture',
      'lead_qualification',
      'customer_follow_up',
      'appointment_scheduling',
      'faq_customer_support_triage',
      'email_message_response',
      'business_process_automation',
      'operational_monitoring',
      'weekly_performance_reporting',
      'human_escalation',
    ],
    usageLimits: {
      maxLeadsPerMonth: 500,
      maxOutreachPerDay: 50,
      maxAppointmentsPerMonth: 100,
      maxSupportTicketsPerMonth: 200,
    },
    implementationRequirements: ['ai_operations_setup_completed'],
    marginTarget: 0.80,
    upgradePath: null,
    cancellationBehavior: 'Cancel anytime. Service continues until end of current billing period. No early termination fee.',
    active: true,
  },

  // Engine 3: Productized Web + AI Deployment
  ai_website_setup: {
    offerId: 'ai_website_setup',
    name: 'AI Website + Automation Setup',
    description: 'Fixed-scope website deployment with AI chatbot, lead-capture system, appointment workflow, and contact/CRM integration. Uses templates and reusable components.',
    category: 'website_deployment',
    setupPrice: 150000,      // $1,500.00 in cents
    recurringPrice: 0,
    billingInterval: 'one_time',
    includedCapabilities: [
      'business_website_deployment',
      'ai_chatbot_deployment',
      'lead_capture_system',
      'appointment_workflow',
      'contact_crm_integration',
      'analytics_reporting_setup',
    ],
    usageLimits: {
      maxPages: 10,
      maxChatbotIntents: 50,
    },
    implementationRequirements: [
      'domain_configuration',
      'content_gathering',
      'brand_asset_collection',
      'chatbot_training_data',
    ],
    marginTarget: 0.60,
    upgradePath: 'ai_website_monthly',
    cancellationBehavior: 'Setup fee is non-refundable after deployment begins. Deployed assets belong to the customer.',
    active: true,
  },

  ai_website_monthly: {
    offerId: 'ai_website_monthly',
    name: 'AI Website + Automation Monthly',
    description: 'Monthly hosting, monitoring, AI chatbot maintenance, analytics reporting, and automation integration for deployed websites.',
    category: 'website_deployment',
    setupPrice: 0,
    recurringPrice: 19900,   // $199.00/month in cents
    billingInterval: 'monthly',
    includedCapabilities: [
      'website_hosting',
      'ai_chatbot_maintenance',
      'analytics_reporting',
      'automation_integration',
      'uptime_monitoring',
      'security_updates',
    ],
    usageLimits: {
      maxBandwidthGb: 50,
      maxChatbotConversations: 1000,
    },
    implementationRequirements: ['ai_website_setup_completed'],
    marginTarget: 0.75,
    upgradePath: 'ai_operations_monthly',
    cancellationBehavior: 'Cancel anytime. Website remains live until end of billing period. Customer owns the deployed assets.',
    active: true,
  },

  // Engine 2: Lead Generation
  lead_gen_setup: {
    offerId: 'lead_gen_setup',
    name: 'Lead Generation Setup',
    description: 'One-time setup of autonomous prospecting system: ICP configuration, prospect identification, scoring system, outreach templates, and compliance controls.',
    category: 'lead_generation',
    setupPrice: 75000,       // $750.00 in cents
    recurringPrice: 0,
    billingInterval: 'one_time',
    includedCapabilities: [
      'icp_configuration',
      'prospect_identification',
      'prospect_scoring',
      'outreach_template_creation',
      'compliance_control_setup',
      'suppression_list_setup',
    ],
    usageLimits: {},
    implementationRequirements: [
      'icp_definition_call',
      'outreach_channel_authorization',
      'compliance_review',
    ],
    marginTarget: 0.65,
    upgradePath: 'lead_gen_monthly',
    cancellationBehavior: 'Setup fee is non-refundable after work begins. Prospect data belongs to the customer.',
    active: true,
  },

  lead_gen_monthly: {
    offerId: 'lead_gen_monthly',
    name: 'Lead Generation Monthly',
    description: 'Monthly autonomous prospecting and appointment-setting: prospect research, scoring, outreach, response tracking, qualification, appointment scheduling, and follow-up within policy.',
    category: 'lead_generation',
    setupPrice: 0,
    recurringPrice: 49900,   // $499.00/month in cents
    billingInterval: 'monthly',
    includedCapabilities: [
      'prospect_research',
      'prospect_scoring',
      'outreach_execution',
      'response_tracking',
      'response_classification',
      'prospect_qualification',
      'appointment_scheduling',
      'follow_up_within_policy',
      'conversion_rate_measurement',
      'segment_prioritization',
    ],
    usageLimits: {
      maxNewProspectsPerDay: 25,
      maxOutreachPerDay: 50,
      maxAppointmentsPerMonth: 30,
    },
    implementationRequirements: ['lead_gen_setup_completed'],
    marginTarget: 0.70,
    upgradePath: 'ai_operations_monthly',
    cancellationBehavior: 'Cancel anytime. Service continues until end of current billing period. Prospect data remains available to the customer.',
    active: true,
  },
};

// ---------------------------------------------------------------------------
// Offer Catalog
// ---------------------------------------------------------------------------

export class OfferCatalog {
  private offers: Map<OfferId, CommercialOffer> = new Map();

  constructor() {
    for (const [id, offer] of Object.entries(DEFAULT_OFFERS)) {
      this.offers.set(id as OfferId, { ...offer });
    }
  }

  /**
   * Get an offer by ID.
   */
  get(offerId: OfferId): CommercialOffer | null {
    const offer = this.offers.get(offerId);
    return offer ? { ...offer } : null;
  }

  /**
   * Get all active offers.
   */
  getActive(): CommercialOffer[] {
    return Array.from(this.offers.values())
      .filter((o) => o.active)
      .map((o) => ({ ...o }));
  }

  /**
   * Get all offers (including inactive).
   */
  getAll(): CommercialOffer[] {
    return Array.from(this.offers.values()).map((o) => ({ ...o }));
  }

  /**
   * Get offers by category.
   */
  getByCategory(category: CommercialOffer['category']): CommercialOffer[] {
    return this.getActive().filter((o) => o.category === category);
  }

  /**
   * Configure an offer — update pricing, capabilities, etc.
   * This is how the operator sets actual prices.
   */
  configure(offerId: OfferId, updates: Partial<CommercialOffer>): void {
    const existing = this.offers.get(offerId);
    if (!existing) {
      throw new Error(`Unknown offer: ${offerId}`);
    }
    this.offers.set(offerId, { ...existing, ...updates, offerId });
  }

  /**
   * Recommend the best offer for a prospect based on their needs.
   */
  recommendOffer(
    needs: string[],
    budget?: number,
  ): { recommended: OfferId; reason: string; alternatives: OfferId[] } {
    const active = this.getActive();

    // If prospect needs website + AI, recommend website setup
    if (needs.includes('website') || needs.includes('chatbot')) {
      return {
        recommended: 'ai_website_setup',
        reason: 'Prospect needs website/chatbot deployment — AI Website + Automation Setup is the best fit.',
        alternatives: ['ai_operations_setup'],
      };
    }

    // If prospect needs leads, recommend lead gen
    if (needs.includes('leads') || needs.includes('prospects') || needs.includes('appointments')) {
      return {
        recommended: 'lead_gen_setup',
        reason: 'Prospect needs lead generation — Lead Generation Setup is the best fit.',
        alternatives: ['ai_operations_setup'],
      };
    }

    // Default: AI Operations
    if (budget && budget < DEFAULT_OFFERS.ai_operations_setup.setupPrice) {
      // If budget is tight, still recommend setup but note the constraint
      return {
        recommended: 'ai_operations_setup',
        reason: 'AI Operations Setup is the foundational offer. Note: budget may require分期 or a smaller initial scope.',
        alternatives: ['lead_gen_setup'],
      };
    }

    return {
      recommended: 'ai_operations_setup',
      reason: 'AI Operations Setup is the recommended starting point for most businesses.',
      alternatives: ['ai_website_setup', 'lead_gen_setup'],
    };
  }

  /**
   * Calculate the total first-month cost for an offer (setup + first recurring).
   */
  getFirstMonthCost(offerId: OfferId): number {
    const offer = this.get(offerId);
    if (!offer) return 0;
    return offer.setupPrice + offer.recurringPrice;
  }

  /**
   * Calculate annual cost for an offer.
   */
  getAnnualCost(offerId: OfferId): number {
    const offer = this.get(offerId);
    if (!offer) return 0;
    if (offer.billingInterval === 'monthly') {
      return offer.setupPrice + (offer.recurringPrice * 12);
    }
    if (offer.billingInterval === 'annual') {
      return offer.setupPrice + offer.recurringPrice;
    }
    return offer.setupPrice;
  }
}

// Singleton instance
let catalogInstance: OfferCatalog | null = null;

export function getOfferCatalog(): OfferCatalog {
  if (!catalogInstance) {
    catalogInstance = new OfferCatalog();
  }
  return catalogInstance;
}
