/**
 * Heidi Autonomous Agent Loop
 * Observes system state on a schedule, reasons via Ollama, then alerts or
 * queues actions for operator authorization.
 *
 * SAFETY INVARIANT: The loop can never act beyond sending a push notification.
 * Any consequential action is queued as a "pending" item and requires explicit
 * operator CONFIRM via POST /api/agent/authorize/:id before anything executes.
 */

'use strict';

const EventEmitter = require('events');

class HeidiAgentLoop extends EventEmitter {
    constructor(config = {}) {
        super();
        this.enabled         = process.env.AGENT_LOOP_ENABLED !== 'false';
        this.intervalMin     = parseInt(process.env.AGENT_LOOP_INTERVAL_MIN) || config.intervalMin || 15;
        this.autonomyLevel   = process.env.AGENT_AUTONOMY_LEVEL || config.autonomyLevel || 'alert_only';
        this.reasoningModel  = process.env.AGENT_REASONING_MODEL || config.reasoningModel || 'llama3.2';
        this.ollamaUrl       = config.ollamaUrl  || 'http://localhost:11434';
        this.bridgeUrl       = config.bridgeUrl  || 'http://localhost:5050';
        this.supabase        = config.supabase   || null;
        this._broadcast      = config.broadcast  || null;
        this._buildRegistry  = config.buildRegistry || null;

        this.timer           = null;
        this.running         = false;
        this.cycleCount      = 0;
        this.lastRun         = null;
        this.log             = [];          // ring buffer, last 50 cycles
        this.pendingActions  = new Map();   // id → action record
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    start() {
        if (!this.enabled) {
            console.log('[🤖 AgentLoop] Disabled — set AGENT_LOOP_ENABLED=true to enable');
            return;
        }
        console.log(`[🤖 AgentLoop] Starting — interval: ${this.intervalMin}min | model: ${this.reasoningModel} | autonomy: ${this.autonomyLevel}`);
        // First cycle runs after 2 min (let services settle after boot)
        setTimeout(() => this.runCycle(), 2 * 60 * 1000);
        this.timer = setInterval(() => this.runCycle(), this.intervalMin * 60 * 1000);
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        console.log('[🤖 AgentLoop] Stopped');
    }

    // ── Main cycle ─────────────────────────────────────────────────────────────

    async runCycle() {
        if (this.running) return;
        this.running = true;
        const t0 = Date.now();
        try {
            const obs      = await this._observe();
            const decision = await this._reason(obs);
            await this._act(decision, obs);

            this.cycleCount++;
            this.lastRun = new Date().toISOString();
            const entry = {
                cycle: this.cycleCount, ts: this.lastRun,
                duration_ms: Date.now() - t0,
                observations: obs.summary,
                decision: decision.summary,
                action: decision.action
            };
            this.log.unshift(entry);
            if (this.log.length > 50) this.log.pop();
            console.log(`[🤖 AgentLoop] #${this.cycleCount} (${Date.now() - t0}ms) → ${decision.action}: ${decision.summary}`);
        } catch (e) {
            console.error('[🤖 AgentLoop] Cycle error:', e.message);
        } finally {
            this.running = false;
        }
    }

    // ── 1. OBSERVE ─────────────────────────────────────────────────────────────

    async _observe() {
        const obs = { services: null, revenue: null, forge: null, ts: new Date().toISOString() };

        // Service health via registry
        try {
            if (this._buildRegistry) obs.services = await this._buildRegistry();
        } catch {}

        // Revenue delta: last 24 h vs prior 24 h
        try {
            if (this.supabase) {
                const now = Date.now();
                const sum = arr => (arr || []).reduce((t, r) => t + (r.net_amount || 0), 0);
                const { data: recent } = await this.supabase.from('ledger').select('net_amount')
                    .gte('created_at', new Date(now - 864e5).toISOString());
                const { data: prior }  = await this.supabase.from('ledger').select('net_amount')
                    .gte('created_at', new Date(now - 2 * 864e5).toISOString())
                    .lt('created_at',  new Date(now - 864e5).toISOString());
                obs.revenue = { recent_24h: sum(recent), prior_24h: sum(prior), delta: sum(recent) - sum(prior) };
            }
        } catch {}

        // Latest forge build
        try {
            const r = await fetch(`${this.bridgeUrl}/api/builds?limit=1`, { signal: AbortSignal.timeout(2500) });
            if (r.ok) {
                const d = await r.json();
                const arr = d.builds || d.recent || (Array.isArray(d) ? d : []);
                if (arr[0]) obs.forge = { build: arr[0].build_number || arr[0].id, status: arr[0].status };
            }
        } catch {}

        // Summarise for the prompt
        const downServices = obs.services
            ? Object.entries(obs.services.services || {}).filter(([, v]) => !v.ok).map(([k]) => k)
            : [];

        obs.summary = [
            downServices.length ? `SERVICES DOWN: ${downServices.join(', ')}` : 'all services healthy',
            obs.revenue
                ? `revenue 24h $${obs.revenue.recent_24h.toFixed(2)} (Δ${obs.revenue.delta >= 0 ? '+' : ''}${obs.revenue.delta.toFixed(2)})`
                : 'revenue unavailable',
            obs.forge
                ? `forge #${obs.forge.build} ${obs.forge.status}`
                : 'forge unavailable'
        ].join(' | ');

        return obs;
    }

    // ── 2. REASON ──────────────────────────────────────────────────────────────

    async _reason(obs) {
        const prompt =
`You are the ProtoForge autonomous decision agent. Assess observations and decide if action is needed.

OBSERVATIONS: ${obs.summary}
AUTONOMY LEVEL: ${this.autonomyLevel}

Available actions:
  no_action          — everything normal, no intervention
  send_alert         — push a notification to the operator
  queue_revenue_review — queue an action for operator authorization

Decision rules:
  - Prefer no_action when uncertain or all metrics normal
  - send_alert when any critical service is down, forge build failed, or revenue dropped >20 % from prior day
  - queue_revenue_review when revenue delta is positive >$50 (opportunity)

Reply ONLY with valid JSON, no prose:
{"action":"<action>","summary":"<one sentence>","needs_attention":<bool>,"alert_title":"<short>","alert_body":"<detail>"}`;

        try {
            const r = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.reasoningModel, prompt, stream: false,
                    format: 'json', options: { temperature: 0.15, num_predict: 200 }
                }),
                signal: AbortSignal.timeout(30000)
            });
            if (r.ok) {
                const parsed = JSON.parse((await r.json()).response || '{}');
                if (parsed.action) return parsed;
            }
        } catch {}

        // Rule-based fallback when Ollama is unreachable
        return this._ruleBasedDecision(obs);
    }

    _ruleBasedDecision(obs) {
        const downSvcs = obs.services
            ? Object.entries(obs.services.services || {})
                .filter(([k, v]) => !v.ok && k !== 'push_subs')
                .map(([k]) => k)
            : [];
        const forgeFailed  = obs.forge && ['failure', 'error', 'failed'].includes(obs.forge.status);
        const revDrop      = obs.revenue && obs.revenue.prior_24h > 5 &&
                             (obs.revenue.delta / obs.revenue.prior_24h) < -0.2;
        const revOpportunity = obs.revenue && obs.revenue.delta > 50;

        if (downSvcs.length || forgeFailed || revDrop) {
            return {
                action: 'send_alert', needs_attention: true,
                summary: `Rule-based alert: ${downSvcs.length ? 'service(s) down' : forgeFailed ? 'forge failure' : 'revenue drop'}`,
                alert_title: 'ProtoForge Alert',
                alert_body: obs.summary
            };
        }
        if (revOpportunity) {
            return {
                action: 'queue_revenue_review', needs_attention: true,
                summary: `Revenue opportunity: +$${obs.revenue.delta.toFixed(2)} vs prior day`,
                alert_title: 'Revenue Opportunity',
                alert_body: obs.summary
            };
        }
        return { action: 'no_action', needs_attention: false, summary: 'All clear', alert_title: '', alert_body: '' };
    }

    // ── 3. ACT (alert-only; consequential actions require authorization) ────────

    async _act(decision, obs) {
        if (!decision.needs_attention || decision.action === 'no_action') return;

        if (decision.action === 'send_alert') {
            this._push({ type: 'hydi_activity', level: 'warning',
                title: decision.alert_title || 'Agent Alert',
                body:  decision.alert_body  || decision.summary,
                payload: { source: 'agent_loop', observations: obs.summary }, ts: Date.now() });
        }

        if (decision.action === 'queue_revenue_review') {
            const id = `pa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const record = { id, action: 'revenue_review', context: obs.summary,
                summary: decision.summary, ts: new Date().toISOString(), status: 'pending' };
            this.pendingActions.set(id, record);
            this._push({ type: 'hydi_activity', level: 'info',
                title: 'Action Pending Authorization',
                body: `${decision.summary} — open Heidi to review`,
                payload: { action_id: id }, ts: Date.now() });
        }
    }

    _push(event) {
        if (this._broadcast) this._broadcast(event);
    }

    // ── API helpers ────────────────────────────────────────────────────────────

    getStatus() {
        return {
            enabled: this.enabled, running: this.running,
            interval_min: this.intervalMin, autonomy_level: this.autonomyLevel,
            reasoning_model: this.reasoningModel,
            cycle_count: this.cycleCount, last_run: this.lastRun,
            pending_count: this.pendingActions.size,
            next_run: this.timer && this.lastRun
                ? new Date(new Date(this.lastRun).getTime() + this.intervalMin * 60000).toISOString()
                : null
        };
    }

    getLog()     { return this.log.slice(0, 20); }
    getPending() { return [...this.pendingActions.values()]; }

    authorize(id) {
        const a = this.pendingActions.get(id);
        if (!a) throw new Error(`Unknown action: ${id}`);
        a.status = 'authorized'; a.authorized_at = new Date().toISOString();
        this.pendingActions.set(id, a);
        this.emit('action_authorized', a);
        return a;
    }

    reject(id) {
        const a = this.pendingActions.get(id);
        if (!a) throw new Error(`Unknown action: ${id}`);
        a.status = 'rejected';
        this.pendingActions.delete(id);
        return a;
    }
}

module.exports = HeidiAgentLoop;
