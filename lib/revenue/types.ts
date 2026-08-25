/**
 * HYDI Canonical Revenue Types
 *
 * The authoritative type system for all commercial operations.
 * Every revenue event must be attributable through the full chain:
 *
 *   prospect → opportunity → offer → proposal → customer → subscription → payment → fulfillment
 *
 * Revenue is counted ONLY from verified payment-provider events.
 * Never from exit codes, dashboard counters, or simulated data.
 */

// ---------------------------------------------------------------------------
// Offer Catalog
// ---------------------------------------------------------------------------

export type OfferId =
  | 'ai_operations_setup'
  | 'ai_operations_monthly'
  | 'ai_website_setup'
  | 'ai_website_monthly'
  | 'lead_gen_setup'
  | 'lead_gen_monthly'
  | 'protoforge_model_prep';

export type BillingInterval = 'one_time' | 'monthly' | 'annual';

export type OfferCategory = 'ai_operations' | 'website_deployment' | 'lead_generation' | 'protoforge';

export interface CommercialOffer {
  offerId: OfferId;
  name: string;
  description: string;
  category: OfferCategory;
  setupPrice: number;          // one-time setup fee in cents
  recurringPrice: number;      // recurring price in cents (0 for one-time)
  billingInterval: BillingInterval;
  includedCapabilities: string[];
  usageLimits: Record<string, number>;
  implementationRequirements: string[];
  marginTarget: number;        // target gross margin (0-1)
  upgradePath: OfferId | null;
  cancellationBehavior: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Prospect Pipeline
// ---------------------------------------------------------------------------

export type ProspectStatus =
  | 'identified'     // prospect has been identified but not yet contacted
  | 'researching'    // HEIDI is gathering publicly available information
  | 'scored'         // prospect has been scored against ICP
  | 'contacted'      // initial outreach has been sent
  | 'responded'      // prospect has responded
  | 'qualified'      // prospect has been qualified
  | 'appointment'    // appointment has been scheduled
  | 'proposal_sent'  // a proposal has been sent
  | 'won'            // prospect has become a paying customer
  | 'lost'           // prospect has been lost
  | 'opted_out';     // prospect has opted out — DO NOT CONTACT

export type ProspectSource =
  | 'manual_entry'
  | 'authorized_test'
  | 'inbound_inquiry'
  | 'referral'
  | 'public_directory'
  | 'website_analysis';

export interface ProspectRecord {
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  source: ProspectSource;
  status: ProspectStatus;
  icpScore: number;            // 0-100, how well they match the ICP
  icpFactors: Record<string, number>;  // individual factor scores
  suppressionList: boolean;    // true if on suppression list
  optedOut: boolean;           // true if prospect has opted out
  lastContactedAt: string | null;
  nextContactAt: string | null;
  contactCount: number;        // total outreach attempts
  assignedTo: string | null;   // assigned representative or 'heidi'
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// ICP (Ideal Customer Profile)
// ---------------------------------------------------------------------------

export interface ICPConfig {
  targetIndustries: string[];
  businessSizeRange: { min: number; max: number };  // employee count
  revenueRange: { min: number; max: number };        // annual revenue
  geographicScope: string[];
  requiredPainPoints: string[];   // must have at least one
  excludeIndustries: string[];
  minServiceValue: number;        // minimum monthly service value that makes sense
  scoringWeights: {
    websiteQuality: number;       // weight for website quality factor
    leadCaptureGap: number;       // weight for missing lead capture
    responseTime: number;         // weight for slow response time
    automationOpportunity: number;// weight for obvious automation gaps
    businessSize: number;         // weight for size match
    industryFit: number;          // weight for industry match
  };
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export interface OpportunityRecord {
  opportunityId: string;
  prospectId: string;
  offerId: OfferId;
  status: 'open' | 'proposal_sent' | 'accepted' | 'rejected' | 'expired';
  proposedPrice: number;       // in cents
  discountApplied: number;     // in cents
  discountAuthorizedBy: string | null;
  proposalId: string | null;
  customerId: string | null;   // set when prospect becomes customer
  estimatedValue: number;      // in cents (includes recurring)
  probability: number;         // 0-1
  expectedCloseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Revenue Ledger — canonical, immutable, auditable
// ---------------------------------------------------------------------------

export type RevenueEventType =
  | 'payment_received'
  | 'payment_failed'
  | 'refund_issued'
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_cancelled'
  | 'setup_fee_collected'
  | 'chargeback_disputed'
  | 'payout_initiated'
  | 'payout_completed';

export type RevenueEventSource = 'stripe_webhook' | 'stripe_connect_webhook' | 'manual_entry';

export interface RevenueLedgerEntry {
  ledgerEntryId: string;
  eventType: RevenueEventType;
  source: RevenueEventSource;
  stripeEventId: string;       // Stripe event ID for idempotency
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  customerId: string;          // internal customer ID
  prospectId: string | null;   // attribution chain
  opportunityId: string | null;
  offerId: OfferId | null;
  amountGross: number;         // in cents
  amountNet: number;           // in cents (after fees)
  currency: string;
  feeBreakdown: {
    platformFee: number;
    stripeFee: number;
    otherFees: number;
  };
  verified: boolean;           // true only when backed by verified Stripe event
  verifiedAt: string | null;
  metadata: Record<string, unknown>;
  recordedAt: string;
  // Immutable — once written, never modified
}

// ---------------------------------------------------------------------------
// Customer Lifecycle
// ---------------------------------------------------------------------------

export type CustomerStatus = 'active' | 'inactive' | 'suspended' | 'churned';

export type ServiceStatus =
  | 'pending'      // payment received, provisioning not started
  | 'provisioning' // provisioning in progress
  | 'active'       // service is live
  | 'degraded'     // service is running but with issues
  | 'suspended'    // service suspended (e.g. payment failure)
  | 'cancelled'    // service cancelled
  | 'failed';      // provisioning failed

export interface CustomerServiceRecord {
  serviceId: string;
  customerId: string;
  offerId: OfferId;
  status: ServiceStatus;
  provisionedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  configuration: Record<string, unknown>;
  healthCheckUrl: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  fulfillmentSteps: FulfillmentStep[];
  createdAt: string;
  updatedAt: string;
}

export interface FulfillmentStep {
  stepId: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Financial Guardrails
// ---------------------------------------------------------------------------

export interface FinancialGuardrails {
  maxAutonomousDiscount: number;         // max discount HEIDI can apply autonomously (cents)
  maxAutonomousRefund: number;           // max refund HEIDI can issue autonomously (cents)
  maxDailyOutbound: number;              // max outbound messages per day
  maxDailyNewProspects: number;          // max new prospects per day
  maxMonthlyAdSpend: number;             // max ad spend per month (cents)
  minAcceptableMargin: number;           // minimum margin (0-1)
  maxCustomerAcquisitionCost: number;    // max CAC (cents)
  requiresHumanApprovalAbove: number;    // any action above this amount requires human (cents)
  prohibitedActions: string[];           // actions HEIDI must never do autonomously
}

// ---------------------------------------------------------------------------
// Revenue Actions (for autonomous control plane integration)
// ---------------------------------------------------------------------------

export type RevenueActionType =
  | 'prospect_research'       // R0 — research publicly available info
  | 'prospect_score'          // R0 — score prospect against ICP
  | 'prospect_outreach'       // R1 — send approved outreach message
  | 'prospect_follow_up'      // R1 — follow up within policy
  | 'appointment_schedule'    // R1 — schedule appointment
  | 'proposal_generate'       // R1 — generate proposal using approved pricing
  | 'customer_onboard'        // R2 — onboard new customer
  | 'service_provision'       // R2 — provision service
  | 'service_monitor'         // R0 — monitor service health
  | 'renewal_reminder'        // R1 — send renewal reminder
  | 'support_triage'          // R1 — triage support request
  | 'revenue_report'          // R0 — generate revenue report
  | 'pipeline_optimize'       // R0 — evaluate pipeline and recommend
  | 'price_change'            // R3 — change price (requires human)
  | 'refund_issue'            // R3 — issue refund (requires human above limit)
  | 'discount_offer'          // R2 — offer discount within limits
  | 'escalate_human';         // R0 — escalate to human

export type RevenueAuthorizationMode =
  | 'autonomous'     // R0-R1, HEIDI can do without human approval
  | 'policy_authorized'  // R2, authorized by configured policy
  | 'human_required'     // R3+, requires explicit human approval
  | 'prohibited';        // R5, never autonomous

export interface RevenueAction {
  actionId: string;
  actionType: RevenueActionType;
  prospectId: string | null;
  customerId: string | null;
  opportunityId: string | null;
  reason: string;
  expectedOutcome: string;
  authorization: RevenueAuthorizationMode;
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  financialImpact: number;     // in cents (0 for non-financial actions)
  executed: boolean;
  executionResult: string | null;
  verified: boolean;
  verificationResult: string | null;
  auditRecordId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Revenue Metrics
// ---------------------------------------------------------------------------

export interface RevenueMetrics {
  // Pipeline metrics
  totalProspects: number;
  qualifiedLeads: number;
  appointmentsBooked: number;
  proposalsSent: number;
  openOpportunities: number;
  pipelineValue: number;       // estimated value of open opportunities (cents)

  // Conversion metrics
  prospectToQualifiedRate: number;
  qualifiedToAppointmentRate: number;
  appointmentToProposalRate: number;
  proposalToCloseRate: number;
  overallConversionRate: number;

  // Revenue metrics (from verified events only)
  mrr: number;                 // monthly recurring revenue (cents)
  arr: number;                 // annual recurring revenue (cents)
  totalRevenue: number;        // all-time verified revenue (cents)
  setupRevenue: number;        // one-time setup revenue (cents)
  refunds: number;             // total refunds (cents)
  failedPayments: number;      // count of failed payments
  grossMargin: number;         // 0-1

  // Customer metrics
  customerCount: number;
  activeSubscriptions: number;
  churnedCustomers: number;
  averageRevenuePerCustomer: number;  // cents
  customerLifetimeValue: number;      // cents

  // Cost metrics
  customerAcquisitionCost: number;    // cents
  fulfillmentCost: number;            // cents
}

// ---------------------------------------------------------------------------
// Revenue Control Loop
// ---------------------------------------------------------------------------

export interface RevenueControlLoopResult {
  evaluatedAt: string;
  metrics: RevenueMetrics;
  identifiedActions: RevenueAction[];
  selectedAction: RevenueAction | null;
  selectionReason: string;
  authorizationResult: {
    authorized: boolean;
    mode: RevenueAuthorizationMode;
    reason: string;
  };
  executed: boolean;
  executionResult: string | null;
  verified: boolean;
  verificationResult: string | null;
}
