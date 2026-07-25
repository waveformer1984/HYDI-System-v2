/**
 * Health Monitoring System
 *
 * Tracks service health and provides unified /health endpoint.
 * Format: {status, uptime, timestamp, components: {...}}
 *
 * Usage:
 *   const health = require('./lib/health-monitor');
 *   health.registerComponent('supabase', checkSupabaseHealth);
 *   app.get('/health', (req, res) => res.json(health.getStatus()));
 */

const logger = require('./structured-logger');

class HealthMonitor {
  constructor() {
    this.startTime = Date.now();
    this.components = {};
    this.lastCheck = {};
    this.checkInterval = 10000; // 10s default
    this._timers = new Map();
    this._destroyed = false;
  }

  /**
   * Register a component with a health check function
   */
  registerComponent(name, checkFn, interval = this.checkInterval) {
    if (this._destroyed) return;

    // Idempotent re-registration: stop any previous interval
    this.stop(name);

    this.components[name] = {
      checkFn,
      interval,
      healthy: false,
      lastError: null,
      lastCheck: null,
    };

    // Start periodic checks
    this._startHealthChecks(name);
  }

  /**
   * Run health check for a component
   */
  async _checkComponent(name) {
    const component = this.components[name];
    try {
      const result = await component.checkFn();
      component.healthy = result === true || (result && result.healthy);
      component.lastError = null;
      component.lastCheck = new Date().toISOString();
    } catch (err) {
      component.healthy = false;
      component.lastError = err instanceof Error ? err.message : String(err);
      component.lastCheck = new Date().toISOString();

      // Log health check failure (but only quarterly to avoid spam)
      const now = Date.now();
      if (!this.lastCheck[name] || now - this.lastCheck[name] > 60000) {
        logger.warn(`Health check failed: ${name}`, {
          error: component.lastError,
        });
        this.lastCheck[name] = now;
      }
    }
  }

  /**
   * Start periodic health checks for a component
   */
  _startHealthChecks(name) {
    const component = this.components[name];

    // Check immediately (best effort; do not await)
    this._checkComponent(name).catch(() => {});

    // Then periodically
    const handle = setInterval(() => {
      this._checkComponent(name).catch(() => {});
    }, component.interval);
    this._timers.set(name, handle);
  }

  /**
   * Stop health checks for a single component
   */
  stop(name) {
    const handle = this._timers.get(name);
    if (handle) {
      clearInterval(handle);
      this._timers.delete(name);
    }
    delete this.components[name];
  }

  /**
   * Stop all health checks and release state
   */
  destroy() {
    this._destroyed = true;
    for (const handle of this._timers.values()) {
      clearInterval(handle);
    }
    this._timers.clear();
    this.components = {};
    this.lastCheck = {};
  }

  /**
   * Get overall system health status
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;
    const allHealthy = Object.values(this.components).every((c) => c.healthy);

    const components = {};
    for (const [name, comp] of Object.entries(this.components)) {
      components[name] = {
        healthy: comp.healthy,
        lastCheck: comp.lastCheck,
        error: comp.lastError,
      };
    }

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      uptime: Math.floor(uptime / 1000), // seconds
      timestamp: new Date().toISOString(),
      components,
    };
  }

  /**
   * HTTP status code based on health
   */
  getStatusCode() {
    const status = this.getStatus();
    const allHealthy = Object.values(status.components).every((c) => c.healthy);
    return allHealthy ? 200 : 503; // 503 Service Unavailable if degraded
  }
}

// Pre-built health checks
const HealthChecks = {
  /**
   * Check if Supabase is responding
   */
  supabase: async () => {
    try {
      // If supabase-js is available, use it
      if (global.supabaseClient) {
        const { error } = await global.supabaseClient
          .from('_healthcheck')
          .select('1')
          .single()
          .timeout(5000);

        return !error;
      }

      // Fallback: HTTP check
      const http = require('http');
      return new Promise((resolve) => {
        const req = http.get(
          'http://127.0.0.1:3001/health',
          { timeout: 5000 },
          (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          }
        );
        req.on('error', () => resolve(false));
      });
    } catch (err) {
      return false;
    }
  },

  /**
   * Check if Ollama is responding
   */
  ollama: async () => {
    try {
      const http = require('http');
      return new Promise((resolve) => {
        const req = http.get(
          'http://127.0.0.1:11434/api/tags',
          { timeout: 5000 },
          (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          }
        );
        req.on('error', () => resolve(false));
      });
    } catch (err) {
      return false;
    }
  },

  /**
   * Check if Next.js is responding
   */
  nextjs: async () => {
    try {
      const http = require('http');
      return new Promise((resolve) => {
        const req = http.get(
          'http://127.0.0.1:3000/health',
          { timeout: 5000 },
          (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          }
        );
        req.on('error', () => resolve(false));
      });
    } catch (err) {
      return false;
    }
  },

  /**
   * Dummy check that always passes
   */
  dummy: async () => true,
};

// Global singleton
let globalMonitor = null;

function getMonitor() {
  if (!globalMonitor) {
    globalMonitor = new HealthMonitor();
  }
  return globalMonitor;
}

module.exports = getMonitor();
module.exports.getMonitor = getMonitor;
module.exports.HealthChecks = HealthChecks;
module.exports.HealthMonitor = HealthMonitor;
