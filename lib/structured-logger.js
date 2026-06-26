/**
 * Structured Logging System
 *
 * JSON output for machine-readable logs.
 * Format: {timestamp, level, component, message, metadata...}
 *
 * Usage:
 *   const logger = require('./lib/structured-logger');
 *   logger.info('Service started', {component: 'heidi-core', port: 3458});
 */

const fs = require('fs');
const path = require('path');

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

class StructuredLogger {
  constructor(options = {}) {
    this.component = options.component || 'app';
    this.level = options.level || LOG_LEVELS.INFO;
    this.logFile = options.logFile || null;
    this.prettyPrint = options.prettyPrint !== false; // Default true in dev
    this.maxFileSize = options.maxFileSize || 50 * 1024 * 1024; // 50MB
  }

  /**
   * Write a log entry
   */
  log(levelNum, message, metadata = {}) {
    if (levelNum < this.level) return; // Skip if below threshold

    const entry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[levelNum],
      component: this.component,
      message,
      ...metadata,
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
    const prefix = `${timestamp} [${entry.level}] ${entry.component}`;

    if (this.prettyPrint) {
      console.log(`${color}${prefix}${colors.RESET} ${entry.message}`);
      if (Object.keys(entry).length > 4) {
        // Has metadata beyond standard fields
        const meta = { ...entry };
        delete meta.timestamp;
        delete meta.level;
        delete meta.component;
        delete meta.message;
        console.log(`  ${JSON.stringify(meta)}`);
      }
    } else {
      // JSON output
      console.log(JSON.stringify(entry));
    }
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
    } catch (err) {
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
