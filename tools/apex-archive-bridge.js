#!/usr/bin/env node
'use strict';

/**
 * Apex Archive → HYDI one-way bridge.
 *
 * This is a manual / scheduled CLI, not a daemon. It reads the local
 * Apex Archive `hydi_outbox/` JSON files and records each event through the
 * Heidi control plane as an APEX_* task.
 *
 * It does NOT write to the outbox and does NOT reach into the Apex archive
 * internal state. It only observes events already emitted.
 */

const fs = require('fs');
const path = require('path');

const APEX_DIR = process.env.APEX_ARCHIVE_DIR
  || 'C:\\Users\\Owner\\OneDrive\\Documents\\Claude\\Scheduled\\apex-archive-weekly-episode';
const OUTBOX_DIR = path.join(APEX_DIR, 'hydi_outbox');
const PROCESSED_DIR = path.join(OUTBOX_DIR, '.processed');

const { HeidiController } = require('../pao-system/core/heidi.controller');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function classifyApexEvent(eventType) {
  const map = {
    project_status: 'APEX_EVENT_RECORDED',
    orchestration_ping: 'APEX_EVENT_RECORDED',
    episode_generated: 'APEX_EPISODE_CREATED',
    episode_verified: 'APEX_EVENT_RECORDED',
    approval_event: 'APEX_EPISODE_APPROVED',
    publication_event: 'APEX_EPISODE_PUBLISHED',
    analytics_event: 'APEX_EPISODE_ARCHIVED',
    failure_event: 'APEX_EPISODE_FAILED',
  };
  return map[eventType] || 'APEX_EVENT_RECORDED';
}

async function main() {
  if (!fs.existsSync(OUTBOX_DIR)) {
    console.log(`[apex-bridge] outbox not found: ${OUTBOX_DIR}`);
    process.exit(0);
  }

  ensureDir(PROCESSED_DIR);

  const files = fs.readdirSync(OUTBOX_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log('[apex-bridge] no events to ingest');
    process.exit(0);
  }

  const controller = new HeidiController();
  const results = [];

  for (const f of files) {
    const full = path.join(OUTBOX_DIR, f);
    if (fs.lstatSync(full).isDirectory()) continue;

    const raw = fs.readFileSync(full, 'utf8');
    let event;
    try {
      event = JSON.parse(raw);
    } catch (e) {
      results.push({ file: f, ok: false, reason: 'invalid_json' });
      continue;
    }

    const taskType = classifyApexEvent(event.event_type);
    const input = {
      venture_id: event.project_id || 'apex-archive',
      rezonate_project_id: 'unmapped', // set externally if known
      event,
    };

    try {
      const result = await controller.processUserEvent(taskType, input, 'owner');
      results.push({ file: f, ok: result.ok, reason: result.reason });
      if (result.ok) {
        const processed = path.join(PROCESSED_DIR, f);
        fs.renameSync(full, processed);
      }
    } catch (e) {
      results.push({ file: f, ok: false, reason: e.message });
    }
  }

  console.log(JSON.stringify({
    source: OUTBOX_DIR,
    processed: results,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

main().catch((e) => {
  console.error('[apex-bridge] fatal:', e);
  process.exit(1);
});
