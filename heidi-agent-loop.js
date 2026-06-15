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

        // Alert suppression: same alert key can only fire once per window
        this._alertCooldowns    = new Map();
        this._alertCooldownMs   = (parseInt(process.env.AGENT_ALERT_COOLDOWN_MIN) || 240) * 60000;

        // World model: causal rules inferred from observation history
        this.correlationRules   = [];
        this.worldModelTs       = null;
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
            this._persistObservation(obs, decision).catch(() => {});

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

            // Rebuild world model every 20 cycles once we have enough history
            if (this.cycleCount >= 30 && this.cycleCount % 20 === 0) {
                this._updateWorldModel().catch(() => {});
            }
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
        const worldContext = this.correlationRules.length
            ? `\nWORLD MODEL (learned from ${this.cycleCount} observation cycles):\n${this.correlationRules.map(r => `  - ${r}`).join('\n')}`
            : '';

        const prompt =
`You are the ProtoForge autonomous decision agent. Assess observations and decide if action is needed.

OBSERVATIONS: ${obs.summary}
AUTONOMY LEVEL: ${this.autonomyLevel}${worldContext}

Available actions:
  no_action            — everything normal, no intervention
  send_alert           — push a notification to the operator
  queue_revenue_review — queue an action for operator authorization
  queue_forge_build    — queue a forge build trigger for operator authorization (requires forge down + revenue opportunity)
  re_probe             — schedule an immediate re-check of a specific service (safe, supervised mode only)

Decision rules:
  - Prefer no_action when uncertain or all metrics normal
  - send_alert when any critical service is down, forge build failed, or revenue dropped >20 % from prior day
  - queue_revenue_review when revenue delta is positive >$50 (opportunity) and forge is healthy
  - queue_forge_build when forge status is failed/error AND revenue delta is positive >$50 (missed opportunity due to forge)

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

        if (downSvcs.length && this.autonomyLevel === 'supervised') {
            return {
                action: 're_probe', needs_attention: true,
                summary: `Supervised re-probe: ${downSvcs.join(', ')} reported down`,
                alert_title: '', alert_body: ''
            };
        }
        // Forge failed + revenue opportunity → queue build trigger for operator auth
        if (forgeFailed && revOpportunity) {
            return {
                action: 'queue_forge_build', needs_attention: true,
                summary: `Forge build #${obs.forge.build} failed while revenue opportunity +$${obs.revenue.delta.toFixed(2)} active`,
                alert_title: 'Forge Build Needed',
                alert_body: obs.summary
            };
        }
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

    _alertKey(decision, obs) {
        // Stable key for deduplication: action type + which services are down
        if (decision.action === 'send_alert') {
            const downSvcs = obs.services
                ? Object.entries(obs.services.services || {})
                    .filter(([k, v]) => !v.ok && k !== 'push_subs')
                    .map(([k]) => k).sort().join(',')
                : 'unknown';
            return `alert:${downSvcs || 'general'}`;
        }
        if (decision.action === 'queue_revenue_review') return 'revenue_review';
        if (decision.action === 'queue_forge_build') return `forge_build:${obs.forge ? obs.forge.build : 'unknown'}`;
        return decision.action;
    }

    _isSuppressed(key) {
        const last = this._alertCooldowns.get(key);
        return last && (Date.now() - last) < this._alertCooldownMs;
    }

    async _act(decision, obs) {
        if (!decision.needs_attention || decision.action === 'no_action') return;

        const key = this._alertKey(decision, obs);
        if (this._isSuppressed(key)) {
            console.log(`[🤖 AgentLoop] Suppressed duplicate ${decision.action} (cooldown ${Math.round(this._alertCooldownMs / 60000)}min)`);
            return;
        }
        this._alertCooldowns.set(key, Date.now());

        if (decision.action === 're_probe') {
            console.log(`[🤖 AgentLoop] Supervised re-probe triggered (autonomy=supervised)`);
            this.emit('service_reprobe', { obs, decision, ts: Date.now() });
            this._push({ type: 'hydi_activity', level: 'info',
                title: 'Auto Re-probe', body: decision.summary,
                payload: { source: 'agent_loop', auto_executed: true }, ts: Date.now() });
        }

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

        if (decision.action === 'queue_forge_build') {
            const id = `pa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const record = {
                id, action: 'forge_build',
                context: obs.summary,
                summary: decision.summary,
                forge_build: obs.forge ? obs.forge.build : null,
                ts: new Date().toISOString(),
                status: 'pending'
            };
            this.pendingActions.set(id, record);
            console.log(`[🤖 AgentLoop] Queued forge build trigger ${id} — awaiting operator authorization`);
            this._push({ type: 'hydi_activity', level: 'warning',
                title: decision.alert_title || 'Forge Build Needed',
                body: `${decision.summary} — authorize in Heidi to trigger build`,
                payload: { action_id: id, source: 'agent_loop' }, ts: Date.now() });
        }
    }

    _push(event) {
        if (this._broadcast) this._broadcast(event);
    }

    // ── 4. WORLD MODEL — persist observations + infer causal rules ─────────────

    async _persistObservation(obs, decision) {
        if (!this.supabase) return;
        const downSvcs = obs.services
            ? Object.entries(obs.services.services || {})
                .filter(([k, v]) => !v.ok && k !== 'push_subs').map(([k]) => k)
            : [];
        await this.supabase.from('heidi_observations').insert({
            cycle:           this.cycleCount,
            ts:              obs.ts,
            forge_status:    obs.forge  ? obs.forge.status          : null,
            forge_build:     obs.forge  ? String(obs.forge.build)   : null,
            services_down:   downSvcs,
            revenue_24h:     obs.revenue ? obs.revenue.recent_24h   : null,
            revenue_delta:   obs.revenue ? obs.revenue.delta        : null,
            decision_action: decision.action,
            decision_summary: decision.summary
        });
    }

    async _updateWorldModel() {
        if (!this.supabase) return;
        const { data: rows, error } = await this.supabase
            .from('heidi_observations')
            .select('ts, forge_status, services_down, revenue_24h, revenue_delta')
            .order('ts', { ascending: true })
            .limit(200);

        if (error || !rows || rows.length < 30) return;

        const rules = [];

        // Rule 1: forge failure → revenue delta 24h later
        const forgeFailRows = rows.filter(r =>
            r.forge_status && ['failure', 'error', 'failed'].includes(r.forge_status));
        if (forgeFailRows.length >= 3) {
            const impacts = forgeFailRows.map(fo => {
                const foTs = new Date(fo.ts).getTime();
                const later = rows.find(r => {
                    const diff = new Date(r.ts).getTime() - foTs;
                    return diff > 20 * 3600000 && diff < 28 * 3600000 && r.revenue_delta != null;
                });
                return later ? later.revenue_delta : null;
            }).filter(v => v != null);

            if (impacts.length >= 2) {
                const avg = impacts.reduce((a, b) => a + b, 0) / impacts.length;
                if (Math.abs(avg) > 5) {
                    rules.push(
                        `Forge failures correlate with ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)} avg revenue delta 24h later` +
                        ` (${impacts.length} data points)`
                    );
                }
            }
        }

        // Rule 2: revenue trend across recent observations
        const revRows = rows.filter(r => r.revenue_delta != null).slice(-20);
        if (revRows.length >= 5) {
            const avg = revRows.reduce((a, r) => a + r.revenue_delta, 0) / revRows.length;
            const trend = avg > 10 ? 'upward' : avg < -10 ? 'downward' : null;
            if (trend) {
                rules.push(
                    `Revenue trend is ${trend}: avg 24h delta $${avg.toFixed(2)} over last ${revRows.length} observations`
                );
            }
        }

        // Rule 3: chronically unreliable services (down >30 % of cycles)
        const svcRows = rows.filter(r => Array.isArray(r.services_down));
        if (svcRows.length >= 10) {
            const counts = {};
            svcRows.forEach(r => r.services_down.forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
            const unreliable = Object.entries(counts)
                .filter(([, c]) => c / svcRows.length > 0.3)
                .map(([s, c]) => `${s} (${Math.round(c / svcRows.length * 100)}% downtime)`);
            if (unreliable.length) {
                rules.push(`Chronically unreliable services: ${unreliable.join(', ')}`);
            }
        }

        this.correlationRules = rules;
        this.worldModelTs     = new Date().toISOString();

        if (rules.length) {
            console.log(`[🤖 AgentLoop] World model updated (${rules.length} rule${rules.length > 1 ? 's' : ''}): ${rules[0].slice(0, 80)}…`);
            // Persist rules as high-importance world_model memories
            for (const rule of rules) {
                const memId = `wm_${Buffer.from(rule.slice(0, 60)).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 32)}`;
                await this.supabase.from('heidi_memories').upsert({
                    id: memId, device_id: 'agent_loop', content: rule,
                    source: 'world_model', importance: 0.9, embedding: null
                }).catch(() => {});
            }
        }
    }

    // ── API helpers ────────────────────────────────────────────────────────────

    getStatus() {
        const now = Date.now();
        const suppressedUntil = {};
        for (const [k, t] of this._alertCooldowns) {
            const remaining = t + this._alertCooldownMs - now;
            if (remaining > 0) suppressedUntil[k] = new Date(t + this._alertCooldownMs).toISOString();
        }
        return {
            enabled: this.enabled, running: this.running,
            interval_min: this.intervalMin, autonomy_level: this.autonomyLevel,
            reasoning_model: this.reasoningModel,
            cycle_count: this.cycleCount, last_run: this.lastRun,
            pending_count: this.pendingActions.size,
            alert_cooldown_min: Math.round(this._alertCooldownMs / 60000),
            suppressed_until: suppressedUntil,
            next_run: this.timer && this.lastRun
                ? new Date(new Date(this.lastRun).getTime() + this.intervalMin * 60000).toISOString()
                : null
        };
    }

    getLog()        { return this.log.slice(0, 20); }
    getPending()    { return [...this.pendingActions.values()]; }
    getWorldModel() { return { rules: this.correlationRules, updated_at: this.worldModelTs, cycle_count: this.cycleCount }; }

    authorize(id) {
        const a = this.pendingActions.get(id);
        if (!a) throw new Error(`Unknown action: ${id}`);
        a.status = 'authorized'; a.authorized_at = new Date().toISOString();
        this.pendingActions.set(id, a);
        this.emit('action_authorized', a);
        // Execute authorized forge builds immediately
        if (a.action === 'forge_build') this._executeForgeBuild(a);
        return a;
    }

    async _executeForgeBuild(action) {
        try {
            console.log(`[🤖 AgentLoop] Executing authorized forge build trigger (action ${action.id})`);
            const r = await fetch(`${this.bridgeUrl}/api/builds/trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'agent_loop', action_id: action.id, authorized_at: action.authorized_at }),
                signal: AbortSignal.timeout(10000)
            });
            const resultText = r.ok ? 'triggered' : `HTTP ${r.status}`;
            console.log(`[🤖 AgentLoop] Forge build trigger: ${resultText}`);
            action.status = 'executed'; action.executed_at = new Date().toISOString(); action.result = resultText;
            this.pendingActions.set(action.id, action);
            this._push({ type: 'hydi_activity', level: 'info',
                title: 'Forge Build Triggered',
                body: `Agent triggered forge build — status: ${resultText}`,
                payload: { action_id: action.id, source: 'agent_loop' }, ts: Date.now() });
        } catch (e) {
            console.error(`[🤖 AgentLoop] Forge build trigger failed:`, e.message);
            action.status = 'execute_failed'; action.error = e.message;
            this.pendingActions.set(action.id, action);
        }
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
