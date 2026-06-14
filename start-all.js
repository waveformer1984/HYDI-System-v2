#!/usr/bin/env node
/**
 * start-all.js — starts Heidi chat server + worker orchestrator together
 * Usage:  node start-all.js
 * Flags:  --no-workers   skip the worker orchestrator
 */

'use strict';

require('dotenv').config();

const { spawn } = require('child_process');
const path = require('path');

const skipWorkers = process.argv.includes('--no-workers');

function spawnService(label, scriptPath, env = {}) {
    const child = spawn('node', [scriptPath], {
        cwd: __dirname,
        env: { ...process.env, ...env },
        stdio: 'pipe'
    });

    const prefix = `[${label}]`;
    child.stdout.on('data', d => process.stdout.write(`${prefix} ${d}`));
    child.stderr.on('data', d => process.stderr.write(`${prefix} ${d}`));

    child.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM') {
            console.error(`${prefix} exited with code ${code} — restart manually`);
        }
    });

    return child;
}

const children = [];

// Start Heidi mobile server
children.push(spawnService('HEIDI', path.join(__dirname, 'launch-heidi-mobile.js')));

// Start worker orchestrator (optional)
if (!skipWorkers) {
    const workerScript = path.join(__dirname, 'workers', 'WorkerOrchestrator.js');
    try {
        require('fs').accessSync(workerScript);
        console.log('[start-all] Starting WorkerOrchestrator...');
        children.push(spawnService('WORKERS', workerScript));
    } catch {
        console.log('[start-all] WorkerOrchestrator not found — skipping');
    }
}

function shutdown() {
    console.log('\n[start-all] Shutting down all services...');
    for (const child of children) { child.kill('SIGTERM'); }
    setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

console.log('[start-all] Services started. Ctrl+C to stop all.');
