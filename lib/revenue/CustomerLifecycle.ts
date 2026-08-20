/**
 * HYDI Customer Lifecycle
 *
 * Manages the customer journey from payment through onboarding, provisioning,
 * fulfillment, and retention. Uses direct PostgreSQL access.
 *
 * Lifecycle:
 *   PAYMENT_VERIFIED → ONBOARDING → PROVISIONING → ACTIVE →
 *   (DEGRADED → ACTIVE) → (AT_RISK → ACTIVE) → RENEWAL → RENEWED →
 *   (CANCELLED) or (CHURNED)
 */

import { RevenueDatabase, getRevenueDatabase } from './RevenueDatabase';
import type { CustomerServiceRecord, ServiceStatus, FulfillmentStep, OfferId } from './types';
import { getOfferCatalog } from './OfferCatalog';

const FULFILLMENT_TEMPLATES: Record<OfferId, { stepId: string; name: string }[]> = {
  ai_operations_setup: [
    { stepId: 'discovery_call', name: 'Business process discovery call' },
    { stepId: 'crm_integration', name: 'CRM or lead system integration' },
    { stepId: 'faq_creation', name: 'FAQ knowledge base creation' },
    { stepId: 'monitoring_config', name: 'Monitoring threshold configuration' },
    { stepId: 'verification', name: 'Service verification and acceptance' },
  ],
  ai_operations_monthly: [
    { stepId: 'service_activation', name: 'Activate monthly service' },
    { stepId: 'lead_capture_live', name: 'Lead capture system live' },
    { stepId: 'monitoring_active', name: 'Operational monitoring active' },
    { stepId: 'first_report', name: 'First weekly performance report delivered' },
  ],
  ai_website_setup: [
    { stepId: 'domain_config', name: 'Domain configuration' },
    { stepId: 'content_gathering', name: 'Content gathering' },
    { stepId: 'brand_assets', name: 'Brand asset collection' },
    { stepId: 'chatbot_training', name: 'Chatbot training data setup' },
    { stepId: 'website_deployment', name: 'Website deployment' },
    { stepId: 'verification', name: 'Deployment verification' },
  ],
  ai_website_monthly: [
    { stepId: 'hosting_activation', name: 'Hosting activation' },
    { stepId: 'monitoring_setup', name: 'Uptime monitoring setup' },
    { stepId: 'analytics_config', name: 'Analytics reporting configuration' },
    { stepId: 'first_report', name: 'First monthly report delivered' },
  ],
  lead_gen_setup: [
    { stepId: 'icp_definition', name: 'ICP definition call' },
    { stepId: 'outreach_authorization', name: 'Outreach channel authorization' },
    { stepId: 'compliance_review', name: 'Compliance review' },
    { stepId: 'template_creation', name: 'Outreach template creation' },
    { stepId: 'verification', name: 'System verification' },
  ],
  lead_gen_monthly: [
    { stepId: 'prospecting_active', name: 'Prospecting system active' },
    { stepId: 'first_outreach', name: 'First outreach batch sent' },
    { stepId: 'first_appointment', name: 'First appointment booked' },
    { stepId: 'first_report', name: 'First monthly performance report' },
  ],
};

export class CustomerLifecycle {
  private db: RevenueDatabase;

  constructor(db?: RevenueDatabase) {
    this.db = db || getRevenueDatabase();
  }

  async startOnboarding(input: {
    customerId: string;
    offerId: OfferId;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    configuration?: Record<string, unknown>;
  }): Promise<CustomerServiceRecord> {
    // Check for existing service record
    const existing = await this.db.queryOne(
      'SELECT * FROM customer_services WHERE customer_id = $1 AND offer_id = $2 LIMIT 1',
      [input.customerId, input.offerId],
    );
    if (existing) return this.rowToService(existing);

    const offer = getOfferCatalog().get(input.offerId);
    if (!offer) throw new Error(`Unknown offer: ${input.offerId}`);

    const template = FULFILLMENT_TEMPLATES[input.offerId] || [];
    const fulfillmentSteps: FulfillmentStep[] = template.map((step) => ({
      stepId: step.stepId, name: step.name, status: 'pending',
      startedAt: null, completedAt: null, result: null, error: null,
    }));

    const now = new Date().toISOString();
    const serviceId = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const row = await this.db.insert('customer_services', {
      service_id: serviceId,
      customer_id: input.customerId,
      offer_id: input.offerId,
      status: 'pending',
      stripe_subscription_id: input.stripeSubscriptionId || null,
      stripe_customer_id: input.stripeCustomerId || null,
      configuration: JSON.stringify(input.configuration || {}),
      health_check_url: null,
      last_health_check_at: null,
      last_health_status: 'unknown',
      fulfillment_steps: JSON.stringify(fulfillmentSteps),
      created_at: now,
      updated_at: now,
    });

    await this.recordEvent('onboarding_started', input.customerId, {
      offer_id: input.offerId, service_id: serviceId,
    });
    return this.rowToService(row);
  }

  async startProvisioning(serviceId: string): Promise<CustomerServiceRecord> {
    const service = await this.getService(serviceId);
    if (!service) throw new Error(`Service not found: ${serviceId}`);
    if (service.status !== 'pending') throw new Error(`Service ${serviceId} is not in pending state (current: ${service.status})`);

    const row = await this.db.update(
      'customer_services',
      { status: 'provisioning', provisioned_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to start provisioning: ${serviceId}`);

    await this.recordEvent('provisioning_started', service.customerId, { service_id: serviceId, offer_id: service.offerId });
    return this.rowToService(row);
  }

  async updateFulfillmentStep(
    serviceId: string,
    stepId: string,
    update: { status: FulfillmentStep['status']; result?: string; error?: string },
  ): Promise<CustomerServiceRecord> {
    const service = await this.getService(serviceId);
    if (!service) throw new Error(`Service not found: ${serviceId}`);

    const steps = service.fulfillmentSteps.map((step) => {
      if (step.stepId === stepId) {
        return {
          ...step,
          status: update.status,
          result: update.result ?? step.result,
          error: update.error ?? step.error,
          startedAt: step.startedAt || (update.status === 'in_progress' ? new Date().toISOString() : null),
          completedAt: update.status === 'completed' || update.status === 'failed' ? new Date().toISOString() : step.completedAt,
        };
      }
      return step;
    });

    const row = await this.db.update(
      'customer_services',
      { fulfillment_steps: JSON.stringify(steps), updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to update fulfillment step: ${serviceId}`);

    await this.recordEvent('fulfillment_step_updated', service.customerId, {
      service_id: serviceId, step_id: stepId, status: update.status,
    });

    const allCompleted = steps.every((s) => s.status === 'completed' || s.status === 'skipped');
    if (allCompleted && service.status === 'provisioning') return this.activateService(serviceId);

    const anyFailed = steps.some((s) => s.status === 'failed');
    if (anyFailed && service.status === 'provisioning') return this.failProvisioning(serviceId, 'Fulfillment step failed');

    return this.rowToService(row);
  }

  async activateService(serviceId: string): Promise<CustomerServiceRecord> {
    const row = await this.db.update(
      'customer_services',
      { status: 'active', activated_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to activate service: ${serviceId}`);
    await this.recordEvent('service_activated', (row as unknown as Record<string, unknown>).customer_id as string, { service_id: serviceId, offer_id: (row as unknown as Record<string, unknown>).offer_id as string });
    return this.rowToService(row);
  }

  async failProvisioning(serviceId: string, reason: string): Promise<CustomerServiceRecord> {
    const row = await this.db.update(
      'customer_services',
      { status: 'failed', updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to mark provisioning failed: ${serviceId}`);
    await this.recordEvent('provisioning_failed', (row as unknown as Record<string, unknown>).customer_id as string, { service_id: serviceId, reason });
    return this.rowToService(row);
  }

  async updateHealthStatus(
    serviceId: string,
    health: 'healthy' | 'degraded' | 'unhealthy',
    healthCheckUrl?: string,
  ): Promise<CustomerServiceRecord> {
    const updates: Record<string, unknown> = {
      last_health_status: health,
      last_health_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (healthCheckUrl) updates.health_check_url = healthCheckUrl;

    const service = await this.getService(serviceId);
    if (service && service.status === 'active' && health === 'unhealthy') updates.status = 'degraded';
    else if (service && service.status === 'degraded' && health === 'healthy') updates.status = 'active';

    const row = await this.db.update(
      'customer_services', updates, 'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to update health: ${serviceId}`);
    return this.rowToService(row);
  }

  async suspendService(serviceId: string, reason: string): Promise<CustomerServiceRecord> {
    const row = await this.db.update(
      'customer_services',
      { status: 'suspended', suspended_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to suspend service: ${serviceId}`);
    await this.recordEvent('service_suspended', (row as unknown as Record<string, unknown>).customer_id as string, { service_id: serviceId, reason });
    return this.rowToService(row);
  }

  async cancelService(serviceId: string, reason: string): Promise<CustomerServiceRecord> {
    const row = await this.db.update(
      'customer_services',
      { status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      'service_id = $1', [serviceId],
    );
    if (!row) throw new Error(`Failed to cancel service: ${serviceId}`);
    await this.recordEvent('service_cancelled', (row as unknown as Record<string, unknown>).customer_id as string, { service_id: serviceId, reason });
    return this.rowToService(row);
  }

  async getService(serviceId: string): Promise<CustomerServiceRecord | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM customer_services WHERE service_id = $1 LIMIT 1', [serviceId],
    );
    return row ? this.rowToService(row) : null;
  }

  async getCustomerServices(customerId: string): Promise<CustomerServiceRecord[]> {
    const rows = await this.db.query(
      'SELECT * FROM customer_services WHERE customer_id = $1 ORDER BY created_at DESC', [customerId],
    );
    return rows.map((r) => this.rowToService(r));
  }

  async getServicesByStatus(status: ServiceStatus, limit = 50): Promise<CustomerServiceRecord[]> {
    const rows = await this.db.query(
      'SELECT * FROM customer_services WHERE status = $1 ORDER BY updated_at DESC LIMIT $2', [status, limit],
    );
    return rows.map((r) => this.rowToService(r));
  }

  async getServicesNeedingHealthCheck(intervalMinutes = 60): Promise<CustomerServiceRecord[]> {
    const cutoff = new Date(Date.now() - intervalMinutes * 60 * 1000).toISOString();
    const rows = await this.db.query(
      `SELECT * FROM customer_services WHERE status IN ('active', 'degraded')
       AND (last_health_check_at IS NULL OR last_health_check_at < $1) LIMIT 50`,
      [cutoff],
    );
    return rows.map((r) => this.rowToService(r));
  }

  async verifyService(serviceId: string): Promise<{ verified: boolean; result: string; details: Record<string, unknown> }> {
    const service = await this.getService(serviceId);
    if (!service) return { verified: false, result: 'Service not found', details: {} };

    if (service.status === 'active') {
      const incompleteSteps = service.fulfillmentSteps.filter((s) => s.status !== 'completed' && s.status !== 'skipped');
      if (incompleteSteps.length > 0) {
        return { verified: false, result: `${incompleteSteps.length} fulfillment steps incomplete`, details: { incompleteSteps: incompleteSteps.map((s) => s.stepId) } };
      }
      if (service.healthCheckUrl) {
        try {
          const response = await fetch(service.healthCheckUrl, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return { verified: false, result: `Health check failed: HTTP ${response.status}`, details: { url: service.healthCheckUrl, status: response.status } };
          return { verified: true, result: 'Service is active and health check passed', details: { url: service.healthCheckUrl, status: response.status } };
        } catch (error) {
          return { verified: false, result: `Health check error: ${error instanceof Error ? error.message : 'unknown'}`, details: { url: service.healthCheckUrl } };
        }
      }
      return { verified: true, result: 'Service is active with all fulfillment steps completed', details: { stepsCompleted: service.fulfillmentSteps.length } };
    }
    return { verified: false, result: `Service status is ${service.status}, not active`, details: { status: service.status } };
  }

  private rowToService(row: Record<string, unknown>): CustomerServiceRecord {
    return {
      serviceId: row.service_id as string,
      customerId: (row.customer_id as string) || '',
      offerId: row.offer_id as OfferId,
      status: row.status as ServiceStatus,
      provisionedAt: (row.provisioned_at as string) || null,
      activatedAt: (row.activated_at as string) || null,
      suspendedAt: (row.suspended_at as string) || null,
      cancelledAt: (row.cancelled_at as string) || null,
      stripeSubscriptionId: (row.stripe_subscription_id as string) || null,
      stripeCustomerId: (row.stripe_customer_id as string) || null,
      configuration: typeof row.configuration === 'string' ? JSON.parse(row.configuration) : (row.configuration as Record<string, unknown>) || {},
      healthCheckUrl: (row.health_check_url as string) || null,
      lastHealthCheckAt: (row.last_health_check_at as string) || null,
      lastHealthStatus: (row.last_health_status as 'healthy' | 'degraded' | 'unhealthy' | 'unknown') || 'unknown',
      fulfillmentSteps: typeof row.fulfillment_steps === 'string' ? JSON.parse(row.fulfillment_steps) : (row.fulfillment_steps as FulfillmentStep[]) || [],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private async recordEvent(eventType: string, customerId: string | null, auditData: Record<string, unknown>): Promise<void> {
    try {
      await this.db.insert('revenue_events', {
        event_type: eventType, customer_id: customerId,
        audit_data: JSON.stringify(auditData), created_at: new Date().toISOString(),
      });
    } catch { /* don't fail main operation */ }
  }
}
