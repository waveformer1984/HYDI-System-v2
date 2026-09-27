'use strict';
/**
 * protoforge-core process guard — last-resort async error boundary.
 *
 * Observed 2026-09-27: protoforge-core exited code 1 silently during a
 * model-flatline window (stderr was likely lost through PM2's
 * ERR_STREAM_DESTROYED log pipe). The mission boundary: a failed model
 * request must never kill the control plane.
 *
 * Contract:
 *   unhandledRejection → LOUD log + counter, process STAYS ALIVE.
 *     A rejected promise is a bug, not proof of fatal state — in a
 *     long-running supervisor the right response is telemetry, not
 *     process death. Node's default (exit 1) conflates "a promise in
 *     the model path failed" with "the process is dead".
 *   uncaughtException → LOUD log + exit(1). Genuinely fatal stays
 *     fatal — this handler only makes it observable, not survivable.
 *   >maxRejectionsPerMinute → the process is in an error storm (state
 *     itself is unsafe) → exit(1). A flood of rejections IS fatal.
 *
 * Install once, at the top of the entry point, before anything that
 * can reject.
 */

function installProcessGuard(options = {}) {
  const log = options.log || ((line) => console.error(line));
  const exit = options.exit || ((code) => process.exit(code));
  const now = options.now || (() => Date.now());
  const maxRejectionsPerMinute = options.maxRejectionsPerMinute ?? 30;

  const rejectionTimes = [];

  const onUnhandledRejection = (reason) => {
    const t = now();
    rejectionTimes.push(t);
    while (rejectionTimes.length && t - rejectionTimes[0] > 60_000) rejectionTimes.shift();

    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    log(`[PROCESS-GUARD] unhandledRejection (kept alive, ${rejectionTimes.length}/min): ${String(msg).slice(0, 500)}`);

    if (rejectionTimes.length > maxRejectionsPerMinute) {
      log(`[PROCESS-GUARD] rejection storm (${rejectionTimes.length}/min > ${maxRejectionsPerMinute}) — state unsafe, exiting`);
      exit(1);
    }
  };

  const onUncaughtException = (err) => {
    const msg = err && (err.stack || err.message) ? (err.stack || err.message) : String(err);
    log(`[PROCESS-GUARD] uncaughtException (fatal): ${String(msg).slice(0, 1000)}`);
    exit(1);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return {
    uninstall() {
      process.off('unhandledRejection', onUnhandledRejection);
      process.off('uncaughtException', onUncaughtException);
    },
    // Test seam
    _onUnhandledRejection: onUnhandledRejection,
    _onUncaughtException: onUncaughtException,
    _rejectionTimes: rejectionTimes,
  };
}

module.exports = { installProcessGuard };
