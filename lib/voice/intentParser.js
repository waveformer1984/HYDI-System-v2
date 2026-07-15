'use strict';

/**
 * Phase 5 — server-side half of the voice pipeline:
 *
 *   mobile microphone -> speech recognition (client, Web Speech API) ->
 *   HYDI interpreter (this file) -> intent validation (RBAC permission
 *   check, done by the caller using the `permission` this returns) ->
 *   command queue (api/voice/command.js inserts into
 *   agent_control_commands / actions, same as any other authenticated
 *   caller) -> worker execution (workers/WorkerOrchestrator.js, unchanged).
 *
 * "Never bypass authorization": this module only classifies text into an
 * intent + the permission it requires. It never executes anything itself
 * — api/voice/command.js still runs the transcript's resolved intent
 * through the exact same requireAuth()/RBAC gate as every other
 * mobile-ops route before queuing a command.
 */

const WAKE_WORD = /^(hey\s+)?hydi[,]?\s+/i;

const INTENTS = [
  { name: 'status_report', match: /status\s+report/i, permission: 'status:view', queues: false },
  { name: 'check_workers', match: /check\s+workers?/i, permission: 'worker:view', queues: false },
  { name: 'summarize_activity', match: /summarize\s+activity/i, permission: 'status:view', queues: false },
  { name: 'prepare_report', match: /prepare\s+report/i, permission: 'status:view', queues: 'action' },
  { name: 'restart_service', match: /restart\s+(?:the\s+)?(?:service\s+)?(\w[\w-]*)/i, permission: 'worker:control', queues: 'command', command: 'restart' },
  { name: 'start_worker', match: /start\s+(\w[\w-]*)/i, permission: 'worker:control', queues: 'command', command: 'start' },
];

/**
 * @param {string} transcript  raw speech-to-text output from the client
 * @returns {{valid: true, intent: string, permission: string, queues: false|'action'|'command', command?: string, target?: string, transcript: string}
 *          | {valid: false, reason: string}}
 */
function parseIntent(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return { valid: false, reason: 'empty transcript' };
  }

  const trimmed = transcript.trim();
  if (!WAKE_WORD.test(trimmed)) {
    return { valid: false, reason: "missing wake word ('HYDI ...')" };
  }

  const body = trimmed.replace(WAKE_WORD, '');

  for (const intent of INTENTS) {
    const match = body.match(intent.match);
    if (match) {
      return {
        valid: true,
        intent: intent.name,
        permission: intent.permission,
        queues: intent.queues,
        command: intent.command,
        target: match[1] || null,
        transcript: trimmed,
      };
    }
  }

  return { valid: false, reason: 'unrecognized command' };
}

module.exports = { parseIntent, INTENTS, WAKE_WORD };
