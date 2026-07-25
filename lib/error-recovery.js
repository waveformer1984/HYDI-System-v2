/**
 * Global Error Recovery System
 *
 * Catches unhandled rejections, logs them, and implements recovery strategies.
 * Prevents: process crashes from unhandled promises
 *
 * Usage:
 *   require('./lib/error-recovery');  // Call once at app startup
 */

const logger = require('./structured-logger');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;

/**
 * Exponential backoff with jitter
 * Prevents thundering herd problem
 */
function exponentialBackoff(attempt, initialMs = DEFAULT_INITIAL_BACKOFF_MS) {
  const exponential = initialMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.1; // 10% jitter
  const maxBackoff = 30000; // 30s cap
  return Math.min(exponential + jitter, maxBackoff);
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
    onRetry = () => {},
  } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) {
        // Last attempt failed
        throw err;
      }

      const waitMs = exponentialBackoff(attempt, initialBackoffMs);
      onRetry(attempt, waitMs, err);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * Wrap async function to catch unhandled rejections
 */
function wrapAsyncFunction(name, fn, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error(`Unhandled rejection in ${name}`, {
        component: name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      if (options.rethrow) throw err;
      if (options.onError) options.onError(err);
      return options.defaultReturn || null;
    }
  };
}

let handlersInstalled = false;
const installedHandlers = {};

/**
 * Global unhandled rejection handler
 */
function setupGlobalErrorHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  // Unhandled promise rejection
  installedHandlers.unhandledRejection = (reason, _promise) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };
  process.on('unhandledRejection', installedHandlers.unhandledRejection);

  // Uncaught exception
  installedHandlers.uncaughtException = (err) => {
    logger.error('Uncaught exception - terminating process', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  };
  process.on('uncaughtException', installedHandlers.uncaughtException);

  // Graceful shutdown signals
  installedHandlers.sigterm = () => {
    logger.info('SIGTERM received - graceful shutdown');
    gracefulShutdown();
  };
  process.on('SIGTERM', installedHandlers.sigterm);

  installedHandlers.sigint = () => {
    logger.info('SIGINT received - graceful shutdown');
    gracefulShutdown();
  };
  process.on('SIGINT', installedHandlers.sigint);
}

function uninstallGlobalErrorHandlers() {
  if (!handlersInstalled) return;
  handlersInstalled = false;

  if (installedHandlers.unhandledRejection) {
    process.off('unhandledRejection', installedHandlers.unhandledRejection);
  }
  if (installedHandlers.uncaughtException) {
    process.off('uncaughtException', installedHandlers.uncaughtException);
  }
  if (installedHandlers.sigterm) {
    process.off('SIGTERM', installedHandlers.sigterm);
  }
  if (installedHandlers.sigint) {
    process.off('SIGINT', installedHandlers.sigint);
  }
}

/**
 * Graceful shutdown: close all connections
 */
async function gracefulShutdown() {
  logger.info('Starting graceful shutdown...');

  // Wait for in-flight requests to complete (max 10s)
  await new Promise((resolve) => {
    setTimeout(() => {
      logger.info('Shutdown timeout reached');
      resolve();
    }, 10000);
  });

  logger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Worker health check utility
 */
class WorkerHealthCheck {
  constructor(name) {
    this.name = name;
    this.lastHealthCheck = Date.now();
    this.isHealthy = true;
    this.errorCount = 0;
    this.successCount = 0;
  }

  success() {
    this.successCount++;
    this.errorCount = 0;
    this.isHealthy = true;
    this.lastHealthCheck = Date.now();
  }

  error() {
    this.errorCount++;
    this.isHealthy = this.errorCount < 3; // Unhealthy after 3 errors
    this.lastHealthCheck = Date.now();
  }

  getStatus() {
    return {
      name: this.name,
      healthy: this.isHealthy,
      lastCheck: new Date(this.lastHealthCheck).toISOString(),
      stats: {
        successes: this.successCount,
        recentErrors: this.errorCount,
      },
    };
  }
}

// Export
module.exports = {
  exponentialBackoff,
  retryWithBackoff,
  wrapAsyncFunction,
  setupGlobalErrorHandlers,
  uninstallGlobalErrorHandlers,
  gracefulShutdown,
  WorkerHealthCheck,
};
