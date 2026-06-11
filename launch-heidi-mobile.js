#!/usr/bin/env node
/**
 * Heidi Local Mobile Chat Server
 * Streams from Ollama/LM Studio — open on mobile via LAN URL printed at startup
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = parseInt(process.env.HEIDI_PORT || '3006');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const DEFAULT_MODEL = process.env.LOCAL_MODEL_NAME || 'tinyllama';
const HYDI_URL      = process.env.HYDI_URL      || 'http://localhost:3005'; // legacy HYDI
const URSULA_URL    = process.env.URSULA_URL    || 'http://localhost:5050'; // heidi-bridge.py (or Flask direct)
const PROTOHUB_URL  = process.env.PROTOHUB_URL  || 'http://localhost:4000'; // Node/protohub
const NEXT_APP_URL  = process.env.NEXT_APP_URL  || 'https://ursula-nine.vercel.app';

const CHAT_TIMEOUT_MS = 600_000;
const HYDI_TIMEOUT_MS = 3000;

const REVENUE_STREAMS = [
    'galactic_bytes', 'detailer_bot', 'lipi_v2',
    'protogrance_aromatics', 'rezonate', 'waveformer_studio'
];

const STRIPE_CONNECT_ACCOUNTS = {
    galactic_bytes:        process.env.STRIPE_ACCOUNT_GALACTIC_BYTES,
    detailer_bot:          process.env.STRIPE_ACCOUNT_DETAILER_BOT,
    lipi_v2:               process.env.STRIPE_ACCOUNT_LIPI_V2,
    protogrance_aromatics: process.env.STRIPE_ACCOUNT_PROTOGRANCE_AROMATICS,
    rezonate:              process.env.STRIPE_ACCOUNT_REZONATE,
    waveformer_studio:     process.env.STRIPE_ACCOUNT_WAVEFORMER_STUDIO,
};

// ── Supabase client ───────────────────────────────────────────────────────────

let supabaseClient = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabaseClient = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false } }
        );
        console.log('✅ Supabase memory: connected');
    } catch (e) {
        console.log('⚠️  Supabase memory: disabled —', e.message);
    }
} else {
    console.log('ℹ️  Supabase memory: disabled (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'get_system_health',
            description: 'Check health of local AI services (Ollama, LM Studio) and list available models',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_hydi_status',
            description: 'Get current ProtoForge backend status — queries Ursula (Flask/5000), Protohub (Node/4000), and HYDI. Returns service health, database connection, build count, and event metrics.',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_build_status',
            description: 'Get ProtoForge forge runner build history and pipeline status from Ursula. Returns total builds, recent build list, and current forge cycle state.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of recent builds to return (default 10, max 50)' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a safe read-only shell command (ps, free, df, uptime, ls, etc.)',
            parameters: {
                type: 'object',
                properties: { command: { type: 'string', description: 'Shell command to run' } },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read a file from the project directory',
            parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: 'File path relative to project root or absolute' } },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_current_time',
            description: 'Get the current date, time, and timezone',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_ursula_live',
            description: 'Query the live Ursula Vercel app directly (https://ursula-nine.vercel.app). Fetches real-time system health, revenue data, or any API route. Pass a path like /api/health, /api/revenue, /api/ursula/status.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'API path to fetch, e.g. /api/health or /api/revenue' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_rezonate_score',
            description: 'Get Rezonate DAW completion score, estimated monthly revenue, pricing tiers, and scaffolding suggestions from the local rezonate_core module via heidi-bridge.',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'query_database',
            description: 'Run a read-only SELECT query against the ProtoForge SQLite database (protoforge.db) via heidi-bridge. Use to inspect leads, builds, sessions, revenue entries, or any table.',
            parameters: {
                type: 'object',
                properties: {
                    sql: { type: 'string', description: 'A SELECT SQL query to run against protoforge.db' }
                },
                required: ['sql']
            }
        }
    },
    // ── Revenue tools ─────────────────────────────────────────────────────────
    {
        type: 'function',
        function: {
            name: 'get_revenue_summary',
            description: 'Get revenue totals from the ProtoForge ledger. Shows gross, net, and transaction counts by stream.',
            parameters: {
                type: 'object',
                properties: {
                    stream: { type: 'string', description: 'Filter by stream name. Omit for all 6 streams.' },
                    days:   { type: 'integer', description: 'Days to look back. Default: 30.' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_revenue_pipeline',
            description: 'Get leads, quotes, and proposals from the ProtoForge revenue pipeline.',
            parameters: {
                type: 'object',
                properties: {
                    stage: { type: 'string', description: 'Filter by stage: leads, quotes, or proposals. Omit for all.' },
                    limit: { type: 'integer', description: 'Max records per stage. Default: 5.' }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_lead',
            description: 'Create a new client lead in the revenue pipeline. AUTHORIZATION REQUIRED: always show the user all details and wait for explicit CONFIRM before calling this tool.',
            parameters: {
                type: 'object',
                properties: {
                    name:            { type: 'string',  description: 'Client or company name' },
                    email:           { type: 'string',  description: 'Client email address' },
                    service:         { type: 'string',  description: 'Service or product description' },
                    stream:          { type: 'string',  description: 'Revenue stream: ' + REVENUE_STREAMS.join(', ') },
                    estimated_value: { type: 'number',  description: 'Estimated deal value in dollars' },
                    notes:           { type: 'string',  description: 'Additional notes' }
                },
                required: ['name', 'service', 'stream']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_checkout_link',
            description: 'Generate a live Stripe checkout payment link to send to a client. AUTHORIZATION REQUIRED: present full details and wait for CONFIRM. Returns a payment URL.',
            parameters: {
                type: 'object',
                properties: {
                    amount_cents:  { type: 'integer', description: 'Amount in cents. E.g. 50000 = $500.00' },
                    description:   { type: 'string',  description: 'Product/service name shown on Stripe checkout' },
                    stream:        { type: 'string',  description: 'Revenue stream: ' + REVENUE_STREAMS.join(', ') },
                    client_email:  { type: 'string',  description: 'Pre-fill client email (optional)' },
                    currency:      { type: 'string',  description: 'ISO currency code. Default: usd' }
                },
                required: ['amount_cents', 'description', 'stream']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_payout_status',
            description: 'Check payout status and net balances from the ledger by stream.',
            parameters: {
                type: 'object',
                properties: {
                    stream: { type: 'string', description: 'Filter by stream. Omit for all.' }
                },
                required: []
            }
        }
    }
];

const SAFE_CMDS = new Set([
    'ps', 'free', 'df', 'du', 'ls', 'cat', 'head', 'tail', 'wc',
    'uptime', 'uname', 'whoami', 'date', 'hostname', 'id',
    'ip', 'ifconfig', 'netstat', 'ss',
    'node', 'npm', 'git', 'ollama', 'which', 'env', 'printenv',
    'vmstat', 'iostat', 'lscpu', 'top'
]);

async function executeToolCall(name, args) {
    switch (name) {
        // ── System tools ──────────────────────────────────────────────────────
        case 'get_system_health': {
            const status = { server: 'ok', ollama: false, lmstudio: false, models: [] };
            try {
                const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
                if (r.ok) { status.ollama = true; const d = await r.json(); status.models = d.models?.map(m => m.name) || []; }
            } catch {}
            try {
                const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
                if (r.ok) status.lmstudio = true;
            } catch {}
            return JSON.stringify(status, null, 2);
        }

        case 'get_hydi_status': {
            const all = await fetchBackendStatus();
            if (!all.online) return `No backend reachable.\n  Ursula: ${URSULA_URL}\n  Protohub: ${PROTOHUB_URL}\n  HYDI: ${HYDI_URL}\nStart ursula_server.py (port 5000) and/or protohub (port 4000).`;
            return JSON.stringify(all, null, 2);
        }

        case 'get_ursula_live': {
            const urlPath = String(args.path || '/api/health').trim();
            const ursulaBase = 'https://ursula-nine.vercel.app';
            try {
                const r = await fetch(`${ursulaBase}${urlPath}`, { signal: AbortSignal.timeout(8000) });
                if (!r.ok) return `Ursula returned HTTP ${r.status} for ${urlPath}`;
                const data = await r.json();
                return JSON.stringify(data, null, 2);
            } catch (e) {
                return `Cannot reach Ursula at ${ursulaBase}${urlPath}: ${e.message}`;
            }
        }

        case 'get_rezonate_score': {
            try {
                const r = await fetch(`${URSULA_URL}/api/rezonate/score`, { signal: AbortSignal.timeout(8000) });
                if (!r.ok) return `Bridge returned HTTP ${r.status}`;
                return JSON.stringify(await r.json(), null, 2);
            } catch (e) {
                return `Cannot reach bridge at ${URSULA_URL}/api/rezonate/score: ${e.message}`;
            }
        }

        case 'query_database': {
            const sql = String(args.sql || '').trim();
            if (!sql) return 'Error: no SQL provided';
            if (!/^SELECT/i.test(sql)) return 'Error: only SELECT queries allowed';
            try {
                const r = await fetch(`${URSULA_URL}/api/db/query`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql }), signal: AbortSignal.timeout(5000)
                });
                if (!r.ok) return `DB query failed: HTTP ${r.status}`;
                const result = await r.json();
                if (result.error) return `DB error: ${result.error}`;
                return JSON.stringify({ rows: result.rows, count: result.count }, null, 2);
            } catch (e) {
                return `Cannot reach bridge at ${URSULA_URL}/api/db/query: ${e.message}`;
            }
        }

        case 'get_build_status': {
            const limit = Math.min(parseInt(args.limit) || 10, 50);
            // Try Ursula build endpoints
            const endpoints = [
                `/api/builds?limit=${limit}`,
                `/api/forge/status`,
                `/forge/builds?limit=${limit}`,
                `/dashboard`
            ];
            for (const ep of endpoints) {
                try {
                    const r = await fetch(`${URSULA_URL}${ep}`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) });
                    if (!r.ok) continue;
                    const d = await r.json();
                    return JSON.stringify({ source: `${URSULA_URL}${ep}`, data: d }, null, 2);
                } catch {}
            }
            // Fallback: read build_registry.json if on same machine
            const registryPaths = [
                path.join(__dirname, 'build_registry.json'),
                path.join(__dirname, '..', 'build_registry.json')
            ];
            for (const p of registryPaths) {
                try {
                    const raw = fs.readFileSync(p, 'utf8');
                    const data = JSON.parse(raw);
                    const builds = Array.isArray(data) ? data : (data.builds || []);
                    return JSON.stringify({
                        source: p,
                        total_builds: builds.length,
                        recent: builds.slice(-limit).reverse()
                    }, null, 2);
                } catch {}
            }
            return `Ursula build endpoints not reachable at ${URSULA_URL}. Ensure ursula_server.py is running.`;
        }

        case 'run_command': {
            const cmd = String(args.command || '').trim();
            if (!cmd) return 'Error: no command provided';
            const baseCmd = cmd.split(/\s+/)[0].split('/').pop();
            if (!SAFE_CMDS.has(baseCmd)) return `Not allowed: "${baseCmd}". Permitted: ${[...SAFE_CMDS].join(', ')}`;
            if (/[;&|`$(){}\n<>]/.test(cmd) || cmd.includes('..')) return 'Error: unsafe characters in command';
            try {
                return execSync(cmd, { timeout: 10000, encoding: 'utf8', maxBuffer: 64 * 1024 }).slice(0, 3000) || '(no output)';
            } catch (e) {
                return `Failed: ${(e.stderr || e.message || '').slice(0, 500)}`;
            }
        }

        case 'read_file': {
            const filePath = String(args.path || '').trim();
            if (!filePath) return 'Error: no path provided';
            const resolved = path.resolve(__dirname, filePath);
            if (!resolved.startsWith(path.resolve(__dirname))) return 'Access denied: path outside project directory';
            try { return fs.readFileSync(resolved, 'utf8').slice(0, 5000); }
            catch (e) { return `Cannot read: ${e.message}`; }
        }

        case 'get_current_time': {
            const n = new Date();
            return `${n.toString()} (UTC: ${n.toUTCString()})`;
        }

        // ── Revenue tools ──────────────────────────────────────────────────────
        case 'get_revenue_summary': {
            if (!supabaseClient) return 'Supabase not connected. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.';
            const days = Math.min(parseInt(args.days) || 30, 365);
            const since = new Date(Date.now() - days * 864e5).toISOString();
            let q = supabaseClient
                .from('ledger')
                .select('stream, gross_amount, net_amount, created_at, payout_status')
                .gte('created_at', since)
                .order('created_at', { ascending: false })
                .limit(500);
            if (args.stream) q = q.eq('stream', args.stream);
            const { data, error } = await q;
            if (error) return `Ledger query failed: ${error.message}`;
            const rows = data || [];
            const totals = {};
            for (const row of rows) {
                const s = row.stream || 'unknown';
                if (!totals[s]) totals[s] = { gross: 0, net: 0, count: 0, pending_payout: 0 };
                totals[s].gross += row.gross_amount || 0;
                totals[s].net   += row.net_amount   || 0;
                totals[s].count++;
                if (row.payout_status === 'pending') totals[s].pending_payout += row.net_amount || 0;
            }
            const fmt = cents => `$${(cents / 100).toFixed(2)}`;
            const grand = Object.values(totals).reduce((a, b) => ({ gross: a.gross + b.gross, net: a.net + b.net, count: a.count + b.count }), { gross: 0, net: 0, count: 0 });
            return JSON.stringify({
                period_days: days,
                total_transactions: grand.count,
                total_gross: fmt(grand.gross),
                total_net:   fmt(grand.net),
                by_stream: Object.fromEntries(
                    Object.entries(totals).map(([k, v]) => [k, {
                        gross: fmt(v.gross), net: fmt(v.net),
                        transactions: v.count,
                        pending_payout: fmt(v.pending_payout)
                    }])
                ),
                recent: rows.slice(0, 5).map(r => ({
                    stream: r.stream, gross: fmt(r.gross_amount || 0),
                    net: fmt(r.net_amount || 0), status: r.payout_status,
                    date: new Date(r.created_at).toLocaleDateString()
                }))
            }, null, 2);
        }

        case 'get_revenue_pipeline': {
            if (!supabaseClient) return 'Supabase not connected.';
            const limit = Math.min(parseInt(args.limit) || 5, 20);
            const stages = args.stage ? [args.stage] : ['leads', 'quotes', 'proposals'];
            const result = {};
            for (const stage of stages) {
                const { data, error } = await supabaseClient
                    .from(stage)
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(limit);
                result[stage] = error ? `Error: ${error.message}` : (data || []);
            }
            return JSON.stringify(result, null, 2);
        }

        case 'create_lead': {
            if (!supabaseClient) return 'Supabase not connected.';
            const { name, email, service, stream, estimated_value, notes } = args;
            if (!name || !service || !stream) return 'Error: name, service, and stream are required.';
            if (!REVENUE_STREAMS.includes(stream)) return `Invalid stream. Valid: ${REVENUE_STREAMS.join(', ')}`;
            const { data, error } = await supabaseClient
                .from('leads')
                .insert({
                    name,
                    email:           email || null,
                    service,
                    stream,
                    estimated_value: estimated_value ? Math.round(estimated_value * 100) : null,
                    notes:           notes || null,
                    status:          'new',
                    source:          'heidi-mobile',
                })
                .select()
                .single();
            if (error) return `Failed to create lead: ${error.message}`;
            return JSON.stringify({ success: true, lead_id: data?.id, name, service, stream, message: `Lead created for ${name}` }, null, 2);
        }

        case 'generate_checkout_link': {
            if (!process.env.STRIPE_SECRET_KEY) return 'STRIPE_SECRET_KEY not set in .env — cannot create checkout link.';
            const { amount_cents, description, stream, client_email, currency = 'usd' } = args;
            if (!amount_cents || !description || !stream) return 'Error: amount_cents, description, and stream are required.';
            if (!REVENUE_STREAMS.includes(stream)) return `Invalid stream: ${stream}. Valid: ${REVENUE_STREAMS.join(', ')}`;

            const body = new URLSearchParams({
                'payment_method_types[]':                         'card',
                'line_items[0][price_data][currency]':            currency,
                'line_items[0][price_data][product_data][name]':  description,
                'line_items[0][price_data][unit_amount]':         String(amount_cents),
                'line_items[0][quantity]':                        '1',
                'mode':                                           'payment',
                'success_url':                                    `${NEXT_APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
                'cancel_url':                                     `${NEXT_APP_URL}/cancel`,
                'metadata[stream]':                               stream,
                'metadata[source]':                               'heidi-mobile',
            });
            if (client_email) body.set('customer_email', client_email);

            const headers = {
                'Authorization':  `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type':   'application/x-www-form-urlencoded',
            };
            const connectAcct = STRIPE_CONNECT_ACCOUNTS[stream];
            if (connectAcct) headers['Stripe-Account'] = connectAcct;

            try {
                const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST', headers, body: body.toString(),
                    signal: AbortSignal.timeout(15000)
                });
                const result = await r.json();
                if (!r.ok) return `Stripe error: ${result.error?.message || JSON.stringify(result.error)}`;

                if (supabaseClient) {
                    await supabaseClient.from('checkout_sessions').insert({
                        stripe_session_id: result.id,
                        amount:            amount_cents,
                        currency,
                        description,
                        stream,
                        client_email:      client_email || null,
                        status:            'pending',
                        url:               result.url,
                    }).catch(() => {});
                }

                return JSON.stringify({
                    success:      true,
                    checkout_url: result.url,
                    session_id:   result.id,
                    amount:       `${currency.toUpperCase()} ${(amount_cents / 100).toFixed(2)}`,
                    description,
                    stream,
                    connect_account: connectAcct || 'platform',
                    expires: new Date(result.expires_at * 1000).toLocaleString()
                }, null, 2);
            } catch (e) {
                return `Checkout link failed: ${e.message}`;
            }
        }

        case 'get_payout_status': {
            if (!supabaseClient) return 'Supabase not connected.';
            let q = supabaseClient.from('ledger').select('stream, net_amount, payout_status');
            if (args.stream) q = q.eq('stream', args.stream);
            const { data, error } = await q;
            if (error) return `Error: ${error.message}`;
            const fmt = cents => `$${(cents / 100).toFixed(2)}`;
            const status = {};
            for (const row of data || []) {
                const s = row.stream || 'unknown';
                if (!status[s]) status[s] = { pending: 0, paid: 0, total_net: 0 };
                if (row.payout_status === 'pending') status[s].pending += row.net_amount || 0;
                if (row.payout_status === 'paid')    status[s].paid    += row.net_amount || 0;
                status[s].total_net += row.net_amount || 0;
            }
            return JSON.stringify({
                payout_status: Object.fromEntries(
                    Object.entries(status).map(([k, v]) => [k, {
                        pending_payout: fmt(v.pending),
                        paid_out:       fmt(v.paid),
                        total_net:      fmt(v.total_net)
                    }])
                )
            }, null, 2);
        }

        default:
            return `Unknown tool: ${name}`;
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getLANIP() {
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

// Probe Ursula (Flask) — tries several common route patterns
async function fetchUrsulaStatus() {
    const probes = ['/health', '/api/health', '/status', '/api/status'];
    for (const ep of probes) {
        try {
            const r = await fetch(`${URSULA_URL}${ep}`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) });
            if (!r.ok) continue;
            const d = await r.json();
            return {
                online: true, source: 'ursula',
                status: d.status || (d.ok || d.healthy ? 'operational' : 'unknown'),
                database: d.database || d.db || (d.sqlite ? 'sqlite' : 'unknown'),
                totalEvents: d.total_events || d.events || d.builds || d.build_count || 0,
                version: d.version || null,
                modules: d.modules || d.apps || null,
                timestamp: d.timestamp || new Date().toISOString(),
                endpoint: ep
            };
        } catch {}
    }
    return null;
}

// Probe Protohub (Node/Express)
async function fetchProtohubStatus() {
    const probes = ['/health', '/api/health', '/status'];
    for (const ep of probes) {
        try {
            const r = await fetch(`${PROTOHUB_URL}${ep}`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) });
            if (!r.ok) continue;
            const d = await r.json();
            return {
                online: true, source: 'protohub',
                status: d.status || 'operational',
                version: d.version || null,
                endpoint: ep
            };
        } catch {}
    }
    return null;
}

// Legacy HYDI bridge (v1)
async function fetchHydiStatus() {
    try {
        const [healthRes, metricsRes] = await Promise.allSettled([
            fetch(`${HYDI_URL}/health`,  { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) }),
            fetch(`${HYDI_URL}/metrics`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) })
        ]);
        let health = null, metrics = null;
        if (healthRes.status === 'fulfilled' && healthRes.value.ok)  health  = await healthRes.value.json();
        if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) metrics = await metricsRes.value.json();
        if (!health) return null;
        return {
            online: true, source: 'hydi',
            status: health.status, database: health.database,
            totalEvents: metrics?.total_events || 0,
            eventBus: metrics?.event_bus || null,
            timestamp: health.timestamp
        };
    } catch { return null; }
}

// Unified status — Ursula first, then legacy HYDI
async function fetchBackendStatus() {
    const [ursula, protohub, hydi] = await Promise.allSettled([
        fetchUrsulaStatus(), fetchProtohubStatus(), fetchHydiStatus()
    ]);
    return {
        ursula:   ursula.value   || null,
        protohub: protohub.value || null,
        hydi:     hydi.value     || null,
        online:   !!(ursula.value || protohub.value || hydi.value)
    };
}

function buildSystemPrompt(backendStatus = null) {
    let prompt = `You are Heidi, the AI command interface for the ProtoForge ecosystem — an autonomous revenue-generating platform.
You run locally via Ollama on Android/Termux. The operator directs you to manage and grow revenue.

LIVE BACKEND:
  Ursula (cloud)  — https://ursula-nine.vercel.app — Next.js/Supabase, live now
                    Routes: /api/health, /api/ursula/status, /api/revenue, /api/chat
  Heidi Bridge    — http://localhost:5050 (Windows) — reads protoforge.db + build_registry.json
                    Routes: /health, /api/builds, /api/metrics, /api/db/query, /api/rezonate/score
  Protohub        — http://localhost:4000 — Node/Express, JWT auth, Stripe billing (Pro $49, Enterprise $199)
  Forge           — forge_runner.py: 545+ builds, protoforge.db (SQLite), build_registry.json

MODULES (in Ursula_Suite):
  Proto.I.Y · BlameGames · PorchWise · Rezonette (DAW) · Checkpoint QA

SYSTEM TOOLS: get_system_health, get_hydi_status, get_build_status, get_ursula_live, get_rezonate_score, query_database, run_command, read_file, get_current_time
REVENUE TOOLS: get_revenue_summary, get_revenue_pipeline, create_lead, generate_checkout_link, get_payout_status

REVENUE STREAMS: galactic_bytes | detailer_bot | lipi_v2 | protogrance_aromatics | rezonate | waveformer_studio

AUTHORIZATION PROTOCOL — MANDATORY for create_lead and generate_checkout_link:
  1. Before calling either tool, present a summary: action type, all parameters, dollar amount.
  2. End with: "Reply CONFIRM to authorize."
  3. Wait for the operator to reply CONFIRM (or equivalent). Do not proceed without it.
  4. After confirmation, call the tool and report the result.

Be direct and concise. Treat the operator as the system owner with full authority.
Current time: ${new Date().toLocaleString()}`;

    if (backendStatus) {
        const src = backendStatus.source || 'backend';
        prompt += `\n${src.toUpperCase()}: ${backendStatus.status} | DB: ${backendStatus.database} | Events/Builds: ${backendStatus.totalEvents}`;
    } else {
        prompt += `\nHYDI: offline`;
    }
    return prompt;
}

function buildFallback(message) {
    const lower = message.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey'))
        return "Hi! I'm Heidi, running in fallback mode — no local AI model detected. Install Ollama: ollama pull tinyllama";
    if (lower.includes('revenue') || lower.includes('stripe') || lower.includes('lead'))
        return "Revenue features require a local AI model. Install Ollama (ollama.ai), then: ollama pull llama3.2";
    if (lower.includes('status') || lower.includes('health'))
        return "Heidi server: running ✅  |  Local AI: not connected ⚠️\nInstall Ollama and pull a model to enable AI.";
    return "Fallback mode — no local AI model. Visit ollama.ai, then: ollama pull llama3.2";
}

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── PWA assets ────────────────────────────────────────────────────────────────

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json({
        name: 'Heidi', short_name: 'Heidi',
        description: 'HYDI ProtoForge command interface',
        start_url: '/', display: 'standalone',
        background_color: '#0e0c08', theme_color: '#0e0c08',
        orientation: 'portrait-primary',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
    });
});

app.get('/icon.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0e0c08"/>
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#c8881e"/><stop offset="100%" stop-color="#7a4010"/>
  </linearGradient></defs>
  <circle cx="96" cy="96" r="64" fill="url(#g)"/>
  <text x="96" y="122" text-anchor="middle" font-size="72"
        fill="#0e0c08" font-family="Courier New, monospace" font-weight="bold">H</text>
</svg>`);
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(`
const CACHE = 'heidi-v2';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.add('/'))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
    if (e.request.url.includes('/api/')) return;
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return res;
    })));
});
`);
});

// ── HYDI System bridge ────────────────────────────────────────────────────────

app.get('/api/system/status', async (req, res) => {
    const all = await fetchBackendStatus();
    // Return the first online service's status in the legacy shape for the UI panel
    const primary = all.ursula || all.protohub || all.hydi;
    if (!primary) return res.json({ online: false });
    res.json({
        online: true,
        status: primary.status || 'operational',
        database: primary.database || 'unknown',
        totalEvents: primary.totalEvents || 0,
        source: primary.source,
        backends: all
    });
});

app.post('/api/system/action', async (req, res) => {
    const { type, source, payload } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    const event = {
        event_id: `mobile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type, source: source || 'heidi-mobile',
        timestamp: new Date().toISOString(), payload: payload || {}
    };
    // Try Ursula event endpoint first, fall back to HYDI
    const targets = [
        `${URSULA_URL}/api/events`,
        `${URSULA_URL}/events`,
        `${HYDI_URL}/process`
    ];
    for (const url of targets) {
        try {
            const r = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event), signal: AbortSignal.timeout(HYDI_TIMEOUT_MS)
            });
            if (!r.ok) continue;
            return res.json({ success: true, result: await r.json(), target: url });
        } catch {}
    }
    res.status(503).json({ success: false, error: `No backend accepted event. Tried: ${targets.join(', ')}` });
});

// ── Revenue API routes ────────────────────────────────────────────────────────

app.get('/api/revenue/summary', async (req, res) => {
    if (!supabaseClient) return res.json({ available: false });
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const { data, error } = await supabaseClient
        .from('ledger')
        .select('stream, gross_amount, net_amount, payout_status')
        .gte('created_at', since);
    if (error) return res.status(500).json({ error: error.message });
    const totals = {};
    for (const row of data || []) {
        const s = row.stream || 'other';
        if (!totals[s]) totals[s] = { gross: 0, net: 0, count: 0 };
        totals[s].gross += row.gross_amount || 0;
        totals[s].net   += row.net_amount   || 0;
        totals[s].count++;
    }
    const grand = Object.values(totals).reduce((a, b) => ({ gross: a.gross + b.gross, net: a.net + b.net, count: a.count + b.count }), { gross: 0, net: 0, count: 0 });
    res.json({ days, grand, by_stream: totals });
});

app.get('/api/revenue/pipeline', async (req, res) => {
    if (!supabaseClient) return res.json({ available: false });
    const results = {};
    for (const stage of ['leads', 'quotes', 'proposals']) {
        const { data, error } = await supabaseClient.from(stage).select('id, name, service, stream, status, created_at').order('created_at', { ascending: false }).limit(5);
        results[stage] = error ? [] : (data || []);
    }
    res.json(results);
});

// ── Memory routes (Supabase) ──────────────────────────────────────────────────

const DEVICE_ID_RE = /^[a-z0-9-]{36}$/;

app.get('/api/memory/:deviceId', async (req, res) => {
    if (!supabaseClient) return res.json({ messages: null, offline: true });
    const { deviceId } = req.params;
    if (!DEVICE_ID_RE.test(deviceId)) return res.status(400).json({ error: 'invalid device id' });
    try {
        const { data, error } = await supabaseClient
            .from('heidi_chat_sessions')
            .select('messages, model, updated_at')
            .eq('device_id', deviceId)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        res.json({ messages: data?.messages || null, model: data?.model, updated_at: data?.updated_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/memory/:deviceId', async (req, res) => {
    if (!supabaseClient) return res.json({ saved: false, offline: true });
    const { deviceId } = req.params;
    if (!DEVICE_ID_RE.test(deviceId)) return res.status(400).json({ error: 'invalid device id' });
    const { messages, model } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });
    try {
        const { error } = await supabaseClient
            .from('heidi_chat_sessions')
            .upsert({
                device_id: deviceId, messages: messages.slice(-40),
                model: model || null, msg_count: messages.length,
                updated_at: new Date().toISOString()
            }, { onConflict: 'device_id' });
        if (error) throw error;
        res.json({ saved: true });
    } catch (e) { res.status(500).json({ saved: false, error: e.message }); }
});

// ── Push notification broadcast (SSE) ────────────────────────────────────────

const pushClients = new Set();
let lastEventCount    = -1;
let lastHydiOnline    = false;
let lastHydiOpStatus  = null;
let lastEventTime     = 0;
let silenceAlertSent  = false;

function broadcastPush(event) {
    if (!pushClients.size) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of [...pushClients]) {
        try { client.write(data); } catch { pushClients.delete(client); }
    }
}

app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(`data: ${JSON.stringify({ type: 'connected', clients: pushClients.size + 1 })}\n\n`);
    pushClients.add(res);
    const ping = setInterval(() => {
        try { res.write(': ping\n\n'); }
        catch { clearInterval(ping); pushClients.delete(res); }
    }, 25000);
    req.on('close', () => { clearInterval(ping); pushClients.delete(res); });
});

app.post('/api/events/push', (req, res) => {
    const { type, title, body, level = 'info', payload } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    broadcastPush({ type, title: title || type, body: body || '', level, payload: payload || {}, ts: Date.now() });
    res.json({ ok: true, clients: pushClients.size });
});

async function analyzeHydiState(status, delta) {
    try {
        const prompt = delta !== null
            ? `HYDI system: ${status.totalEvents} total events, ${delta} new in last 15s, status=${status.status}, db=${status.database}. Summarize in one concise sentence.`
            : `HYDI system: status=${status.status}, db=${status.database}, events=${status.totalEvents}. Describe current state in one concise sentence.`;
        const r = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: DEFAULT_MODEL, prompt, stream: false, options: { temperature: 0.4, num_predict: 60 } }),
            signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) return null;
        return (await r.json()).response?.trim() || null;
    } catch { return null; }
}

async function watchHydiEvents() {
    try {
        const backends = await fetchBackendStatus();
        const status = backends.ursula || backends.protohub || backends.hydi;
        const now = Date.now();
        if (!status) {
            if (lastHydiOnline) {
                lastHydiOnline = false;
                broadcastPush({ type: 'hydi_offline', title: 'HYDI Offline', body: 'System not responding', level: 'warning', payload: {}, ts: now });
            }
        } else {
            if (!lastHydiOnline) {
                lastHydiOnline = true; lastHydiOpStatus = status.status;
                broadcastPush({ type: 'hydi_recovered', title: 'HYDI Online', body: `Recovered · status: ${status.status}`, level: 'info', payload: { status: status.status }, ts: now });
            }
            if (lastHydiOpStatus !== null && lastHydiOpStatus !== status.status) {
                const analysis = await analyzeHydiState(status, null);
                broadcastPush({ type: 'hydi_status_change', title: 'HYDI Status Changed', body: analysis || `${lastHydiOpStatus} → ${status.status}`, level: status.status === 'operational' ? 'info' : 'warning', payload: { previous: lastHydiOpStatus, current: status.status }, ts: now });
            }
            lastHydiOpStatus = status.status;
            if (status.totalEvents !== undefined) {
                if (lastEventCount >= 0 && status.totalEvents > lastEventCount) {
                    const delta = status.totalEvents - lastEventCount;
                    lastEventTime = now; silenceAlertSent = false;
                    if (delta >= 20) {
                        const analysis = await analyzeHydiState(status, delta);
                        broadcastPush({ type: 'hydi_activity', title: `HYDI Burst: +${delta}`, body: analysis || `${delta} new events · total: ${status.totalEvents.toLocaleString()}`, level: 'warning', payload: { total: status.totalEvents, delta, burst: true }, ts: now });
                    } else {
                        broadcastPush({ type: 'hydi_activity', title: 'HYDI Activity', body: `${delta} new event${delta !== 1 ? 's' : ''} · total: ${status.totalEvents.toLocaleString()}`, level: status.status === 'operational' ? 'info' : 'warning', payload: { total: status.totalEvents, delta }, ts: now });
                    }
                } else if (lastEventCount >= 0 && lastEventTime > 0 && !silenceAlertSent) {
                    const silentMs = now - lastEventTime;
                    if (silentMs >= 30 * 60 * 1000) {
                        silenceAlertSent = true;
                        broadcastPush({ type: 'hydi_silence', title: 'HYDI Quiet', body: `No new events for ${Math.round(silentMs / 60000)} min`, level: 'info', payload: { silent_ms: silentMs }, ts: now });
                    }
                }
                if (lastEventCount === -1) lastEventTime = now;
                lastEventCount = status.totalEvents;
            }
        }
    } catch {}
    setTimeout(watchHydiEvents, 15000);
}

function scheduleDailyBriefing() {
    const hour = parseInt(process.env.BRIEFING_HOUR || '8', 10);
    const now = new Date(), next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    console.log(`📅 Daily briefing scheduled for ${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    setTimeout(async () => { await sendDailyBriefing(); scheduleDailyBriefing(); }, delay);
}

async function sendDailyBriefing() {
    if (!pushClients.size) return;
    try {
        const backends = await fetchBackendStatus();
        const status = backends.ursula || backends.protohub || backends.hydi;
        let revSummary = '';
        if (supabaseClient) {
            const since = new Date(Date.now() - 864e5).toISOString();
            const { data } = await supabaseClient.from('ledger').select('net_amount').gte('created_at', since);
            const net = (data || []).reduce((s, r) => s + (r.net_amount || 0), 0);
            if (net > 0) revSummary = ` Last 24h revenue: $${(net / 100).toFixed(2)}.`;
        }
        const backendName = status?.source || 'ProtoForge';
        const hydiCtx = status
            ? `${backendName}: ${status.status}, DB: ${status.database}, ${status.totalEvents} events/builds.`
            : 'Backend offline.';
        const prompt = `You are Heidi, the HYDI ProtoForge AI. Write a brief morning briefing in 2-3 sentences. Context: ${hydiCtx}${revSummary} Time: ${new Date().toLocaleString()}. Be warm and concise.`;
        const r = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: DEFAULT_MODEL, prompt, stream: false, options: { temperature: 0.6, num_predict: 100 } }),
            signal: AbortSignal.timeout(20000)
        });
        const text = r.ok ? ((await r.json()).response?.trim() || 'Good morning. System is running.') : 'Good morning. Daily check complete.';
        broadcastPush({ type: 'daily_briefing', title: 'Good Morning', body: text, level: 'briefing', payload: {}, ts: Date.now() });
    } catch {
        broadcastPush({ type: 'daily_briefing', title: 'Good Morning', body: 'Daily briefing — system running.', level: 'briefing', payload: {}, ts: Date.now() });
    }
}

// ── App routes ────────────────────────────────────────────────────────────────

app.get(['/', '/heidi-mobile', '/heidi'], (req, res) => {
    res.sendFile(path.join(__dirname, 'heidi-mobile-chat.html'));
});

app.get('/api/models', async (req, res) => {
    const models = [];
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { models: list = [] } = await r.json();
            models.push(...list.map(m => ({ id: m.name, name: m.name, provider: 'ollama', size: m.size ? (Math.round(m.size / 1e8) / 10) + 'GB' : '' })));
        }
    } catch {}
    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) { const { data = [] } = await r.json(); models.push(...data.map(m => ({ id: m.id, name: m.id, provider: 'lmstudio' }))); }
    } catch {}
    res.json({ models, default: DEFAULT_MODEL });
});

app.get('/api/health', async (req, res) => {
    const status = { server: 'ok', ollama: false, lmstudio: false, models: [], memory: !!supabaseClient, push_clients: pushClients.size, revenue_tools: !!supabaseClient, stripe_ready: !!process.env.STRIPE_SECRET_KEY };
    try { const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { status.ollama = true; const d = await r.json(); status.models = d.models?.map(m => m.name) || []; } } catch {}
    try { const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) }); if (r.ok) status.lmstudio = true; } catch {}
    res.json(status);
});

app.post('/api/chat', async (req, res) => {
    const { message, model, provider, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const send   = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const finish = (meta = {}) => { send({ done: true, ...meta }); res.end(); };
    const backends     = await fetchBackendStatus();
    const primaryStatus = backends.ursula || backends.protohub || backends.hydi;
    const systemPrompt = buildSystemPrompt(primaryStatus);
    const selectedModel = model || DEFAULT_MODEL;
    if (provider !== 'lmstudio') {
        try { await streamOllama(message, selectedModel, systemPrompt, history, send); return finish({ provider: 'ollama' }); }
        catch (e) { console.log('[Chat] Ollama:', e.message); }
    }
    try { await streamLMStudio(message, selectedModel, systemPrompt, history, send); return finish({ provider: 'lmstudio' }); }
    catch (e) { console.log('[Chat] LM Studio:', e.message); }
    const fallback = buildFallback(message);
    for (const char of fallback) { send({ t: char }); await new Promise(r => setTimeout(r, 12)); }
    finish({ provider: 'fallback' });
});

// ── Streaming ─────────────────────────────────────────────────────────────────

async function streamOllama(message, model, systemPrompt, history, send) {
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }];
    await streamOllamaMessages(messages, model, send, 0);
}

async function streamOllamaMessages(messages, model, send, depth) {
    if (depth > 3) throw new Error('Tool call depth limit reached');
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, tools: TOOLS, options: { temperature: 0.7, num_predict: 600 } }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finalMessage = null;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);
                if (data.message?.content) send({ t: data.message.content });
                if (data.done) finalMessage = data.message;
            } catch {}
        }
    }
    if (finalMessage?.tool_calls?.length > 0) {
        const updated = [...messages, { role: 'assistant', content: finalMessage.content || '', tool_calls: finalMessage.tool_calls }];
        for (const tc of finalMessage.tool_calls) {
            const toolName = tc.function?.name || 'unknown';
            const rawArgs  = tc.function?.arguments || {};
            const toolArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
            send({ tool_use: true, tool_name: toolName });
            let result;
            try { result = await executeToolCall(toolName, toolArgs); }
            catch (e) { result = `Tool error: ${e.message}`; }
            send({ tool_result: true, tool_name: toolName });
            updated.push({ role: 'tool', content: String(result) });
        }
        await streamOllamaMessages(updated, model, send, depth + 1);
    }
}

async function streamLMStudio(message, model, systemPrompt, history, send) {
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }];
    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true, temperature: 0.7, max_tokens: 600, messages }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try { const p = JSON.parse(data); const t = p.choices?.[0]?.delta?.content; if (t) send({ t }); } catch {}
        }
    }
}

// ── Server start ──────────────────────────────────────────────────────────────

const server = http.createServer(app);
const lanIP  = getLANIP();

server.listen(PORT, '0.0.0.0', async () => {
    const portStr = PORT.toString();
    const ipLine  = `http://${lanIP}:${portStr}`;
    console.log('\n╬════════════════════════════════════════════╗');
    console.log('║       H  HEIDI — ProtoForge Command        ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Desktop:  http://localhost:${portStr}${' '.repeat(16 - portStr.length)}║`);
    console.log(`║  Phone:    ${ipLine}${' '.repeat(34 - ipLine.length)}║`);
    console.log('╚════════════════════════════════════════════╝\n');
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { models = [] } = await r.json();
            if (models.length) { console.log(`✅ Ollama: ${models.map(m => m.name).join(', ')}`); }
            else console.log('⚠️  Ollama: no models. Run: ollama pull llama3.2');
        }
    } catch { console.log('⚠️  Ollama not found at', OLLAMA_URL); }
    // Probe all backend services
    const [ursula, protohub] = await Promise.allSettled([
        fetchUrsulaStatus(), fetchProtohubStatus()
    ]);
    if (ursula.value) {
        console.log(`Ursula (Flask): connected at ${URSULA_URL} — status: ${ursula.value.status}`);
    } else {
        console.log(`Ursula (Flask): not found at ${URSULA_URL} — set URSULA_URL env var`);
    }
    if (protohub.value) {
        console.log(`Protohub (Node): connected at ${PROTOHUB_URL}`);
    } else {
        console.log(`Protohub (Node): not found at ${PROTOHUB_URL} — set PROTOHUB_URL env var`);
    }
    console.log(supabaseClient ? '✅ Revenue tools: active (Supabase connected)' : 'ℹ️  Revenue tools: read-only (Supabase not connected)');
    console.log(process.env.STRIPE_SECRET_KEY ? '✅ Stripe checkout: ready' : 'ℹ️  Stripe checkout: disabled (set STRIPE_SECRET_KEY)');
    console.log('📡 Push alerts: ready | HYDI observer: active | Daily briefing: scheduled\n');
    watchHydiEvents();
    scheduleDailyBriefing();
});

process.on('SIGINT',  () => { console.log('\nShutting down Heidi...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException',  (e) => { console.error('Fatal:', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('Unhandled:', e); });
