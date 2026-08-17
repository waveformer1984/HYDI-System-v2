/**
 * Structured Logging System
 *
 * JSON output for machine-readable logs.
 * Format: {timestamp, level, component, message, correlationId?, metadata...}
 *
 * Usage:
 *   const logger = require('./lib/structured-logger');
 *   logger.info('Service started', {component: 'heidi-core', port: 3458});
 *
 *   // Module-scoped logger (fixed component tag on every entry):
 *   const logger = require('../lib/structured-logger').child({ component: 'HeidiOrchestrator' });
 *   logger.warn('Task retry exhausted', { taskId });
 *
 *   // Correlation IDs (propagates through async calls automatically,
 *   // ties log lines from one request/event across every layer they touch —
 *   // see ROADMAP.md "Pipeline observability: structured trace IDs"):
 *   logger.withCorrelationId(logger.generateCorrelationId(), async () => {
 *     logger.info('Event ingested'); // correlationId attached automatically
 *     await processEvent();          // still attached inside nested async calls
 *   });
 *
 * Secret-shaped values (Stripe keys, Supabase/JWT service-role tokens, AWS
 * keys, PEM blocks) and any metadata key that looks like a credential
 * (password/secret/token/apiKey/authorization/...) are redacted before
 * anything is written to console or disk.
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

const LEVEL_NAMES = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'FATAL',
};

// Same secret-shaped patterns tests/unit/no-hardcoded-secrets.test.js scans
// the repo for, reused here so a secret that leaks into a log line at
// runtime is caught by the same definition of "secret-shaped" as the one
// that guards source control.
const SECRET_VALUE_PATTERNS = [
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /sk_live_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  /whsec_[A-Za-z0-9]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
];

// Metadata keys redacted by name regardless of value shape.
const SENSITIVE_KEY_RE = /(password|secret|token|api[_-]?key|authorization|service_role|private_key|credential)/i;

const REDACTED = '[REDACTED]';
const MAX_REDACT_DEPTH = 6;

function redactString(value) {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

function redactValue(value, depth = 0) {
  if (depth > MAX_REDACT_DEPTH) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

// Request/task-scoped correlation ID, propagated automatically through
// async/await call chains without threading a parameter through every
// function signature.
const correlationStorage = new AsyncLocalStorage();

function generateCorrelationId() {
  return crypto.randomUUID();
}

class StructuredLogger {
  constructor(options = {}) {
    this.component = options.component || 'app';
    this.bindings = options.bindings || {};
    this.level = options.level != null ? options.level : LOG_LEVELS.INFO;
    this.logFile = options.logFile || null;
    this.prettyPrint = options.prettyPrint !== false; // Default true in dev
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
  }

  /**
   * Return a child logger that stamps every entry with the given component
   * (overriding the parent's) and/or extra fixed bindings, while sharing
   * this logger's level/output configuration. Does not mutate the parent.
   */
  child(options = {}) {
    const child = new StructuredLogger({
      component: options.component || this.component,
      bindings: { ...this.bindings, ...(options.bindings || {}) },
      level: this.level,
      logFile: this.logFile,
      prettyPrint: this.prettyPrint,
      maxFileSize: this.maxFileSize,
    });
    return child;
  }

  /**
   * Run `fn` with `correlationId` attached to every log entry emitted
   * during its execution (including inside nested async calls). Returns
   * whatever `fn` returns/resolves to.
   */
  withCorrelationId(correlationId, fn) {
    return correlationStorage.run(correlationId, fn);
  }

  generateCorrelationId() {
    return generateCorrelationId();
  }

  /**
   * Write a log entry
   */
  log(levelNum, message, metadata = {}) {
    if (levelNum < this.level) return; // Skip if below threshold

    const correlationId = metadata.correlationId || correlationStorage.getStore();
    const safeMetadata = redactValue({ ...this.bindings, ...metadata });
    delete safeMetadata.correlationId;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[levelNum],
      component: this.component,
      message: redactString(String(message)),
      ...(correlationId ? { correlationId } : {}),
      ...safeMetadata,
    };

    // Console output
    this._consoleOutput(entry);

    // File output
    if (this.logFile) {
      this._fileOutput(entry);
    }
  }

  /**
   * Console output with color coding
   */
  _consoleOutput(entry) {
    const colors = {
      DEBUG: '\x1b[90m', // gray
      INFO: '\x1b[36m', // cyan
      WARN: '\x1b[33m', // yellow
      ERROR: '\x1b[31m', // red
      FATAL: '\x1b[35m', // magenta
      RESET: '\x1b[0m',
    };

    const color = colors[entry.level];
    const timestamp = entry.timestamp.split('T')[1].split('.')[0]; // HH:MM:SS
    const corr = entry.correlationId ? ` (${entry.correlationId.slice(0, 8)})` : '';
    const prefix = `${timestamp} [${entry.level}] ${entry.component}${corr}`;

    /* eslint-disable no-console -- this is the logging system's own sink */
    if (this.prettyPrint) {
      console.log(`${color}${prefix}${colors.RESET} ${entry.message}`);
      const meta = { ...entry };
      delete meta.timestamp;
      delete meta.level;
      delete meta.component;
      delete meta.message;
      delete meta.correlationId;
      if (Object.keys(meta).length > 0) {
        console.log(`  ${JSON.stringify(meta)}`);
      }
    } else {
      // JSON output
      console.log(JSON.stringify(entry));
    }
    /* eslint-enable no-console */
  }

  /**
   * File output (JSON lines format)
   */
  _fileOutput(entry) {
    try {
      // Check file size
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.maxFileSize) {
          this._rotateLogFile();
        }
      }

      // Append entry
      fs.appendFileSync(
        this.logFile,
        JSON.stringify(entry) + '\n',
        'utf8'
      );
    } catch (err) {
      /* eslint-disable-next-line no-console -- logging the logger's own I/O failure has nowhere else to go */
      console.error('Failed to write to log file:', err.message);
    }
  }

  /**
   * Rotate log file (rename to .1, .2, etc)
   */
  _rotateLogFile() {
    const dir = path.dirname(this.logFile);
    const ext = path.extname(this.logFile);
    const base = path.basename(this.logFile, ext);

    const rotated = path.join(dir, `${base}.1${ext}`);
    try {
      fs.renameSync(this.logFile, rotated);
    } catch (_err) {
      // Ignore if rotation fails
    }
  }

  // Log level methods
  debug(message, metadata) {
    this.log(LOG_LEVELS.DEBUG, message, metadata);
  }

  info(message, metadata) {
    this.log(LOG_LEVELS.INFO, message, metadata);
  }

  warn(message, metadata) {
    this.log(LOG_LEVELS.WARN, message, metadata);
  }

  error(message, metadata) {
    this.log(LOG_LEVELS.ERROR, message, metadata);
  }

  fatal(message, metadata) {
    this.log(LOG_LEVELS.FATAL, message, metadata);
    process.exit(1);
  }
}

// Global singleton
let globalLogger = null;

function getLogger(options = {}) {
  if (!globalLogger) {
    globalLogger = new StructuredLogger({
      component: options.component || 'app',
      level: LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'],
      logFile: process.env.LOG_FILE || null,
      prettyPrint: process.env.NODE_ENV !== 'production',
    });
  }
  return globalLogger;
}

module.exports = getLogger();
module.exports.getLogger = getLogger;
module.exports.LOG_LEVELS = LOG_LEVELS;
module.exports.StructuredLogger = StructuredLogger;
module.exports.generateCorrelationId = generateCorrelationId;
