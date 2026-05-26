#!/usr/bin/env node
/**
 * Heidi Local Mobile Chat Server
 * Streams from Ollama/LM Studio — open on mobile via LAN URL printed at startup
 *
 * Setup:
 *   1. npm install
 *   2. Install Ollama: https://ollama.ai
 *   3. ollama pull llama3
 *   4. node launch-heidi-mobile.js   (or: npm run mobile)
 *   5. Open the phone URL shown in the console on your mobile device (same WiFi)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.HEIDI_PORT || '3006');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const DEFAULT_MODEL = process.env.LOCAL_MODEL_NAME || 'llama3';

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
    const status = { server: 'ok', ollama: false, lmstudio: false, models: [] };

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

// SSE streaming chat — accepts optional history[] for multi-turn context
app.post('/api/chat', async (req, res) => {
    const { message, model, provider, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const finish = (meta = {}) => { send({ done: true, ...meta }); res.end(); };

    const systemPrompt = buildSystemPrompt();
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

    // Typed fallback
    const fallback = buildFallback(message);
    for (const char of fallback) {
        send({ t: char });
        await new Promise(r => setTimeout(r, 12));
    }
    finish({ provider: 'fallback' });
});

async function streamOllama(message, model, systemPrompt, history, send) {
    // Use /api/chat for multi-turn message support
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
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
                if (data.message?.content) send({ t: data.message.content });
                if (data.done) return;
            } catch {}
        }
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
        body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.7,
            max_tokens: 600,
            messages
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
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (e) => { console.error('Fatal:', e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('Unhandled rejection:', e); });
