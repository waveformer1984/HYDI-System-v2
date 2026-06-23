#!/usr/bin/env node
/**
 * Protohub — HYDI Task Coordinator
 * Distributed task routing, orchestration, and persistence
 *
 * Endpoints:
 *   POST /api/tasks — submit a task for distributed execution
 *   GET  /api/tasks/:id — get task status and results
 *   GET  /api/health — health check
 *   GET  /api/registry — list available workers
 */

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PROTOHUB_PORT || 4000;
const CHAT_SERVER_URL = process.env.CHAT_SERVER_URL || 'http://localhost:3006';

let supabase = null;
const workers = new Map(); // workerId → worker metadata

// ── INITIALIZATION ──────────────────────────────────────────────────────────

async function initialize() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.log('⚠️  Supabase not configured — running in standalone mode');
        return;
    }

    try {
        supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
        console.log('✅ Supabase: connected');
    } catch (e) {
        console.log('⚠️  Supabase: disabled —', e.message);
    }
}

// ── EXPRESS APP ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS for chat server
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── ROUTES ──────────────────────────────────────────────────────────────────

/**
 * POST /api/tasks
 * Submit a task for distributed execution
 *
 * Request:
 *   {
 *     "worker_type": "anomaly_detection" | "opportunity_detection" | "inventory",
 *     "operation": "analyze",
 *     "payload": { ... },
 *     "priority": "normal" | "high"
 *   }
 *
 * Response:
 *   { "task_id": "uuid", "status": "queued" }
 */
app.post('/api/tasks', async (req, res) => {
    try {
        const { worker_type, operation, payload, priority = 'normal' } = req.body;

        if (!worker_type || !operation) {
            return res.status(400).json({ error: 'worker_type and operation required' });
        }

        const taskId = uuidv4();
        const task = {
            id: taskId,
            worker_type,
            operation,
            payload,
            priority,
            status: 'queued',
            created_at: new Date().toISOString(),
            assigned_worker: null,
            result: null,
            error: null
        };

        // Persist task to Supabase if available
        if (supabase) {
            try {
                const { error } = await supabase.from('hydi_tasks').insert(task);
                if (error) throw error;
            } catch (e) {
                console.warn('⚠️  Failed to persist task:', e.message);
            }
        }

        // Route task to appropriate worker
        routeTask(task);

        res.json({ task_id: taskId, status: 'queued' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/tasks/:id
 * Get task status and results
 */
app.get('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!supabase) {
            return res.status(503).json({ error: 'Supabase not available' });
        }

        const { data, error } = await supabase
            .from('hydi_tasks')
            .select('*')
            .eq('id', id)
            .single();

        if (error) return res.status(404).json({ error: 'Task not found' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        workers_registered: workers.size,
        supabase: supabase ? 'connected' : 'offline',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/registry
 * List available workers
 */
app.get('/api/registry', (req, res) => {
    const registry = Array.from(workers.values());
    res.json({
        total_workers: registry.length,
        workers: registry
    });
});

/**
 * POST /api/workers/register
 * Worker registers itself
 *
 * Request: { "worker_id": "anomaly_detection-1", "operations": [...] }
 */
app.post('/api/workers/register', (req, res) => {
    try {
        const { worker_id, operations, capabilities } = req.body;

        if (!worker_id) {
            return res.status(400).json({ error: 'worker_id required' });
        }

        workers.set(worker_id, {
            id: worker_id,
            operations: operations || [],
            capabilities,
            registered_at: new Date().toISOString(),
            status: 'active'
        });

        console.log(`✅ Worker registered: ${worker_id}`);
        res.json({ success: true, message: `Worker ${worker_id} registered` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/tasks/:id/result
 * Worker reports task completion
 *
 * Request: { "result": {...}, "status": "success" | "failed", "error": "..." }
 */
app.post('/api/tasks/:id/result', async (req, res) => {
    try {
        const { id } = req.params;
        const { result, status, error } = req.body;

        if (!supabase) {
            return res.status(503).json({ error: 'Supabase not available' });
        }

        const update = {
            status: status || 'completed',
            result: result || null,
            error: error || null,
            completed_at: new Date().toISOString()
        };

        const { error: updateError } = await supabase
            .from('hydi_tasks')
            .update(update)
            .eq('id', id);

        if (updateError) throw updateError;

        // Notify chat server of completion
        notifyChatServer({ task_id: id, status: status || 'completed' });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── TASK ROUTING ────────────────────────────────────────────────────────────

/**
 * Route a task to the appropriate worker via WorkerOrchestrator
 */
async function routeTask(task) {
    try {
        // POST to chat server's /api/system/action endpoint
        // which will route to WorkerOrchestrator via event bus
        const response = await fetch(`${CHAT_SERVER_URL}/api/system/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'hydi_task',
                source: 'protohub',
                payload: {
                    task_id: task.id,
                    worker_type: task.worker_type,
                    operation: task.operation,
                    payload: task.payload
                }
            })
        });

        if (!response.ok) {
            console.warn(`⚠️  Failed to route task ${task.id}: HTTP ${response.status}`);
        }
    } catch (e) {
        console.warn(`⚠️  Failed to route task ${task.id}:`, e.message);
    }
}

/**
 * Notify chat server of task completion
 */
async function notifyChatServer(event) {
    try {
        await fetch(`${CHAT_SERVER_URL}/api/events/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'hydi_task_complete',
                title: `Task ${event.task_id} completed`,
                body: `Status: ${event.status}`,
                level: 'info',
                payload: event
            })
        });
    } catch (e) {
        console.warn('⚠️  Failed to notify chat server:', e.message);
    }
}

// ── SERVER STARTUP ──────────────────────────────────────────────────────────

async function start() {
    await initialize();

    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n╬════════════════════════════════════════╗');
        console.log('║         PROTOHUB — HYDI Coordinator    ║');
        console.log('╠════════════════════════════════════════╣');
        console.log(`║  http://localhost:${PORT}${' '.repeat(22 - PORT.toString().length)}║`);
        console.log('╚════════════════════════════════════════╝\n');
        console.log('Endpoints:');
        console.log('  POST /api/tasks           — submit task');
        console.log('  GET  /api/tasks/:id       — get task status');
        console.log('  GET  /api/health          — health check');
        console.log('  GET  /api/registry        — list workers');
        console.log('  POST /api/workers/register — worker registration\n');
    });
}

process.on('SIGINT', () => {
    console.log('\nProtohub shutting down...');
    process.exit(0);
});

start().catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
});

module.exports = app;
