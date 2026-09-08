/**
 * HYDI Revenue Control Loop
 *
 * The autonomous revenue optimization loop. This is NOT a parallel
 * orchestration system — it reuses the existing HEIDI watchdog/recovery
 * architecture and operates within the same governed-autonomy model.
 *
 * The control loop:
 *   1. Evaluates the current pipeline state (prospects, opportunities, customers)
 *   2. Identifies candidate actions based on pipeline gaps
 *   3. Selects the highest-value action
 *   4. Checks authorization via the guardrail engine
 *   5. Executes the action if authorized
 *   6. Verifies the action result
 *   7. Records evidence in revenue_events
 *
 * The loop is bounded by:
 *   - Financial guardrails (max discounts, refunds, daily limits)
 *   - Compliance controls (suppression lists, opt-out, frequency limits)
 *   - Risk classification (R0-R5)
 *   - Authorization modes (autonomous, policy_authorized, human_required, prohibited)
 *
 * The loop NEVER:
 *   - Performs live payment operations autonomously (R5, prohibited)
 *   - Sends unsolicited messages to opted-out prospects
 *   - Exceeds configured daily limits
 *   - Makes claims about revenue that isn't verified
 */

import { ProspectPipeline } from './ProspectPipeline';
import { RevenueLedger } from './RevenueLedger';
import { CustomerLifecycle } from './CustomerLifecycle';
import { RevenueDatabase, getRevenueDatabase } from './RevenueDatabase';
import { getOfferCatalog } from './OfferCatalog';
import { getGuardrailEngine } from './FinancialGuardrails';
import type {
  GovernanceRecord,
  RevenueAction,
  RevenueActionType,
  RevenueControlLoopResult,
  RevenueMetrics,
  ProspectRecord,
  OfferId,
} from './types';

// ---------------------------------------------------------------------------
// Revenue Control Loop
// ---------------------------------------------------------------------------

/** Decides whether one capability invocation may proceed. */
export interface CapabilityGovernor {
  (capabilityId: string, args: Record<string, unknown>): Promise<{
    allowed: boolean;
    reason: string;
  }>;
}

export class RevenueControlLoop {
  private pipeline: ProspectPipeline;
  private ledger: RevenueLedger;
  private lifecycle: CustomerLifecycle;
  private guardrails = getGuardrailEngine();
  private catalog = getOfferCatalog();

  /**
   * Authorizes each mutating operation against its capability contract.
   *
   * Without this, one authorization of `revenue.run_cycle` admits every write
   * below — status changes, opportunity creation, provisioning, health updates
   * — none of which the capability registry ever sees, even though contracts
   * exist for most of them. That is a governance bypass, not an optimisation.
   */
  private governor: CapabilityGovernor | null = null;
  private governanceLog: GovernanceRecord[] = [];

  constructor(db?: RevenueDatabase) {
    const database = db || getRevenueDatabase();
    this.pipeline = new ProspectPipeline(undefined, database);
    this.ledger = new RevenueLedger(database);
    this.lifecycle = new CustomerLifecycle(database);
  }

  /**
   * Supply the governor. Absent one, mutations still run but are recorded as
   * `ungoverned` rather than silently permitted — the same advisory-then-
   * enforcing progression used by HEIDI_CONTRACT_AUTHORITY, so this can be
   * observed before it starts refusing work.
   */
  setGovernor(governor: CapabilityGovernor | null): void {
    this.governor = governor;
  }

  getGovernanceLog(): GovernanceRecord[] {
    return this.governanceLog.slice();
  }

  /**
   * Run one mutating operation under its contract.
   *
   * Returns `null` when the governor refuses, so callers must handle refusal
   * explicitly instead of proceeding with an unauthorized write.
   */
  private async governed<T>(
    capabilityId: string,
    args: Record<string, unknown>,
    operation: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    if (!this.governor) {
      this.governanceLog.push({
        capabilityId,
        allowed: true,
        ungoverned: true,
        reason: 'no governor supplied — write performed without contract authorization',
      });
      return { ok: true, value: await operation() };
    }

    const decision = await this.governor(capabilityId, args);
    this.governanceLog.push({
      capabilityId,
      allowed: decision.allowed,
      ungoverned: false,
      reason: decision.reason,
    });

    if (!decision.allowed) return { ok: false, reason: decision.reason };
    return { ok: true, value: await operation() };
  }

  /**
   * Run one iteration of the revenue control loop.
   *
   * This is the main entry point. It:
   *   1. Collects current metrics
   *   2. Identifies candidate actions
   *   3. Selects the best action
   *   4. Authorizes via guardrails
   *   5. Executes if authorized
   *   6. Verifies the result
   *   7. Returns the complete result for audit
   */
  async run(): Promise<RevenueControlLoopResult> {
    const evaluatedAt = new Date().toISOString();
    // Per-run, so the log describes this cycle rather than accumulating.
    this.governanceLog = [];

    // 1. Collect metrics
    const metrics = await this.collectMetrics();

    // 2. Identify candidate actions
    const candidateActions = await this.identifyActions(metrics);

    // 3. Select the highest-value action
    const selection = this.selectAction(candidateActions, metrics);

    if (!selection.action) {
      return {
        evaluatedAt,
        metrics,
        identifiedActions: candidateActions,
        selectedAction: null,
        selectionReason: selection.reason,
        authorizationResult: { authorized: false, mode: 'prohibited', reason: 'No action selected' },
        executed: false,
        executionResult: null,
        verified: false,
        verificationResult: null,
        governance: this.governanceLog.slice(),
      };
    }

    // 4. Check authorization
    const auth = this.guardrails.authorize(
      selection.action.actionType,
      selection.action.financialImpact,
    );

    // 5. Execute if authorized
    let executed = false;
    let executionResult: string | null = null;
    let verified = false;
    let verificationResult: string | null = null;

    if (auth.authorized) {
      const execResult = await this.executeAction(selection.action);
      executed = execResult.executed;
      executionResult = execResult.result;

      // 6. Verify the result
      if (executed) {
        const verResult = await this.verifyAction(selection.action, execResult);
        verified = verResult.verified;
        verificationResult = verResult.result;
      }
    }

    return {
      evaluatedAt,
      metrics,
      identifiedActions: candidateActions,
      selectedAction: { ...selection.action, executed, executionResult, verified, verificationResult },
      selectionReason: selection.reason,
      authorizationResult: auth,
      executed,
      executionResult,
      verified,
      verificationResult,
      governance: this.governanceLog.slice(),
    };
  }

  // -----------------------------------------------------------------------
  // Metrics Collection
  // -----------------------------------------------------------------------

  async collectMetrics(): Promise<RevenueMetrics> {
    const pipelineMetrics = await this.pipeline.getPipelineMetrics();
    const revenueSummary = await this.ledger.getRevenueSummary();

    // Count active services
    const activeServices = await this.lifecycle.getServicesByStatus('active');
    const provisioningServices = await this.lifecycle.getServicesByStatus('provisioning');

    // Calculate conversion rates
    const byStatus = pipelineMetrics.byStatus;
    const totalProspects = pipelineMetrics.total;
    const qualified = (byStatus['qualified'] || 0) + (byStatus['appointment'] || 0) + (byStatus['proposal_sent'] || 0) + (byStatus['won'] || 0);
    const appointments = byStatus['appointment'] || 0;
    const proposals = byStatus['proposal_sent'] || 0;
    const won = byStatus['won'] || 0;

    const prospectToQualifiedRate = totalProspects > 0 ? qualified / totalProspects : 0;
    const qualifiedToAppointmentRate = qualified > 0 ? appointments / qualified : 0;
    const appointmentToProposalRate = appointments > 0 ? proposals / appointments : 0;
    const proposalToCloseRate = proposals > 0 ? won / proposals : 0;
    const overallConversionRate = totalProspects > 0 ? won / totalProspects : 0;

    // Pipeline value = sum of estimated values of open opportunities
    // For now, estimate from qualified prospects × average offer value
    const avgOfferValue = 29900; // $299/mo default
    const pipelineValue = qualified * avgOfferValue;

    return {
      totalProspects,
      qualifiedLeads: qualified,
      appointmentsBooked: appointments,
      proposalsSent: proposals,
      openOpportunities: pipelineMetrics.topScoring,
      pipelineValue,

      prospectToQualifiedRate,
      qualifiedToAppointmentRate,
      appointmentToProposalRate,
      proposalToCloseRate,
      overallConversionRate,

      mrr: revenueSummary.mrr,
      arr: revenueSummary.arr,
      totalRevenue: revenueSummary.totalRevenue,
      setupRevenue: revenueSummary.setupRevenue,
      refunds: revenueSummary.refunds,
      failedPayments: revenueSummary.failedPayments,
      grossMargin: 0.70, // target margin, updated from actual data

      customerCount: revenueSummary.customerCount,
      activeSubscriptions: activeServices.length,
      churnedCustomers: 0, // would need historical data
      averageRevenuePerCustomer: revenueSummary.customerCount > 0
        ? Math.round(revenueSummary.mrr / revenueSummary.customerCount)
        : 0,
      customerLifetimeValue: 0, // would need churn rate

      customerAcquisitionCost: 0, // would need cost tracking
      fulfillmentCost: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Action Identification
  // -----------------------------------------------------------------------

  private async identifyActions(metrics: RevenueMetrics): Promise<RevenueAction[]> {
    const actions: RevenueAction[] = [];
    const now = new Date().toISOString();

    // 1. If there are prospects ready for follow-up, prioritize that
    const readyForFollowUp = await this.pipeline.getProspectsReadyForFollowUp(5);
    for (const prospect of readyForFollowUp) {
      const canContact = await this.pipeline.canContact(prospect.prospectId);
      if (canContact.allowed) {
        actions.push(this.createAction(
          'prospect_follow_up',
          prospect.prospectId,
          null,
          null,
          `Follow up with ${prospect.companyName} (score: ${prospect.icpScore})`,
          'Prospect responds or advances to next stage',
          0,
        ));
      }
    }

    // 2. If there are top prospects not yet contacted, prioritize outreach
    const topProspects = await this.pipeline.getTopProspects(5, 50);
    for (const prospect of topProspects) {
      const canContact = await this.pipeline.canContact(prospect.prospectId);
      if (canContact.allowed) {
        actions.push(this.createAction(
          'prospect_outreach',
          prospect.prospectId,
          null,
          null,
          `Initial outreach to ${prospect.companyName} (score: ${prospect.icpScore})`,
          'Prospect responds or advances to contacted stage',
          0,
        ));
      }
    }

    // 3. If there are identified but unscored prospects, score them
    const unscored = await this.pipeline.getProspectsByStatus('identified', 10);
    for (const prospect of unscored) {
      actions.push(this.createAction(
        'prospect_score',
        prospect.prospectId,
        null,
        null,
        `Score prospect ${prospect.companyName} against ICP`,
        'Prospect receives ICP score and advances to scored stage',
        0,
      ));
    }

    // 4. If there are qualified prospects, create opportunities
    const qualified = await this.pipeline.getProspectsByStatus('qualified', 5);
    for (const prospect of qualified) {
      const recommendation = this.catalog.recommendOffer(
        (prospect.metadata?.needs as string[]) || [],
      );
      actions.push(this.createAction(
        'proposal_generate',
        prospect.prospectId,
        null,
        null,
        `Generate proposal for ${prospect.companyName} — recommended: ${recommendation.recommended}`,
        'Proposal is generated and opportunity is created',
        0,
      ));
    }

    // 5. If there are services needing health checks, monitor them
    const servicesNeedingChecks = await this.lifecycle.getServicesNeedingHealthCheck(60);
    for (const service of servicesNeedingChecks.slice(0, 5)) {
      actions.push(this.createAction(
        'service_monitor',
        null,
        service.customerId,
        null,
        `Health check for service ${service.serviceId} (${service.offerId})`,
        'Service health status is updated',
        0,
      ));
    }

    // 6. If there are services pending provisioning, continue provisioning
    const pendingServices = await this.lifecycle.getServicesByStatus('pending', 5);
    for (const service of pendingServices) {
      actions.push(this.createAction(
        'service_provision',
        null,
        service.customerId,
        null,
        `Start provisioning for service ${service.serviceId} (${service.offerId})`,
        'Service transitions to provisioning and fulfillment steps begin',
        0,
      ));
    }

    // 7. Always include a pipeline optimization evaluation
    actions.push(this.createAction(
      'pipeline_optimize',
      null,
      null,
      null,
      'Evaluate pipeline and recommend optimization',
      'Pipeline metrics are analyzed and recommendations generated',
      0,
    ));

    return actions;
  }

  // -----------------------------------------------------------------------
  // Action Selection
  // -----------------------------------------------------------------------

  private selectAction(
    actions: RevenueAction[],
    metrics: RevenueMetrics,
  ): { action: RevenueAction | null; reason: string } {
    if (actions.length === 0) {
      return { action: null, reason: 'No candidate actions identified' };
    }

    // Priority order:
    // 1. Service provisioning (revenue is waiting)
    // 2. Service monitoring (existing customers first)
    // 3. Proposal generation (qualified prospects)
    // 4. Follow-up (warm prospects)
    // 5. Outreach (new prospects)
    // 6. Scoring (preparation)
    // 7. Pipeline optimization (analysis)

    const priority: RevenueActionType[] = [
      'service_provision',
      'service_monitor',
      'proposal_generate',
      'prospect_follow_up',
      'prospect_outreach',
      'prospect_score',
      'pipeline_optimize',
    ];

    for (const actionType of priority) {
      const action = actions.find((a) => a.actionType === actionType);
      if (action) {
        return {
          action,
          reason: `Selected ${actionType} as highest priority action: ${action.reason}`,
        };
      }
    }

    // Fallback: return the first action
    return {
      action: actions[0],
      reason: `Selected fallback action: ${actions[0].actionType}`,
    };
  }

  // -----------------------------------------------------------------------
  // Action Execution
  // -----------------------------------------------------------------------

  private async executeAction(action: RevenueAction): Promise<{ executed: boolean; result: string }> {
    try {
      switch (action.actionType) {
        case 'prospect_score': {
          if (!action.prospectId) return { executed: false, result: 'No prospect ID' };
          const scored = await this.governed(
            'revenue.score_prospect',
            { prospectId: action.prospectId },
            () => this.pipeline.scoreProspect(action.prospectId as string),
          );
          if (!scored.ok) return { executed: false, result: `Refused: ${scored.reason}` };
          return { executed: true, result: `Scored: ${scored.value.score} — ${scored.value.reason}` };
        }

        case 'prospect_outreach':
        case 'prospect_follow_up': {
          if (!action.prospectId) return { executed: false, result: 'No prospect ID' };
          // Mark as contacted — actual message sending is via authorized integrations
          const contacted = await this.governed(
            'revenue.update_prospect_status',
            { prospectId: action.prospectId, newStatus: 'contacted' },
            () =>
              this.pipeline.updateStatus(action.prospectId as string, 'contacted', {
                action_type: action.actionType,
              }),
          );
          if (!contacted.ok) return { executed: false, result: `Refused: ${contacted.reason}` };
          return {
            executed: true,
            result: `Prospect ${action.prospectId} marked as contacted. Message delivery requires authorized integration.`,
          };
        }

        case 'proposal_generate': {
          if (!action.prospectId) return { executed: false, result: 'No prospect ID' };
          const prospect = await this.pipeline.getProspect(action.prospectId);
          if (!prospect) return { executed: false, result: 'Prospect not found' };

          const recommendation = this.catalog.recommendOffer(
            (prospect.metadata?.needs as string[]) || [],
          );
          const offer = this.catalog.get(recommendation.recommended);
          if (!offer) return { executed: false, result: 'No suitable offer found' };

          const created = await this.governed(
            'revenue.create_opportunity',
            { prospectId: action.prospectId, offerId: recommendation.recommended },
            () =>
              this.pipeline.createOpportunity({
                prospectId: action.prospectId as string,
                offerId: recommendation.recommended,
                proposedPrice: offer.setupPrice + offer.recurringPrice,
                estimatedValue: offer.setupPrice + offer.recurringPrice * 12,
                probability: 0.3,
              }),
          );
          if (!created.ok) return { executed: false, result: `Refused: ${created.reason}` };
          const opportunity = created.value;

          // Second write, separately authorized. Bundling it with the
          // opportunity creation would be the same bypass in miniature.
          const advanced = await this.governed(
            'revenue.update_prospect_status',
            { prospectId: action.prospectId, newStatus: 'proposal_sent' },
            () =>
              this.pipeline.updateStatus(action.prospectId as string, 'proposal_sent', {
                opportunity_id: opportunity.opportunityId,
                offer_id: recommendation.recommended,
              }),
          );
          if (!advanced.ok) {
            return {
              executed: true,
              result:
                `Created opportunity ${opportunity.opportunityId}, but the status ` +
                `advance was refused: ${advanced.reason}`,
            };
          }

          return {
            executed: true,
            result: `Created opportunity ${opportunity.opportunityId} with offer ${recommendation.recommended} ($${(offer.setupPrice + offer.recurringPrice) / 100})`,
          };
        }

        case 'service_provision': {
          if (!action.customerId) return { executed: false, result: 'No customer ID' };
          const services = await this.lifecycle.getCustomerServices(action.customerId);
          const pending = services.find((s) => s.status === 'pending');
          if (!pending) return { executed: false, result: 'No pending service found' };

          const provisioned = await this.governed(
            'revenue.start_provisioning',
            { serviceId: pending.serviceId },
            () => this.lifecycle.startProvisioning(pending.serviceId),
          );
          if (!provisioned.ok) return { executed: false, result: `Refused: ${provisioned.reason}` };
          return {
            executed: true,
            result: `Started provisioning for service ${pending.serviceId}`,
          };
        }

        case 'service_monitor': {
          if (!action.customerId) return { executed: false, result: 'No customer ID' };
          const services = await this.lifecycle.getCustomerServices(action.customerId);
          const active = services.find((s) => s.status === 'active' || s.status === 'degraded');
          if (!active) return { executed: false, result: 'No active service found' };

          const verification = await this.lifecycle.verifyService(active.serviceId);
          const healthWritten = await this.governed(
            'revenue.update_health_status',
            {
              serviceId: active.serviceId,
              healthStatus: verification.verified ? 'healthy' : 'unhealthy',
            },
            () =>
              this.lifecycle.updateHealthStatus(
                active.serviceId,
                verification.verified ? 'healthy' : 'unhealthy',
              ),
          );
          if (!healthWritten.ok) {
            return { executed: false, result: `Refused: ${healthWritten.reason}` };
          }

          return {
            executed: true,
            result: `Health check: ${verification.result}`,
          };
        }

        case 'pipeline_optimize': {
          const metrics = await this.collectMetrics();
          const recommendations = this.generateOptimizationRecommendations(metrics);
          return {
            executed: true,
            result: `Pipeline analyzed. Recommendations: ${recommendations.join('; ')}`,
          };
        }

        default:
          return { executed: false, result: `Action type ${action.actionType} not implemented` };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { executed: false, result: `Execution failed: ${msg}` };
    }
  }

  // -----------------------------------------------------------------------
  // Action Verification
  // -----------------------------------------------------------------------

  private async verifyAction(
    action: RevenueAction,
    execResult: { executed: boolean; result: string },
  ): Promise<{ verified: boolean; result: string }> {
    if (!execResult.executed) {
      return { verified: false, result: 'Action was not executed' };
    }

    try {
      switch (action.actionType) {
        case 'prospect_score': {
          if (!action.prospectId) return { verified: false, result: 'No prospect ID' };
          const prospect = await this.pipeline.getProspect(action.prospectId);
          if (!prospect) return { verified: false, result: 'Prospect not found' };
          if (prospect.status === 'scored' && prospect.icpScore > 0) {
            return { verified: true, result: `Prospect scored: ${prospect.icpScore}` };
          }
          return { verified: false, result: 'Prospect not in scored state' };
        }

        case 'prospect_outreach':
        case 'prospect_follow_up': {
          if (!action.prospectId) return { verified: false, result: 'No prospect ID' };
          const prospect = await this.pipeline.getProspect(action.prospectId);
          if (!prospect) return { verified: false, result: 'Prospect not found' };
          if (prospect.status === 'contacted' && prospect.contactCount > 0) {
            return { verified: true, result: `Prospect contacted (${prospect.contactCount} times)` };
          }
          return { verified: false, result: 'Prospect not in contacted state' };
        }

        case 'proposal_generate': {
          if (!action.prospectId) return { verified: false, result: 'No prospect ID' };
          const prospect = await this.pipeline.getProspect(action.prospectId);
          if (!prospect) return { verified: false, result: 'Prospect not found' };
          if (prospect.status === 'proposal_sent') {
            return { verified: true, result: 'Prospect is in proposal_sent state' };
          }
          return { verified: false, result: 'Prospect not in proposal_sent state' };
        }

        case 'service_provision': {
          if (!action.customerId) return { verified: false, result: 'No customer ID' };
          const services = await this.lifecycle.getCustomerServices(action.customerId);
          const provisioning = services.find((s) => s.status === 'provisioning');
          if (provisioning) {
            return { verified: true, result: `Service ${provisioning.serviceId} is provisioning` };
          }
          return { verified: false, result: 'No service in provisioning state' };
        }

        case 'service_monitor': {
          // Verification is done as part of the monitoring action itself
          return { verified: true, result: 'Health check completed' };
        }

        case 'pipeline_optimize': {
          return { verified: true, result: 'Pipeline analysis completed' };
        }

        default:
          return { verified: false, result: `Verification not implemented for ${action.actionType}` };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { verified: false, result: `Verification failed: ${msg}` };
    }
  }

  // -----------------------------------------------------------------------
  // Optimization Recommendations
  // -----------------------------------------------------------------------

  private generateOptimizationRecommendations(metrics: RevenueMetrics): string[] {
    const recs: string[] = [];

    if (metrics.prospectToQualifiedRate < 0.1 && metrics.totalProspects > 10) {
      recs.push('Low qualification rate — review ICP criteria and prospect sources');
    }

    if (metrics.qualifiedToAppointmentRate < 0.3 && metrics.qualifiedLeads > 5) {
      recs.push('Low appointment rate — improve outreach personalization and follow-up timing');
    }

    if (metrics.proposalToCloseRate < 0.2 && metrics.proposalsSent > 5) {
      recs.push('Low close rate — review pricing and proposal quality');
    }

    if (metrics.totalProspects < 10) {
      recs.push('Low prospect count — increase prospect identification efforts');
    }

    if (metrics.activeSubscriptions > 0 && metrics.mrr === 0) {
      recs.push('Active subscriptions but no MRR recorded — verify payment webhook integration');
    }

    if (metrics.failedPayments > 0) {
      recs.push(`${metrics.failedPayments} failed payments — review billing retry logic`);
    }

    if (recs.length === 0) {
      recs.push('Pipeline is healthy — continue current strategy');
    }

    return recs;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private createAction(
    actionType: RevenueActionType,
    prospectId: string | null,
    customerId: string | null,
    opportunityId: string | null,
    reason: string,
    expectedOutcome: string,
    financialImpact: number,
  ): RevenueAction {
    const riskLevel = this.guardrails.getRiskLevel(actionType);
    const auth = this.guardrails.authorize(actionType, financialImpact);

    return {
      actionId: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actionType,
      prospectId,
      customerId,
      opportunityId,
      reason,
      expectedOutcome,
      authorization: auth.mode,
      riskLevel,
      financialImpact,
      executed: false,
      executionResult: null,
      verified: false,
      verificationResult: null,
      auditRecordId: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
