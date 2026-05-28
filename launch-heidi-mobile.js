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
const HYDI_URL = process.env.HYDI_URL || 'http://localhost:3005';

const CHAT_TIMEOUT_MS = 600_000;
const HYDI_TIMEOUT_MS = 3000;

// ── Supabase client (optional — memory features disabled if env vars absent) ──

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
    console.log('ℹ️  Supabase memory: disabled (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to enable)');
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
            description: 'Get current HYDI ProtoForge system status: database connection, event count, and event bus metrics',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a safe read-only shell command to inspect system state (ps, free, df, uptime, ls, uname, etc.)',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to run' }
                },
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
                properties: {
                    path: { type: 'string', description: 'File path relative to project root or absolute' }
                },
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
            const s = await fetchHydiStatus();
            return s ? JSON.stringify(s, null, 2) : `HYDI not connected at ${HYDI_URL}`;
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
            try {
                return fs.readFileSync(resolved, 'utf8').slice(0, 5000);
            } catch (e) {
                return `Cannot read: ${e.message}`;
            }
        }

        case 'get_current_time': {
            const n = new Date();
            return `${n.toString()} (UTC: ${n.toUTCString()})`;
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

async function fetchHydiStatus() {
    try {
        const [healthRes, metricsRes] = await Promise.allSettled([
            fetch(`${HYDI_URL}/health`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) }),
            fetch(`${HYDI_URL}/metrics`, { signal: AbortSignal.timeout(HYDI_TIMEOUT_MS) })
        ]);
        let health = null, metrics = null;
        if (healthRes.status === 'fulfilled' && healthRes.value.ok) health = await healthRes.value.json();
        if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) metrics = await metricsRes.value.json();
        if (!health) return null;
        return {
            online: true,
            status: health.status,
            database: health.database,
            totalEvents: metrics?.total_events || 0,
            eventBus: metrics?.event_bus || null,
            timestamp: health.timestamp
        };
    } catch { return null; }
}

function buildSystemPrompt(hydiStatus = null) {
    let prompt = `You are Heidi, the AI assistant for the HYDI ProtoForge system.
You run locally on the user's device via Ollama.
You are helpful, direct, and slightly warm in personality.
You have access to tools: get_system_health, get_hydi_status, run_command, read_file, get_current_time.
Use tools when the user asks about system state, files, or live data — don't guess, check.
Keep responses concise (under 300 words) unless the user asks for detail.
Current date/time: ${new Date().toLocaleString()}`;

    if (hydiStatus) {
        prompt += `\n\nHYDI System Status (live):\n- Status: ${hydiStatus.status}\n- Database: ${hydiStatus.database}\n- Total events: ${hydiStatus.totalEvents}`;
        if (hydiStatus.eventBus) prompt += `\n- Event bus: ${JSON.stringify(hydiStatus.eventBus)}`;
    } else {
        prompt += `\n\nHYDI System: Not connected (set HYDI_URL env var to connect)`;
    }

    return prompt;
}

function buildFallback(message) {
    const lower = message.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey'))
        return "Hi! I'm Heidi, running in fallback mode — no local AI model detected. Install Ollama at ollama.ai, then: ollama pull tinyllama";
    if (lower.includes('model') || lower.includes('ollama') || lower.includes('install'))
        return "No local AI model connected.\n1. Install Ollama from ollama.ai\n2. ollama pull tinyllama\n3. Restart this server";
    if (lower.includes('status') || lower.includes('health'))
        return "Heidi server: running ✅  |  Local AI: not connected ⚠️\n\nInstall Ollama (ollama.ai) and pull a model to enable AI.";
    return "Fallback mode — no local AI model detected. Visit ollama.ai to get started, then: ollama pull tinyllama";
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
        description: 'HYDI ProtoForge local AI assistant',
        start_url: '/', display: 'standalone',
        background_color: '#0a0a0f', theme_color: '#0a0a0f',
        orientation: 'portrait-primary',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
    });
});

app.get('/icon.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0a0a0f"/>
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#64ffda"/><stop offset="100%" stop-color="#3b82f6"/>
  </linearGradient></defs>
  <circle cx="96" cy="96" r="64" fill="url(#g)"/>
  <text x="96" y="122" text-anchor="middle" font-size="72"
        fill="#0a0a0f" font-family="sans-serif" font-weight="bold">H</text>
</svg>`);
});

app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(`
const CACHE = 'heidi-v1';
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
    const status = await fetchHydiStatus();
    res.json(status || { online: false });
});

app.post('/api/system/action', async (req, res) => {
    const { type, source, payload } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    try {
        const event = {
            event_id: `mobile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type, source: source || 'heidi-mobile',
            timestamp: new Date().toISOString(), payload: payload || {}
        };
        const r = await fetch(`${HYDI_URL}/process`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event), signal: AbortSignal.timeout(HYDI_TIMEOUT_MS)
        });
        if (!r.ok) throw new Error(`HYDI HTTP ${r.status}`);
        res.json({ success: true, result: await r.json() });
    } catch (e) {
        res.status(503).json({ success: false, error: e.message });
    }
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
                device_id: deviceId,
                messages: messages.slice(-40),
                model: model || null,
                msg_count: messages.length,
                updated_at: new Date().toISOString()
            }, { onConflict: 'device_id' });
        if (error) throw error;
        res.json({ saved: true });
    } catch (e) {
        res.status(500).json({ saved: false, error: e.message });
    }
});

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
    const status = { server: 'ok', ollama: false, lmstudio: false, models: [], memory: !!supabaseClient };
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) { status.ollama = true; const data = await r.json(); status.models = data.models?.map(m => m.name) || []; }
    } catch {}
    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) status.lmstudio = true;
    } catch {}
    res.json(status);
});

app.post('/api/chat', async (req, res) => {
    const { message, model, provider, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const finish = (meta = {}) => { send({ done: true, ...meta }); res.end(); };

    const hydiStatus = await fetchHydiStatus();
    const systemPrompt = buildSystemPrompt(hydiStatus);
    const selectedModel = model || DEFAULT_MODEL;

    if (provider !== 'lmstudio') {
        try {
            await streamOllama(message, selectedModel, systemPrompt, history, send);
            return finish({ provider: 'ollama' });
        } catch (e) {
            console.log('[Chat] Ollama unavailable:', e.message);
        }
    }
    try {
        await streamLMStudio(message, selectedModel, systemPrompt, history, send);
        return finish({ provider: 'lmstudio' });
    } catch (e) {
        console.log('[Chat] LM Studio unavailable:', e.message);
    }

    const fallback = buildFallback(message);
    for (const char of fallback) { send({ t: char }); await new Promise(r => setTimeout(r, 12)); }
    finish({ provider: 'fallback' });
});

// ── Streaming ─────────────────────────────────────────────────────────────────

async function streamOllama(message, model, systemPrompt, history, send) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];
    await streamOllamaMessages(messages, model, send, 0);
}

async function streamOllamaMessages(messages, model, send, depth) {
    if (depth > 3) throw new Error('Tool call depth limit reached');

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, tools: TOOLS, options: { temperature: 0.7, num_predict: 400 } }),
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
        const updated = [
            ...messages,
            { role: 'assistant', content: finalMessage.content || '', tool_calls: finalMessage.tool_calls }
        ];
        for (const tc of finalMessage.tool_calls) {
            const toolName = tc.function?.name || 'unknown';
            const rawArgs = tc.function?.arguments || {};
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
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];
    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true, temperature: 0.7, max_tokens: 400, messages }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content;
                if (token) send({ t: token });
            } catch {}
        }
    }
}

// ── Server start ──────────────────────────────────────────────────────────────

const server = http.createServer(app);
const lanIP = getLANIP();

server.listen(PORT, '0.0.0.0', async () => {
    const portStr = PORT.toString();
    const ipLine = `http://${lanIP}:${portStr}`;
    console.log('\n╬════════════════════════════════════════════╗');
    console.log('║       🧠  HEIDI — Local Mobile Chat          ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Desktop:  http://localhost:${portStr}${' '.repeat(16 - portStr.length)}║`);
    console.log(`║  📱 Phone: ${ipLine}${' '.repeat(34 - ipLine.length)}║`);
    console.log('╠════════════════════════════════════════════╣');
    console.log('║  Open the Phone URL on your mobile device    ║');
    console.log('║  (must be on the same WiFi / LAN network)    ║');
    console.log('╚════════════════════════════════════════════╝\n');
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { models = [] } = await r.json();
            if (models.length) { console.log(`✅ Ollama: ${models.map(m => m.name).join(', ')}`); console.log(`   Default model: ${DEFAULT_MODEL}`); }
            else console.log('⚠️  Ollama running but no models. Run: ollama pull tinyllama');
        }
    } catch { console.log('⚠️  Ollama not found at', OLLAMA_URL); }
    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) console.log(`✅ LM Studio online at ${LM_STUDIO_URL}`);
    } catch { console.log('ℹ️  LM Studio not found (optional)'); }
    try {
        const r = await fetch(`${HYDI_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) { const h = await r.json(); console.log(`✅ HYDI online at ${HYDI_URL} — db: ${h.database}`); }
        else console.log(`ℹ️  HYDI not found at ${HYDI_URL} (set HYDI_URL env var to connect)`);
    } catch { console.log(`ℹ️  HYDI not found at ${HYDI_URL} (set HYDI_URL env var to connect)`); }
    console.log('');
});

process.on('SIGINT', () => { console.log('\n🛑 Shutting down Heidi...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (e) => { console.error('Fatal:', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('Unhandled rejection:', e); });
