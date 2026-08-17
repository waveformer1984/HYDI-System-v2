#!/usr/bin/env node
/**
 * Heidi Local Mobile Chat Server
 * Streams from Ollama/LM Studio — open on mobile via LAN URL printed at startup
 *
 * Setup:
 *   1. npm install
 *   2. Install Ollama: https://ollama.ai
 *   3. ollama pull llama3
 *   4. node launch-heidi-mobile.js
 *   5. Open the phone URL shown in the console on your mobile device (same WiFi)
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// HEIDI_MOBILE_PORT preferred; HEIDI_PORT kept for start-hydi.js compat, but
// beware: heidi-core's server.js reads the same HEIDI_PORT for ITS port.
const PORT = parseInt(process.env.HEIDI_MOBILE_PORT || process.env.HEIDI_PORT || '3006');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const DEFAULT_MODEL = process.env.LOCAL_MODEL_NAME || 'llama3';
// Heidi Core (heidi-core/server.js) — the full local brain with memory +
// reflection. When it's running, chat is routed through it instead of raw
// Ollama, so every UI client of this server gets the real Heidi.
const HEIDI_CORE_URL = process.env.HEIDI_CORE_URL || 'http://localhost:3459';

function getLANIP() {
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

function buildSystemPrompt() {
    return `You are Heidi, the AI assistant for the HYDI ProtoForge system.
You run locally on the user's device via Ollama.
You are helpful, direct, and slightly warm in personality.
You assist with: system health monitoring, technical questions, deployments, code, and general tasks.
When asked to take an action, explain what you will do clearly and concisely.
Keep responses concise (under 300 words) unless the user explicitly asks for detail.
Current date/time: ${new Date().toLocaleString()}`;
}

function buildFallback(message) {
    const lower = message.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
        return "Hi! I'm Heidi, running in fallback mode — no local AI model detected. Install Ollama at ollama.ai, then run: ollama pull llama3. Once done, restart this server and I'll have full AI capabilities!";
    }
    if (lower.includes('model') || lower.includes('ollama') || lower.includes('install')) {
        return "No local AI model is connected. To set one up:\n1. Install Ollama from ollama.ai\n2. Run: ollama pull llama3\n3. Restart this server\n\nLM Studio is also supported (port 1234). Once a model is running, Heidi will stream responses directly to your phone!";
    }
    if (lower.includes('status') || lower.includes('health')) {
        return "Heidi server: running ✅  |  Local AI: not connected ⚠️\n\nTo enable AI: install Ollama (ollama.ai) and pull a model. The server is ready and waiting for a local model connection.";
    }
    return "I'm in fallback mode — no local AI model detected. The server is running but needs Ollama or LM Studio for full AI. Visit ollama.ai to get started, then run: ollama pull llama3";
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Serve mobile chat UI
app.get(['/', '/heidi-mobile', '/heidi'], (req, res) => {
    res.sendFile(path.join(__dirname, 'heidi-mobile-chat.html'));
});

// Available models from local providers
app.get('/api/models', async (req, res) => {
    const models = [];

    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { models: list = [] } = await r.json();
            models.push(...list.map(m => ({
                id: m.name,
                name: m.name,
                provider: 'ollama',
                size: m.size ? (Math.round(m.size / 1e8) / 10) + 'GB' : ''
            })));
        }
    } catch {}

    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { data = [] } = await r.json();
            models.push(...data.map(m => ({ id: m.id, name: m.id, provider: 'lmstudio' })));
        }
    } catch {}

    res.json({ models, default: DEFAULT_MODEL });
});

// Server + AI health
app.get('/api/health', async (req, res) => {
    const status = { server: 'ok', ollama: false, lmstudio: false, heidiCore: false, models: [] };

    try {
        const r = await fetch(`${HEIDI_CORE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) status.heidiCore = true;
    } catch {}

    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            status.ollama = true;
            const data = await r.json();
            status.models = data.models?.map(m => m.name) || [];
        }
    } catch {}

    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) status.lmstudio = true;
    } catch {}

    res.json(status);
});

// SSE streaming chat
app.post('/api/chat', async (req, res) => {
    const { message, model, provider } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let sentAny = false;
    const send = (data) => {
        if (data.t) sentAny = true;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const finish = (meta = {}) => { send({ done: true, ...meta }); res.end(); };

    const systemPrompt = buildSystemPrompt();
    const selectedModel = model || DEFAULT_MODEL;

    // 1) Heidi Core (memory + reflection brain) — the real Heidi, ALWAYS
    // tried first. The UI's `provider` reports which backend hosts the picked
    // model; it is NOT a directive to bypass Heidi's tools. Selecting an Ollama
    // model just chooses a model — tools (status, missions, agents) must still
    // work. Only an explicit `provider: 'raw'` skips the brain (debug escape).
    // First choice is /chat-tools (real tool execution); /think-stream is the
    // tool-less fallback for older cores. Both speak the same SSE protocol.
    if (provider !== 'raw' && provider !== 'lmstudio') {
        const attempts = ['/chat-tools', '/think-stream'];
        for (const corePath of attempts) {
            if (sentAny) break;
            try {
                const r = await fetch(`${HEIDI_CORE_URL}${corePath}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: message, options: model ? { model } : {} }),
                    signal: AbortSignal.timeout(180000)
                });
                if (!r.ok || !r.body) continue;
                const reader = r.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                let meta = null;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const events = buf.split('\n\n');
                    buf = events.pop();
                    for (const ev of events) {
                        const line = ev.split('\n').find(l => l.startsWith('data: '));
                        if (!line) continue;
                        try {
                            const d = JSON.parse(line.slice(6));
                            if (d.t && d.model !== 'fallback') send({ t: d.t });
                            if (d.done) meta = d;
                        } catch {}
                    }
                }
                if (sentAny && meta && meta.model !== 'fallback') {
                    return finish({
                        provider: `heidi-core`,
                        model: meta.model,
                        confidence: meta.confidence,
                        tools_used: meta.tools_used
                    });
                }
            } catch (e) {
                console.log(`[Chat] Heidi Core ${corePath} unavailable:`, e.message);
            }
        }
        if (sentAny) return finish({ provider: 'heidi-core' });
    }

    // 2) Raw Ollama
    if (provider !== 'lmstudio') {
        try {
            await streamOllama(message, selectedModel, systemPrompt, send);
            return finish({ provider: 'ollama' });
        } catch (e) {
            console.log('[Chat] Ollama unavailable:', e.message);
        }
    }

    // 3) LM Studio
    try {
        await streamLMStudio(message, selectedModel, systemPrompt, send);
        return finish({ provider: 'lmstudio' });
    } catch (e) {
        console.log('[Chat] LM Studio unavailable:', e.message);
    }

    // 4) Typed fallback — but NEVER splice it into a partially-streamed
    // reply (that caused garbled messages in the UI). If tokens already
    // went out, just close cleanly with an error flag.
    if (sentAny) {
        return finish({ provider: 'interrupted', error: 'model stream dropped mid-response' });
    }
    const fallback = buildFallback(message);
    for (const char of fallback) {
        send({ t: char });
        await new Promise(r => setTimeout(r, 12));
    }
    finish({ provider: 'fallback' });
});

async function streamOllama(message, model, systemPrompt, send) {
    try {
        const prompt = `${systemPrompt}\n\nUser: ${message}\n\nHeidi:`;
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: true,
                options: { temperature: 0.7, num_predict: 600 }
            }),
            signal: AbortSignal.timeout(90000)
        });

        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (data.response) send({ t: data.response });
                    if (data.done) return;
                } catch {}
            }
        }
    } catch (e) {
        throw e;
    }
}

async function streamLMStudio(message, model, systemPrompt, send) {
    const response = await fetch(`${LM_STUDIO_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.7,
            max_tokens: 600,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ]
        }),
        signal: AbortSignal.timeout(90000)
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

// Optional TLS for Tailscale/HTTPS clients (e.g. the GitHub Pages mobile
// chat, which browsers block from fetch()-ing a plain http:// API from an
// https:// page). Generate with `tailscale cert <your-machine>.<tailnet>.ts.net`
// and point these at the resulting files; falls back to plain HTTP for LAN use.
const TLS_CERT = process.env.HEIDI_TLS_CERT;
const TLS_KEY = process.env.HEIDI_TLS_KEY;
const useTLS = Boolean(TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY));
const protocol = useTLS ? 'https' : 'http';

const server = useTLS
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, app)
    : http.createServer(app);
const lanIP = getLANIP();

server.listen(PORT, '0.0.0.0', async () => {
    const portStr = PORT.toString();
    const ipLine = `${protocol}://${lanIP}:${portStr}`;
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       🧠  HEIDI — Local Mobile Chat          ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Desktop:  ${protocol}://localhost:${portStr}${' '.repeat(Math.max(0, 12 - portStr.length))}║`);
    console.log(`║  📱 Phone: ${ipLine}${' '.repeat(Math.max(0, 34 - ipLine.length))}║`);
    if (useTLS) {
        console.log(`║  🔒 TLS active (${TLS_CERT})${' '.repeat(Math.max(0, 10 - TLS_CERT.length))}║`);
    }
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Open the Phone URL on your mobile device    ║');
    console.log('║  (must be on the same WiFi / LAN network)    ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const { models = [] } = await r.json();
            if (models.length > 0) {
                console.log(`✅ Ollama: ${models.map(m => m.name).join(', ')}`);
            } else {
                console.log('⚠️  Ollama is running but has no models.');
                console.log('   Pull one: ollama pull llama3');
            }
        }
    } catch {
        console.log('⚠️  Ollama not found at', OLLAMA_URL);
        console.log('   Install: https://ollama.ai  →  ollama pull llama3');
    }

    try {
        const r = await fetch(`${LM_STUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) console.log(`✅ LM Studio online at ${LM_STUDIO_URL}`);
    } catch {
        console.log('ℹ️  LM Studio not found (optional alternative to Ollama)');
    }

    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Heidi...');
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('\n⏹️  SIGTERM received, shutting down...');
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (e) => {
    console.error('[FATAL] Uncaught exception:', e.message);
    console.error(e.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled promise rejection:', reason);
    console.error('Promise:', promise);
    // Exit after logging to allow supervisor to restart
    setTimeout(() => process.exit(1), 1000);
});
