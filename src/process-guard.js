'use strict';
/**
 * protoforge-core process guard + exit forensics — last-resort async error
 * boundary and termination-attribution recorder.
 *
 * Observed 2026-09-27: protoforge-core exited code 1 silently during a
 * model-flatline window (stderr was likely lost through PM2's
 * ERR_STREAM_DESTROYED log pipe), and later through windows of host-wide
 * stalls. The mission boundary: a failed model request must never kill the
 * control plane, and a process exit must never again be unexplainable.
 *
 * Contract:
 *   unhandledRejection → LOUD log + durable record + counter, process
 *     STAYS ALIVE. A rejected promise is a bug, not proof of fatal state.
 *   uncaughtException → LOUD log + durable record + exit(1). Genuinely
 *     fatal stays fatal — observable, not survivable.
 *   >maxRejectionsPerMinute → error storm (state unsafe) → durable record
 *     classified 'rejection-storm', then exit(1).
 *   SIGINT/SIGTERM/SIGBREAK → durable record with the signal, then the
 *     conventional exit code is honored (external termination is recorded,
 *     not absorbed).
 *   process 'exit' → durable record with the real exit code. Fires for
 *     process.exit() and natural exit; does NOT fire for taskkill /F or
 *     SIGKILL — which is precisely what makes it evidence: an exit with
 *     no record is itself classified externally.
 *   heartbeat → .hydi-operational/protoforge-heartbeat.json rewritten on
 *     an interval with pid/ppid/uptime/rejections/state. A stalled
 *     heartbeat with no exit record proves external termination (OS kill,
 *     taskkill /F, power) -- the last line of evidence when every log
 *     pipe is compromised.
 *
 * The forensic file is append-only JSONL -- sync writes are required
 * because the 'exit' event does not accept async work.
 *
 * No secrets, env values, prompts, or model content are ever written.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGBREAK: 149 };

/**
 * A durable identifier for THIS process incarnation. PID alone is not
 * sufficient -- Windows reuses PIDs, so a forensic record naming only a
 * PID could be confused with a later process wearing the same number.
 * Format: <service>-<startupIsoTs>-pid<pid>-<random4hex>.
 */
function makeProcessInstanceId(service, now) {
  const ts = new Date(now()).toISOString().replace(/[:.]/g, '-');
  return `${service}-${ts}-pid${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

function installProcessGuard(options = {}) {
  const log = options.log || ((line) => console.error(line));
  const exit = options.exit || ((code) => process.exit(code));
  const now = options.now || (() => Date.now());
  const maxRejectionsPerMinute = options.maxRejectionsPerMinute ?? 30;
  const service = options.service || 'protoforge-core';
  const forensicDir = options.forensicDir || path.resolve(process.cwd(), '.hydi-operational');
  const forensicFile = options.forensicFile || path.join(forensicDir, 'protoforge-exit-forensics.jsonl');
  const heartbeatFile = options.heartbeatFile || path.join(forensicDir, 'protoforge-heartbeat.json');
  const heartbeatMs = options.heartbeatMs === undefined ? 15000 : options.heartbeatMs;
  const stateProvider = options.stateProvider || (() => ({}));
  const processInstanceId = options.processInstanceId || makeProcessInstanceId(service, now);

  const rejectionTimes = [];
  // Sticky context flag: once modelState reports failedModels > 0 we record
  // flatlineObserved=true on subsequent events. This is CONTEXT ONLY --
  // temporal correlation is not causation, and no record may assert
  // causalRelationship !== 'UNKNOWN' from this flag alone.
  let flatlineObserved = false;
  let record;

  try {
    if (!fs.existsSync(forensicDir)) fs.mkdirSync(forensicDir, { recursive: true });
    record = (entry) => {
      try {
        fs.appendFileSync(forensicFile, JSON.stringify({
          ts: new Date(now()).toISOString(),
          service,
          processInstanceId,
          pid: process.pid,
          ppid: process.ppid,
          flatlineObserved,
          ...entry,
        }) + '\n');
      } catch (e) {
        log(`[PROCESS-GUARD] forensic write failed: ${e.message}`);
      }
    };
  } catch (e) {
    // No filesystem access -> stderr is the only record. Still functional.
    record = () => { };
  }

  function safeState() {
    try {
      const s = stateProvider() || {};
      // Sticky: a flatline seen once stays visible as context on later
      // records even if models recover before the exit/termination.
      if (typeof s.failedModels === 'number' && s.failedModels > 0) flatlineObserved = true;
      return s;
    } catch (e) { return { error: 'stateProvider threw' }; }
  }

  record({ event: 'guard-installed', modelState: safeState() });
  log(`[PROCESS-GUARD] installed ${processInstanceId} (pid ${process.pid})`);

  const onUnhandledRejection = (reason) => {
    const t = now();
    rejectionTimes.push(t);
    while (rejectionTimes.length && t - rejectionTimes[0] > 60_000) rejectionTimes.shift();

    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    const line = `[PROCESS-GUARD] unhandledRejection (kept alive, ${rejectionTimes.length}/min): ${String(msg).slice(0, 500)}`;
    log(line);
    record({ event: 'unhandledRejection', detail: String(msg).slice(0, 500), rejectionsPerMin: rejectionTimes.length });

    if (rejectionTimes.length > maxRejectionsPerMinute) {
      const storm = `rejection storm (${rejectionTimes.length}/min > ${maxRejectionsPerMinute})`;
      log(`[PROCESS-GUARD] ${storm} — state unsafe, exiting`);
      record({ event: 'rejection-storm', classification: 'APPLICATION_EXIT', detail: storm });
      exit(1);
    }
  };

  const onUncaughtException = (err) => {
    const msg = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
    log(`[PROCESS-GUARD] uncaughtException (fatal): ${String(msg).slice(0, 1000)}`);
    record({ event: 'uncaughtException', classification: 'APPLICATION_EXIT', detail: String(msg).slice(0, 1000) });
    exit(1);
  };

  // Signal capture: record the signal, then honor the conventional exit
  // code. The handler replaces Node's default terminate-on-signal, so it
  // must exit itself -- but the record is written first, which is the
  // attribution this guard exists to preserve. On Windows, taskkill /F
  // delivers no signal at all, so 'exit' below remains the only record.
  const signalHandlers = {};
  for (const sig of Object.keys(SIGNAL_EXIT_CODES)) {
    signalHandlers[sig] = () => {
      record({
        event: 'signal-received',
        classification: 'EXTERNAL_TERMINATION',
        signal: sig,
        modelState: safeState(),
      });
      log(`[PROCESS-GUARD] ${sig} received -- external termination, exiting ${SIGNAL_EXIT_CODES[sig]}`);
      exit(SIGNAL_EXIT_CODES[sig]);
    };
    process.on(sig, signalHandlers[sig]);
  }

  // The only handler that cannot lie: 'exit' fires for process.exit() and
  // natural end-of-event-loop, never for taskkill /F or SIGKILL. A dead
  // process with no 'exit' record and a stalled heartbeat is therefore
  // evidence of forcible termination.
  const onExit = (code) => {
    record({
      event: 'process-exit',
      // 'exit' proves the runtime wound down in-process (exit() call or
      // natural end) -- for code != 0 that is an application-originated
      // exit. It NEVER proves which caller invoked exit(), so when a
      // flatline was observed the causal relationship stays UNKNOWN
      // context, not attribution.
      classification: code === 0 ? 'NORMAL_EXIT' : 'APPLICATION_EXIT',
      causalRelationship: 'UNKNOWN',
      exitCode: code,
      rejectionsPerMin: rejectionTimes.length,
      modelState: safeState(),
    });
  };
  process.on('exit', onExit);

  let heartbeatTimer = null;
  {
    const writeHeartbeat = () => {
      try {
        fs.writeFileSync(heartbeatFile, JSON.stringify({
          ts: new Date(now()).toISOString(),
          service,
          processInstanceId,
          pid: process.pid,
          ppid: process.ppid,
          uptimeSec: Math.floor(process.uptime()),
          rssBytes: process.memoryUsage().rss,
          rejectionsPerMin: rejectionTimes.length,
          flatlineObserved,
          modelState: safeState(),
        }));
      } catch (e) { /* heartbeat is best-effort */ }
    };
    writeHeartbeat();
    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(writeHeartbeat, heartbeatMs);
      heartbeatTimer.unref();
    }
  }

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return {
    uninstall() {
      process.off('unhandledRejection', onUnhandledRejection);
      process.off('uncaughtException', onUncaughtException);
      process.off('exit', onExit);
      for (const sig of Object.keys(signalHandlers)) process.off(sig, signalHandlers[sig]);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    },
    // Test seam
    _onUnhandledRejection: onUnhandledRejection,
    _onUncaughtException: onUncaughtException,
    _rejectionTimes: rejectionTimes,
    _record: record,
    _forensicFile: forensicFile,
    _heartbeatFile: heartbeatFile,
    _processInstanceId: processInstanceId,
  };
}

module.exports = { installProcessGuard, SIGNAL_EXIT_CODES };
