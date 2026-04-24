/**
 * AppForge HYDI Integration
 * Fleet-wide health monitoring for equipment finance clients
 * 
 * Usage:
 *   const AppForgeHydi = require('./appforge-hydi');
 *   const integration = new AppForgeHydi(supabaseAdminClient);
 *   await integration.activateForClient(clientId, tier);
 */

class AppForgeHydiIntegration {
  constructor(adminSupabase) {
    this.supabase = adminSupabase;
    this.tiers = {
      starter: { priceId: 'price_starter_99', monthly: 99, projects: 1 },
      growth: { priceId: 'price_growth_199', monthly: 199, projects: 5 },
      enterprise: { priceId: 'price_enterprise_299', monthly: 299, projects: -1 }
    };
  }

  /**
   * Activate HYDI monitoring for a new AppForge client
   * @param {string} clientId - AppForge client ID
   * @param {string} tier - starter|growth|enterprise
   * @param {string} supabaseUrl - Client's Supabase URL
   * @param {string} serviceKey - Client's service_role key (encrypted)
   */
  async activateForClient(clientId, tier, supabaseUrl, serviceKey) {
    const tierConfig = this.tiers[tier];
    if (!tierConfig) throw new Error(`Invalid tier: ${tier}`);

    // Create subscription record
    const { data: sub, error: subError } = await this.supabase
      .from('hydi_subscriptions')
      .insert({
        client_id: clientId,
        tier,
        price_id: tierConfig.priceId,
        monthly_amount: tierConfig.monthly,
        supabase_url: supabaseUrl,
        service_key_encrypted: serviceKey, // Encrypt before storing
        status: 'active',
        projects_allowed: tierConfig.projects,
        activated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (subError) throw new Error(`Subscription creation failed: ${subError.message}`);

    // Initialize client health_runs table (copy schema from system_health_runs)
    const { error: initError } = await this.supabase.rpc('init_client_hydi', {
      p_client_id: clientId
    });

    if (initError) {
      console.error('Client table init failed (may already exist):', initError.message);
    }

    // Schedule cron job for this client
    await this.scheduleClientHealthChecks(clientId, tier);

    // Emit MRR event
    await this.emitMrrEvent(clientId, tierConfig.monthly, 'new');

    return {
      subscription: sub,
      setup_complete: true,
      next_steps: [
        'Install HYDI SQL functions in client Supabase',
        'Verify system_health_runs table exists',
        'Configure alert destinations (email/Slack)'
      ]
    };
  }

  /**
   * Run health check for a specific client
   * @param {string} clientId 
   * @returns {Promise<Object>} Health status
   */
  async runClientHealthCheck(clientId) {
    // Get client connection details
    const { data: client, error } = await this.supabase
      .from('hydi_subscriptions')
      .select('supabase_url, service_key_encrypted')
      .eq('client_id', clientId)
      .single();

    if (error) throw new Error(`Client lookup failed: ${error.message}`);

    // Decrypt and connect to client's Supabase
    const serviceKey = this.decrypt(client.service_key_encrypted);
    const { createClient } = require('@supabase/supabase-js');
    const clientSupabase = createClient(client.supabase_url, serviceKey);

    // Run health check
    const { data: health, error: healthError } = await clientSupabase
      .rpc('analyze_health_trends');

    if (healthError) {
      // Store failure in fleet health
      await this.logFleetHealth(clientId, 'error', healthError.message);
      throw healthError;
    }

    // Store in fleet view
    await this.logFleetHealth(clientId, health.status, health.reason);

    return health;
  }

  /**
   * Get fleet-wide health summary
   * @returns {Promise<Object>} All client health statuses
   */
  async getFleetSummary() {
    const { data, error } = await this.supabase
      .from('hydi_fleet_health')
      .select('*')
      .order('last_check', { ascending: false });

    if (error) throw new Error(`Fleet summary failed: ${error.message}`);

    const summary = {
      total: data.length,
      healthy: data.filter(c => c.current_status === 'OK').length,
      warning: data.filter(c => c.current_status === 'WARNING').length,
      critical: data.filter(c => c.current_status === 'CRITICAL').length,
      unknown: data.filter(c => !c.current_status).length,
      clients: data
    };

    summary.mrr = data.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);

    return summary;
  }

  /**
   * Deactivate HYDI for a client
   * @param {string} clientId 
   * @param {string} reason - cancellation reason
   */
  async deactivateForClient(clientId, reason = 'churn') {
    // Get current subscription for MRR calculation
    const { data: sub } = await this.supabase
      .from('hydi_subscriptions')
      .select('tier, monthly_amount')
      .eq('client_id', clientId)
      .single();

    // Update subscription status
    await this.supabase
      .from('hydi_subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason
      })
      .eq('client_id', clientId);

    // Unschedule health checks
    await this.unscheduleClientHealthChecks(clientId);

    // Emit churn event
    if (sub) {
      await this.emitMrrEvent(clientId, -sub.monthly_amount, 'churn');
    }

    return { deactivated: true, reason };
  }

  /**
   * Schedule per-client health check cron
   */
  async scheduleClientHealthChecks(clientId, tier) {
    const interval = tier === 'enterprise' ? '*/2 * * * *' : '*/5 * * * *';
    const jobName = `hydi-client-${clientId}`;

    // Note: In production, use a queue (pg_cron has limits)
    const { error } = await this.supabase.rpc('schedule_client_hydi', {
      p_client_id: clientId,
      p_interval: interval,
      p_job_name: jobName
    });

    if (error) console.error('Cron scheduling failed:', error.message);
  }

  async unscheduleClientHealthChecks(clientId) {
    const jobName = `hydi-client-${clientId}`;
    await this.supabase.rpc('unschedule_client_hydi', { p_job_name: jobName });
  }

  async logFleetHealth(clientId, status, message) {
    await this.supabase.from('hydi_client_health_runs').insert({
      client_id: clientId,
      status,
      message,
      checked_at: new Date().toISOString()
    });
  }

  async emitMrrEvent(clientId, amount, type) {
    await this.supabase.from('hydi_mrr').insert({
      client_id: clientId,
      amount,
      type, // 'new', 'upgrade', 'downgrade', 'churn'
      recorded_at: new Date().toISOString()
    });
  }

  decrypt(encrypted) {
    // Implement your encryption scheme here
    // For production, use AWS KMS or similar
    return encrypted; // Placeholder
  }
}

// SQL to create in AppForge admin Supabase:
const SETUP_SQL = `
-- Client subscriptions
CREATE TABLE hydi_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  price_id TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL,
  supabase_url TEXT NOT NULL,
  service_key_encrypted TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  projects_allowed INTEGER,
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Client health runs (aggregated from each client)
CREATE TABLE hydi_client_health_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT REFERENCES hydi_subscriptions(client_id),
  status TEXT,
  message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fleet health view
CREATE VIEW hydi_fleet_health AS
SELECT 
  s.client_id,
  s.tier,
  s.monthly_amount,
  s.status as subscription_status,
  r.status as current_status,
  r.message as last_message,
  r.checked_at as last_check,
  COUNT(r2.id) FILTER (WHERE r2.checked_at > NOW() - INTERVAL '24 hours') as checks_24h
FROM hydi_subscriptions s
LEFT JOIN LATERAL (
  SELECT * FROM hydi_client_health_runs 
  WHERE client_id = s.client_id 
  ORDER BY checked_at DESC 
  LIMIT 1
) r ON true
LEFT JOIN hydi_client_health_runs r2 ON r2.client_id = s.client_id
WHERE s.status = 'active'
GROUP BY s.client_id, s.tier, s.monthly_amount, s.status, r.status, r.message, r.checked_at;

-- MRR tracking
CREATE TABLE hydi_mrr (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT,
  amount INTEGER NOT NULL,
  type TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Schedules (for per-client cron tracking)
CREATE TABLE hydi_schedules (
  client_id TEXT REFERENCES hydi_subscriptions(client_id),
  job_name TEXT UNIQUE,
  interval TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = { AppForgeHydiIntegration, SETUP_SQL };
