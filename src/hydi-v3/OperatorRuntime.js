'use strict';

const readline = require('readline');

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;
const MAX_HISTORY = 100;

/**
 * OperatorRuntime owns the CLI's terminal lifecycle: the readline loop, the
 * serialised command queue, history wiring, signal handling, and graceful
 * shutdown.
 *
 * It lives in src/ rather than scripts/ so all of this is unit-testable with
 * injected streams — scripts/operator-cli.js is a thin argv-parsing wrapper.
 *
 * Shutdown contract, in order:
 *   1. stop accepting new input
 *   2. let the in-flight command finish (bounded by shutdownTimeoutMs)
 *   3. persist command history into SessionMemory
 *   4. flush every store, then destroy the session
 *   5. exit — 0 on a clean drain, 1 if the drain timed out or errored
 *
 * A second interrupt during shutdown exits immediately with 130, matching
 * conventional SIGINT behaviour, so a wedged flush can never trap the operator.
 */
class OperatorRuntime {
  constructor(config = {}) {
    if (!config.session) throw new Error('OperatorRuntime requires a session');
    if (!config.cli) throw new Error('OperatorRuntime requires a cli');

    this.session = config.session;
    this.cli = config.cli;
    this.mode = config.mode || null;
    this.input = config.input || process.stdin;
    this.output = config.output || process.stdout;
    this.prompt = config.prompt || 'cockpit> ';
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.maxHistory = config.maxHistory ?? MAX_HISTORY;
    this.historyEnabled = config.history !== false;
    this.write = config.write || ((line) => this.output.write(`${line}\n`));
    this.onExit = config.onExit || ((code) => process.exit(code));
    this.installSignalHandlers = config.installSignalHandlers !== false;

    this.rl = null;
    this.queue = Promise.resolve();
    this.history = [];

    this._closing = false;
    this._shutdownComplete = null;
    this._interruptCount = 0;
    this._signalHandlers = [];
  }

  /**
   * Seed readline history from SessionMemory so arrow-key recall survives a
   * restart. Readline expects newest-first; SessionMemory stores oldest-first.
   */
  loadHistory() {
    const sessionMemory = this.session.sessionMemory;
    if (!this.historyEnabled) return [];
    if (!sessionMemory || typeof sessionMemory.getRecentCommands !== 'function') return [];
    const commands = sessionMemory.getRecentCommands(this.maxHistory) || [];
    this.history = commands
      .map((entry) => (typeof entry === 'string' ? entry : entry.text))
      .filter((text) => typeof text === 'string' && text.trim() !== '')
      .reverse();
    return this.history;
  }

  /**
   * Persist the session's readline history back into SessionMemory.
   *
   * ConversationEngine.recordCommand() already captures commands it routes,
   * but readline history also contains lines the engine never saw (CLI-local
   * intents like `exit`, and anything typed while a previous command was still
   * running). Recording only what is missing keeps recall complete without
   * duplicating entries.
   */
  saveHistory() {
    const sessionMemory = this.session.sessionMemory;
    if (!this.historyEnabled) return 0;
    if (!sessionMemory || typeof sessionMemory.recordCommand !== 'function') return 0;

    const known = new Set(
      (typeof sessionMemory.getRecentCommands === 'function'
        ? sessionMemory.getRecentCommands(this.maxHistory)
        : []
      ).map((entry) => (typeof entry === 'string' ? entry : entry.text)),
    );

    let recorded = 0;
    for (const line of this._typed || []) {
      if (!known.has(line)) {
        sessionMemory.recordCommand(line);
        known.add(line);
        recorded++;
      }
    }
    return recorded;
  }

  start() {
    this._typed = [];
    this.loadHistory();

    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
      prompt: this.prompt,
      history: this.history.slice(0, this.maxHistory),
      historySize: this.maxHistory,
      removeHistoryDuplicates: true,
      terminal: this.input.isTTY === true,
    });

    this.rl.on('line', (line) => this._enqueue(line));
    this.rl.on('close', () => {
      this._closing = true;
      this._shutdownComplete = this.queue.then(
        () => this.shutdown(0),
        () => this.shutdown(1),
      );
    });

    if (this.installSignalHandlers) this._installSignals();

    this.rl.prompt();
    return this;
  }

  _enqueue(line) {
    // Line events are serialised through a promise chain. Without this, piped
    // or pasted input would interleave responses and could run "exit" before
    // earlier commands finished.
    this.queue = this.queue.then(async () => {
      if (this._closing) return;
      const text = String(line);
      if (text.trim() !== '') this._typed.push(text);

      const result = await this.cli.handle(text);
      if (result.output) {
        this.write('');
        this.write(result.output);
        this.write('');
      }
      if (result.done) {
        this._closing = true;
        this.rl.close();
        return;
      }
      this.rl.prompt();
    });
    return this.queue;
  }

  _installSignals() {
    const onInterrupt = () => {
      this._interruptCount++;
      if (this._interruptCount > 1) {
        this.write('');
        this.write('Second interrupt — exiting immediately.');
        this.onExit(130);
        return;
      }
      this.write('');
      this.write('Interrupt received — finishing current command, then shutting down.');
      this._closing = true;
      this.rl.close();
    };

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, onInterrupt);
      this._signalHandlers.push([signal, onInterrupt]);
    }
  }

  _removeSignals() {
    for (const [signal, handler] of this._signalHandlers) {
      process.removeListener(signal, handler);
    }
    this._signalHandlers = [];
  }

  /**
   * Drain, persist, flush, destroy. Never throws — a shutdown that cannot
   * complete cleanly reports a non-zero code rather than hanging or crashing.
   */
  async shutdown(code = 0) {
    this._closing = true;
    this._removeSignals();

    let exitCode = code;

    try {
      await this._withTimeout(this.queue, 'in-flight command');
    } catch (error) {
      this.write(`Shutdown warning: ${this._message(error)}`);
      exitCode = 1;
    }

    try {
      this.saveHistory();
    } catch (error) {
      this.write(`Shutdown warning: could not save history — ${this._message(error)}`);
      exitCode = 1;
    }

    if (this.mode && this.mode.dryRun) {
      const summary = this.mode.summary();
      if (summary) {
        this.write('');
        this.write(summary);
      }
    }

    try {
      await this._withTimeout(this.session.shutdown(), 'session shutdown');
    } catch (error) {
      this.write(`Shutdown warning: ${this._message(error)}`);
      exitCode = 1;
    }

    this.onExit(exitCode);
    return exitCode;
  }

  _withTimeout(promise, label) {
    if (!promise) return Promise.resolve();
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} did not finish within ${this.shutdownTimeoutMs}ms`)),
        this.shutdownTimeoutMs,
      );
      // Deliberately NOT unref'd. This timer is the only thing guaranteeing
      // shutdown terminates; unref'ing it would let Node exit silently — with
      // status 0 and no warning — the moment a stalled command was the last
      // thing holding the event loop open, which is precisely the case the
      // timeout exists to report.
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  _message(error) {
    return error instanceof Error ? error.message : String(error);
  }
}

module.exports = OperatorRuntime;
module.exports.DEFAULT_SHUTDOWN_TIMEOUT_MS = DEFAULT_SHUTDOWN_TIMEOUT_MS;
module.exports.MAX_HISTORY = MAX_HISTORY;
