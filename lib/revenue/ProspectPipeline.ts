/**
 * HYDI Prospect Pipeline
 *
 * Manages the prospect lifecycle from identification through qualification.
 * Uses direct PostgreSQL access (not PostgREST) for reliability.
 *
 * Implements:
 *   - ICP-based prospect scoring
 *   - Deduplication by email, website, or company name
 *   - CRM-style state management
 *   - Suppression list enforcement
 *   - Contact frequency limits
 *   - Opt-out handling
 *   - Compliance controls
 */

import { RevenueDatabase, getRevenueDatabase } from './RevenueDatabase';
import type {
  ProspectRecord,
  ProspectStatus,
  ProspectSource,
  ICPConfig,
  OpportunityRecord,
  OfferId,
} from './types';

// ---------------------------------------------------------------------------
// Default ICP Configuration
// ---------------------------------------------------------------------------

const DEFAULT_ICP: ICPConfig = {
  targetIndustries: [
    'contractor', 'repair', 'specialty_service', 'professional_services',
    'small_agency', 'appointment_based',
  ],
  businessSizeRange: { min: 1, max: 25 },
  revenueRange: { min: 100000, max: 5000000 },
  geographicScope: ['US'],
  requiredPainPoints: ['lead_capture', 'response_time', 'appointment_scheduling', 'customer_communication'],
  excludeIndustries: ['adult', 'gambling', 'weapons'],
  minServiceValue: 29900,
  scoringWeights: {
    websiteQuality: 0.15,
    leadCaptureGap: 0.25,
    responseTime: 0.20,
    automationOpportunity: 0.20,
    businessSize: 0.10,
    industryFit: 0.10,
  },
};

// ---------------------------------------------------------------------------
// Prospect Pipeline
// ---------------------------------------------------------------------------

export class ProspectPipeline {
  private db: RevenueDatabase;
  private icp: ICPConfig;

  constructor(icp?: Partial<ICPConfig>, db?: RevenueDatabase) {
    this.db = db || getRevenueDatabase();
    this.icp = { ...DEFAULT_ICP, ...icp };
  }

  configureICP(updates: Partial<ICPConfig>): void {
    this.icp = { ...this.icp, ...updates };
  }

  getICP(): ICPConfig {
    return { ...this.icp };
  }

  // -----------------------------------------------------------------------
  // Prospect Identification & Deduplication
  // -----------------------------------------------------------------------

  async identifyProspect(input: {
    companyName: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    website?: string | null;
    industry?: string | null;
    location?: string | null;
    source: ProspectSource;
    metadata?: Record<string, unknown>;
  }): Promise<{ prospect: ProspectRecord; created: boolean; dedupMatch: string | null }> {
    // Check suppression list
    if (input.contactEmail) {
      const suppressed = await this.checkSuppression(input.contactEmail, 'email');
      if (suppressed) throw new Error(`Email ${input.contactEmail} is on suppression list: ${suppressed.reason}`);
    }
    if (input.contactPhone) {
      const suppressed = await this.checkSuppression(input.contactPhone, 'phone');
      if (suppressed) throw new Error(`Phone ${input.contactPhone} is on suppression list: ${suppressed.reason}`);
    }

    // Dedup: check by email, then website, then company name
    let existing: ProspectRecord | null = null;
    let dedupMatch: string | null = null;

    if (input.contactEmail) {
      existing = await this.findProspectByEmail(input.contactEmail);
      if (existing) dedupMatch = 'email';
    }
    if (!existing && input.website) {
      existing = await this.findProspectByWebsite(this.normalizeUrl(input.website));
      if (existing) dedupMatch = 'website';
    }
    if (!existing && input.companyName) {
      existing = await this.findProspectByCompany(input.companyName);
      if (existing) dedupMatch = 'company_name';
    }

    if (existing) {
      // Update with new info
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.contactName && !existing.contactName) updates.contact_name = input.contactName;
      if (input.contactEmail && !existing.contactEmail) updates.contact_email = input.contactEmail;
      if (input.contactPhone && !existing.contactPhone) updates.contact_phone = input.contactPhone;
      if (input.website && !existing.website) updates.website = this.normalizeUrl(input.website);
      if (input.industry && !existing.industry) updates.industry = input.industry;
      if (input.location && !existing.location) updates.location = input.location;

      await this.db.update('revenue_prospects', updates, 'prospect_id = $1', [existing.prospectId]);
      await this.recordEvent('prospect_reidentified', existing.prospectId, { dedup_match: dedupMatch, source: input.source });
      return { prospect: { ...existing, ...updates } as ProspectRecord, created: false, dedupMatch };
    }

    // Create new prospect
    const prospectId = `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const row = await this.db.insert('revenue_prospects', {
      prospect_id: prospectId,
      company_name: input.companyName,
      contact_name: input.contactName || null,
      contact_email: input.contactEmail || null,
      contact_phone: input.contactPhone || null,
      website: input.website ? this.normalizeUrl(input.website) : null,
      industry: input.industry || null,
      location: input.location || null,
      source: input.source,
      status: 'identified',
      icp_score: 0,
      icp_factors: JSON.stringify({}),
      suppression_list: false,
      opted_out: false,
      last_contacted_at: null,
      next_contact_at: null,
      contact_count: 0,
      assigned_to: 'heidi',
      metadata: JSON.stringify(input.metadata || {}),
      created_at: now,
      updated_at: now,
    });

    await this.recordEvent('prospect_identified', prospectId, { source: input.source, company: input.companyName });
    return { prospect: this.rowToProspect(row), created: true, dedupMatch: null };
  }

  // -----------------------------------------------------------------------
  // ICP Scoring
  // -----------------------------------------------------------------------

  async scoreProspect(prospectId: string): Promise<{ score: number; factors: Record<string, number>; reason: string }> {
    const prospect = await this.getProspect(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

    const factors: Record<string, number> = {};
    const weights = this.icp.scoringWeights;

    // Industry fit
    if (prospect.industry) {
      const isTarget = this.icp.targetIndustries.some((i) => prospect.industry?.toLowerCase().includes(i.toLowerCase()));
      const isExcluded = this.icp.excludeIndustries.some((i) => prospect.industry?.toLowerCase().includes(i.toLowerCase()));
      factors.industryFit = isExcluded ? 0 : isTarget ? 90 : 40;
    } else {
      factors.industryFit = 30;
    }

    // Business size
    const employeeCount = (prospect.metadata?.employeeCount as number) || 10;
    factors.businessSize = (employeeCount >= this.icp.businessSizeRange.min && employeeCount <= this.icp.businessSizeRange.max) ? 90 : employeeCount < this.icp.businessSizeRange.min ? 50 : 30;

    // Website quality
    factors.websiteQuality = prospect.website ? 60 : 20;

    // Lead capture gap
    const hasLeadCapture = prospect.metadata?.hasLeadCapture as boolean | undefined;
    factors.leadCaptureGap = hasLeadCapture === false ? 90 : hasLeadCapture === true ? 30 : 50;

    // Response time
    const responseTimeHours = prospect.metadata?.responseTimeHours as number | undefined;
    factors.responseTime = responseTimeHours !== undefined ? (responseTimeHours > 24 ? 90 : responseTimeHours > 4 ? 70 : 40) : 50;

    // Automation opportunity
    const hasAutomation = prospect.metadata?.hasAutomation as boolean | undefined;
    factors.automationOpportunity = hasAutomation === false ? 90 : hasAutomation === true ? 30 : 50;

    // Calculate weighted score
    let score = 0;
    let totalWeight = 0;
    for (const [factor, weight] of Object.entries(weights)) {
      score += (factors[factor] ?? 50) * weight;
      totalWeight += weight;
    }
    score = totalWeight > 0 ? Math.round(score / totalWeight) : 50;

    await this.db.update('revenue_prospects', {
      icp_score: score,
      icp_factors: JSON.stringify(factors),
      status: 'scored',
      updated_at: new Date().toISOString(),
    }, 'prospect_id = $1', [prospectId]);

    await this.recordEvent('prospect_scored', prospectId, { score, factors });

    const reason = score >= 70 ? 'High ICP match — prioritize for outreach' : score >= 50 ? 'Moderate ICP match — consider for outreach' : 'Low ICP match — deprioritize';
    return { score, factors, reason };
  }

  // -----------------------------------------------------------------------
  // Prospect State Management
  // -----------------------------------------------------------------------

  async updateStatus(prospectId: string, newStatus: ProspectStatus, context?: Record<string, unknown>): Promise<ProspectRecord> {
    const prospect = await this.getProspect(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

    if (prospect.optedOut && newStatus !== 'opted_out' && newStatus !== 'lost') {
      throw new Error(`Prospect ${prospectId} has opted out — cannot change status to ${newStatus}`);
    }

    if (!this.isValidTransition(prospect.status, newStatus)) {
      throw new Error(`Invalid state transition: ${prospect.status} → ${newStatus}`);
    }

    const updates: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };

    if (newStatus === 'contacted') {
      updates.last_contacted_at = new Date().toISOString();
      updates.contact_count = (prospect.contactCount || 0) + 1;
      const nextContact = new Date();
      nextContact.setDate(nextContact.getDate() + 3);
      updates.next_contact_at = nextContact.toISOString();
    }

    if (newStatus === 'opted_out') {
      updates.opted_out = true;
      updates.suppression_list = true;
      if (prospect.contactEmail) await this.addToSuppressionList(prospect.contactEmail, 'email', 'opt_out', prospectId);
      if (prospect.contactPhone) await this.addToSuppressionList(prospect.contactPhone, 'phone', 'opt_out', prospectId);
    }

    const row = await this.db.update('revenue_prospects', updates, 'prospect_id = $1', [prospectId]);
    if (!row) throw new Error(`Failed to update prospect: ${prospectId}`);

    await this.recordEvent('prospect_status_changed', prospectId, { from: prospect.status, to: newStatus, ...context });
    return this.rowToProspect(row);
  }

  async getProspectsByStatus(status: ProspectStatus, limit = 50): Promise<ProspectRecord[]> {
    const rows = await this.db.query(
      'SELECT * FROM revenue_prospects WHERE status = $1 ORDER BY icp_score DESC LIMIT $2',
      [status, limit],
    );
    return rows.map((r) => this.rowToProspect(r));
  }

  async getProspectsReadyForFollowUp(limit = 20): Promise<ProspectRecord[]> {
    const now = new Date().toISOString();
    const rows = await this.db.query(
      `SELECT * FROM revenue_prospects WHERE status IN ('contacted', 'responded') AND next_contact_at < $1 AND opted_out = false ORDER BY next_contact_at ASC LIMIT $2`,
      [now, limit],
    );
    return rows.map((r) => this.rowToProspect(r));
  }

  async getTopProspects(limit = 20, minScore = 50): Promise<ProspectRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM revenue_prospects WHERE status IN ('identified', 'scored') AND icp_score >= $1 AND opted_out = false ORDER BY icp_score DESC LIMIT $2`,
      [minScore, limit],
    );
    return rows.map((r) => this.rowToProspect(r));
  }

  async getProspect(prospectId: string): Promise<ProspectRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM revenue_prospects WHERE prospect_id = $1 LIMIT 1',
      [prospectId],
    );
    return row ? this.rowToProspect(row) : null;
  }

  async getOpportunity(opportunityId: string): Promise<OpportunityRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM revenue_opportunities WHERE opportunity_id = $1 LIMIT 1',
      [opportunityId],
    );
    return row ? this.rowToOpportunity(row) : null;
  }

  // -----------------------------------------------------------------------
  // Opportunity Management
  // -----------------------------------------------------------------------

  async createOpportunity(input: {
    prospectId: string;
    offerId: OfferId;
    proposedPrice?: number;
    discountApplied?: number;
    discountAuthorizedBy?: string;
    estimatedValue?: number;
    probability?: number;
    expectedCloseDate?: string;
  }): Promise<OpportunityRecord> {
    const prospect = await this.getProspect(input.prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${input.prospectId}`);

    const opportunityId = `opp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const row = await this.db.insert('revenue_opportunities', {
      opportunity_id: opportunityId,
      prospect_id: input.prospectId,
      offer_id: input.offerId,
      status: 'open',
      proposed_price: input.proposedPrice || 0,
      discount_applied: input.discountApplied || 0,
      discount_authorized_by: input.discountAuthorizedBy || null,
      proposal_id: null,
      customer_id: null,
      estimated_value: input.estimatedValue || 0,
      probability: input.probability || 0.0,
      expected_close_date: input.expectedCloseDate || null,
      created_at: now,
      updated_at: now,
    });

    await this.recordEvent('opportunity_created', input.prospectId, {
      opportunity_id: opportunityId, offer_id: input.offerId, proposed_price: input.proposedPrice,
    });
    return this.rowToOpportunity(row);
  }

  async updateOpportunityStatus(
    opportunityId: string,
    status: 'open' | 'proposal_sent' | 'accepted' | 'rejected' | 'expired',
    context?: Record<string, unknown>,
  ): Promise<OpportunityRecord> {
    const row = await this.db.update(
      'revenue_opportunities',
      { status, updated_at: new Date().toISOString() },
      'opportunity_id = $1',
      [opportunityId],
    );
    if (!row) throw new Error(`Failed to update opportunity: ${opportunityId}`);
    await this.recordEvent('opportunity_status_changed', (row as unknown as Record<string, unknown>).prospect_id as string, { opportunity_id: opportunityId, status, ...context });
    return this.rowToOpportunity(row);
  }

  // -----------------------------------------------------------------------
  // Suppression & Compliance
  // -----------------------------------------------------------------------

  async checkSuppression(identifier: string, type: 'email' | 'phone' | 'domain'): Promise<{ reason: string } | null> {
    const row = await this.db.queryOne<{ reason: string }>(
      'SELECT reason FROM revenue_suppression_list WHERE identifier = $1 AND identifier_type = $2 LIMIT 1',
      [identifier, type],
    );
    return row ? { reason: row.reason } : null;
  }

  async addToSuppressionList(identifier: string, type: 'email' | 'phone' | 'domain', reason: string, prospectId?: string): Promise<void> {
    await this.db.upsert('revenue_suppression_list', {
      identifier, identifier_type: type, reason, prospect_id: prospectId || null,
    }, ['identifier', 'identifier_type']);
  }

  async processOptOut(prospectId: string, channel: 'email' | 'phone' | 'domain', identifier: string): Promise<void> {
    await this.addToSuppressionList(identifier, channel, 'opt_out', prospectId);
    await this.db.update('revenue_prospects', {
      opted_out: true, suppression_list: true, status: 'opted_out', updated_at: new Date().toISOString(),
    }, 'prospect_id = $1', [prospectId]);
    await this.recordEvent('prospect_opted_out', prospectId, { channel, identifier });
  }

  async canContact(prospectId: string): Promise<{ allowed: boolean; reason: string }> {
    const prospect = await this.getProspect(prospectId);
    if (!prospect) return { allowed: false, reason: 'Prospect not found' };
    if (prospect.optedOut) return { allowed: false, reason: 'Prospect has opted out' };
    if (prospect.suppressionList) return { allowed: false, reason: 'Prospect is on suppression list' };
    if (prospect.lastContactedAt) {
      const lastContact = new Date(prospect.lastContactedAt);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      if (lastContact > threeDaysAgo) return { allowed: false, reason: 'Contacted within last 3 days — frequency limit' };
    }
    if (prospect.contactCount >= 5) return { allowed: false, reason: 'Maximum contact attempts (5) reached' };
    return { allowed: true, reason: 'Within contact policy' };
  }

  // -----------------------------------------------------------------------
  // Pipeline Metrics
  // -----------------------------------------------------------------------

  async getPipelineMetrics(): Promise<{
    total: number; byStatus: Record<string, number>; averageScore: number; topScoring: number; optedOut: number;
  }> {
    const rows = await this.db.query<{ status: string; icp_score: number; opted_out: boolean }>(
      'SELECT status, icp_score, opted_out FROM revenue_prospects',
    );
    const byStatus: Record<string, number> = {};
    let totalScore = 0, topScoring = 0, optedOut = 0;
    for (const p of rows) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      totalScore += p.icp_score || 0;
      if ((p.icp_score || 0) >= 70) topScoring++;
      if (p.opted_out) optedOut++;
    }
    return {
      total: rows.length, byStatus,
      averageScore: rows.length > 0 ? Math.round(totalScore / rows.length) : 0,
      topScoring, optedOut,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async findProspectByEmail(email: string): Promise<ProspectRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM revenue_prospects WHERE contact_email = $1 LIMIT 1', [email],
    );
    return row ? this.rowToProspect(row) : null;
  }

  private async findProspectByWebsite(website: string): Promise<ProspectRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM revenue_prospects WHERE website = $1 LIMIT 1', [website],
    );
    return row ? this.rowToProspect(row) : null;
  }

  private async findProspectByCompany(company: string): Promise<ProspectRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM revenue_prospects WHERE LOWER(company_name) = LOWER($1) LIMIT 1', [company],
    );
    return row ? this.rowToProspect(row) : null;
  }

  private isValidTransition(from: ProspectStatus, to: ProspectStatus): boolean {
    const valid: Record<string, string[]> = {
      identified: ['researching', 'scored', 'lost', 'opted_out'],
      researching: ['scored', 'lost', 'opted_out'],
      scored: ['contacted', 'lost', 'opted_out'],
      contacted: ['responded', 'lost', 'opted_out', 'contacted'],
      responded: ['qualified', 'lost', 'opted_out', 'responded'],
      qualified: ['appointment', 'lost', 'opted_out', 'proposal_sent'],
      appointment: ['proposal_sent', 'lost', 'opted_out'],
      proposal_sent: ['won', 'lost', 'opted_out'],
      won: [], lost: [], opted_out: [],
    };
    return (valid[from] || []).includes(to);
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    }
  }

  private rowToProspect(row: Record<string, unknown>): ProspectRecord {
    return {
      prospectId: row.prospect_id as string,
      companyName: row.company_name as string,
      contactName: (row.contact_name as string) || null,
      contactEmail: (row.contact_email as string) || null,
      contactPhone: (row.contact_phone as string) || null,
      website: (row.website as string) || null,
      industry: (row.industry as string) || null,
      location: (row.location as string) || null,
      source: row.source as ProspectSource,
      status: row.status as ProspectStatus,
      icpScore: (row.icp_score as number) || 0,
      icpFactors: typeof row.icp_factors === 'string' ? JSON.parse(row.icp_factors) : (row.icp_factors as Record<string, number>) || {},
      suppressionList: (row.suppression_list as boolean) || false,
      optedOut: (row.opted_out as boolean) || false,
      lastContactedAt: (row.last_contacted_at as string) || null,
      nextContactAt: (row.next_contact_at as string) || null,
      contactCount: (row.contact_count as number) || 0,
      assignedTo: (row.assigned_to as string) || null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>) || {},
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToOpportunity(row: Record<string, unknown>): OpportunityRecord {
    return {
      opportunityId: row.opportunity_id as string,
      prospectId: row.prospect_id as string,
      offerId: row.offer_id as OfferId,
      status: row.status as 'open' | 'proposal_sent' | 'accepted' | 'rejected' | 'expired',
      proposedPrice: (row.proposed_price as number) || 0,
      discountApplied: (row.discount_applied as number) || 0,
      discountAuthorizedBy: (row.discount_authorized_by as string) || null,
      proposalId: (row.proposal_id as string) || null,
      customerId: (row.customer_id as string) || null,
      estimatedValue: (row.estimated_value as number) || 0,
      probability: (row.probability as number) || 0,
      expectedCloseDate: (row.expected_close_date as string) || null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private async recordEvent(eventType: string, prospectId: string | null, auditData: Record<string, unknown>): Promise<void> {
    try {
      await this.db.insert('revenue_events', {
        event_type: eventType, prospect_id: prospectId,
        audit_data: JSON.stringify(auditData), created_at: new Date().toISOString(),
      });
    } catch { /* don't fail main operation */ }
  }
}
