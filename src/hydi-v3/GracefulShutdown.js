'use strict';

const { EventEmitter } = require('events');

/**
 * GracefulShutdown intercepts SIGINT, SIGTERM, and uncaught errors, flushes
 * in-flight state, persists memory and checkpoints, then exits.
 *
 * It is idempotent and safe to call multiple times.
 */
class GracefulShutdown extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      exitCode: config.exitCode ?? 0,
      flushTimeoutMs: config.flushTimeoutMs || 5000,
      ...config,
    };

    this.handlers = [];
    this.installed = false;
    this.shuttingDown = false;
    this._destroyed = false;

    this._boundOnSignal = this.onSignal.bind(this);
    this._boundOnException = this.onException.bind(this);
    this._boundOnRejection = this.onRejection.bind(this);
  }

  /**
   * Register a callback to run during graceful shutdown.
   * Callbacks are run in order. Each may return a Promise.
   */
  addHandler(handler, priority = 0) {
    if (this._destroyed) return;
    this.handlers.push({ handler, priority });
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  removeHandler(handler) {
    this.handlers = this.handlers.filter((h) => h.handler !== handler);
  }

  install() {
    if (this.installed || this._destroyed) return;
    this.installed = true;

    process.on('SIGINT', this._boundOnSignal);
    process.on('SIGTERM', this._boundOnSignal);
    process.on('uncaughtException', this._boundOnException);
    process.on('unhandledRejection', this._boundOnRejection);
  }

  uninstall() {
    if (!this.installed) return;
    this.installed = false;

    process.off('SIGINT', this._boundOnSignal);
    process.off('SIGTERM', this._boundOnSignal);
    process.off('uncaughtException', this._boundOnException);
    process.off('unhandledRejection', this._boundOnRejection);
  }

  async shutdown(exitCode = this.config.exitCode, reason = 'manual') {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.emit('shutdown_started', { reason, exitCode });

    const start = Date.now();
    try {
      for (const { handler } of this.handlers) {
        try {
          await Promise.race([
            Promise.resolve(handler(reason, exitCode)),
            new Promise((_, reject) => setTimeout(() => reject(new Error('flush_timeout')), this.config.flushTimeoutMs)),
          ]);
        } catch (err) {
          this.emit('handler_failed', { handler, error: err.message });
        }
      }
    } catch (err) {
      this.emit('shutdown_error', err);
    } finally {
      const elapsed = Date.now() - start;
      this.emit('shutdown_completed', { reason, exitCode, elapsed });
    }

    if (this.installed && exitCode !== undefined) {
      process.exit(exitCode);
    }
  }

  onSignal(signal) {
    this.emit('signal_received', { signal });
    this.shutdown(this.config.exitCode, `signal:${signal}`);
  }

  onException(error) {
    this.emit('uncaught_exception', error);
    this.shutdown(1, `uncaught_exception:${error.message || 'unknown'}`);
  }

  onRejection(reason, promise) {
    this.emit('unhandled_rejection', { reason, promise });
    this.shutdown(1, `unhandled_rejection:${reason?.message || reason || 'unknown'}`);
  }

  destroy() {
    this._destroyed = true;
    this.uninstall();
    this.handlers = [];
  }
}

module.exports = GracefulShutdown;
