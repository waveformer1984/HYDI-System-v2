/**
 * hydi-health-check
 * Production health monitoring for Supabase
 * ProtoForge Industries — protoforgeindustries.com
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

class HydiClient {
  constructor(options = {}) {
    const url  = options.supabaseUrl  || process.env.SUPABASE_URL;
    const key  = options.supabaseKey  || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        '[HYDI] Missing credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
        'or pass them as options: new HydiClient({ supabaseUrl, supabaseKey })'
      );
    }

    this.supabase  = createClient(url, key);
    this.projectId = url.match(/https:\/\/([^.]+)/)?.[1] || 'unknown';
    this.options   = options;
  }

  /* ──────────────────────────────────────────────
   * CORE HEALTH CHECK
   * ────────────────────────────────────────────── */
  async check() {
    const results = await Promise.allSettled([
      this._checkQueue(),
      this._checkEventFlow(),
      this._checkRevenue(),
      this._checkAutomation(),
    ]);

    const [queue, eventFlow, revenue, automation] = results.map(r =>
      r.status === 'fulfilled' ? r.value : { status: 'UNKNOWN', error: r.reason?.message }
    );

    const components = { queue, eventFlow, revenue, automation };
    const statuses   = Object.values(components).map(c => c.status);

    const overall =
      statuses.includes('CRITICAL') ? 'CRITICAL' :
      statuses.includes('WARNING')  ? 'WARNING'  : 'OK';

    const run = {
      timestamp:      new Date().toISOString(),
      project:        this.projectId,
      overall_status: overall,
      components,
      issues:         this._collectIssues(components, 'CRITICAL'),
      warnings:       this._collectIssues(components, 'WARNING'),
    };

    // Persist to system_health_runs if table exists
    await this._persistRun(run).catch(() => null);

    return run;
  }

  /* ──────────────────────────────────────────────
   * TREND ANALYSIS (PRO)
   * ────────────────────────────────────────────── */
  async analyzeTrends() {
    const { data, error } = await this.supabase.rpc('analyze_health_trends');
    if (error) throw new Error('[HYDI] analyze_health_trends() not installed. Run: hydi install');
    return data;
  }

  /* ──────────────────────────────────────────────
   * ESCALATION EVALUATION (PRO)
   * ────────────────────────────────────────────── */
  async evaluateEscalation() {
    const { data, error } = await this.supabase.rpc('evaluate_system_escalation');
    if (error) throw new Error('[HYDI] evaluate_system_escalation() not installed. Run: hydi install');
    return data;
  }

  /* ──────────────────────────────────────────────
   * AUTO HEAL (PRO)
   * ────────────────────────────────────────────── */
  async autoHeal() {
    const { data, error } = await this.supabase.rpc('auto_heal_from_trends');
    if (error) throw new Error('[HYDI] auto_heal_from_trends() not installed. Run: hydi install');
    return data;
  }

  /* ──────────────────────────────────────────────
   * DASHBOARD SNAPSHOT
   * ────────────────────────────────────────────── */
  async dashboard() {
    const { data, error } = await this.supabase
      .from('system_dashboard')
      .select('*')
      .single();
    if (error) throw new Error('[HYDI] system_dashboard view not installed. Run: hydi install');
    return data;
  }

  /* ──────────────────────────────────────────────
   * URSULA SUMMARY — natural language status
   * ────────────────────────────────────────────── */
  async ursula() {
    const [health, dash] = await Promise.all([
      this.check(),
      this.dashboard().catch(() => null),
    ]);

    const emoji = { OK: '✅', WARNING: '🟡', CRITICAL: '🔴' };
    const trend = dash?.trend_status || 'unknown';
    const trendEmoji = { stable: '📈', degrading: '📉', critical_trend: '🚨' };

    let msg = `${emoji[health.overall_status] || '❓'} HYDI · ${this.projectId}\n`;
    msg += `Status: ${health.overall_status} at ${new Date().toLocaleTimeString()}\n`;

    if (dash) {
      msg += `${trendEmoji[trend] || ''} Trend: ${trend} — ${dash.trend_reason || ''}\n`;
      if (dash.escalation_level !== 'OK') {
        msg += `⚠️  Escalation: ${dash.escalation_action} — ${dash.escalation_reason}\n`;
      }
      msg += `📊 Queue: ${dash.jobs_queued} queued | ${dash.jobs_failed} failed | `;
      msg += `${dash.events_last_hour} events/hr | ${dash.auto_heals_24h} heals today`;
    }

    return { summary: msg, health, dashboard: dash };
  }

  /* ──────────────────────────────────────────────
   * INTERNAL HELPERS
   * ────────────────────────────────────────────── */
  async _checkQueue() {
    const { data, error } = await this.supabase
      .from('worker_jobs')
      .select('status')
      .limit(100);

    if (error) return { status: 'UNKNOWN', error: error.message };

    const counts = { queued: 0, processing: 0, done: 0, failed: 0, dead: 0 };
    (data || []).forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

    const total      = data?.length || 0;
    const failRate   = total ? (counts.failed + counts.dead) / total : 0;

    const status =
      counts.dead > 5 || failRate > 0.3 ? 'CRITICAL' :
      counts.failed > 2 || failRate > 0.1 ? 'WARNING'  : 'OK';

    return { status, ...counts, total, failRate: +(failRate * 100).toFixed(1) };
  }

  async _checkEventFlow() {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data, error } = await this.supabase
      .from('event_bus_events')
      .select('created_at, event_type')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return { status: 'UNKNOWN', error: error.message };

    const count   = data?.length || 0;
    const last    = data?.[0]?.created_at;
    const minAgo  = last ? Math.round((Date.now() - new Date(last)) / 60000) : 999;
    const status  = minAgo > 30 ? 'WARNING' : 'OK';

    return { status, recentCount: count, lastEventMinutesAgo: minAgo, lastEventTime: last };
  }

  async _checkRevenue() {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { data, error } = await this.supabase
      .from('webhook_events')
      .select('payload')
      .eq('event_type', 'payment_intent.succeeded')
      .gte('created_at', yesterday);

    if (error) return { status: 'UNKNOWN', error: error.message };

    const payments = data?.length || 0;
    const revenue  = (data || []).reduce((sum, r) => {
      return sum + ((r.payload?.amount || 0) / 100);
    }, 0);

    return {
      status:     payments === 0 ? 'WARNING' : 'OK',
      payments24h: payments,
      revenue24h:  +revenue.toFixed(2),
    };
  }

  async _checkAutomation() {
    const fiveMinAgo = new Date(Date.now() - 300000).toISOString();
    const { data } = await this.supabase
      .from('event_bus_events')
      .select('created_at')
      .eq('event_type', 'system:heartbeat')
      .gte('created_at', fiveMinAgo);

    const beats  = data?.length || 0;
    const status = beats === 0 ? 'CRITICAL' : 'OK';
    return { status, heartbeats5min: beats };
  }

  async _persistRun(run) {
    await this.supabase.from('system_health_runs').insert({
      overall_status: run.overall_status,
      components:     run.components,
      issues:         run.issues,
      warnings:       run.warnings,
    });
  }

  _collectIssues(components, level) {
    return Object.entries(components)
      .filter(([, v]) => v.status === level)
      .map(([k, v]) => `${level}: ${k} — ${v.error || v.status}`);
  }
}

module.exports = { HydiClient };
