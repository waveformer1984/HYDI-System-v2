/**
 * HYDI State Manager
 *
 * Persistent state layer for the operating system.
 *
 * Survives crashes, reboots, and partial outages.
 *
 * Backed by SQLite (existing sqlite3 dependency).
 * Falls back to in-memory if DB is unavailable.
 *
 * Responsibilities:
 *   - Persist workflow instances
 *   - Persist approval queues
 *   - Persist recovery state
 *   - Persist resource allocations
 *   - Immutable audit ledger
 *   - Service registry snapshots
 *   - Health snapshot history
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class StateManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      dbPath: config.dbPath || path.resolve(__dirname, '..', 'data', 'hydi-state.db'),
      maxAuditRecords: 100000,
      maxHealthSnapshots: 10000,
      maxWorkflowHistory: 5000,
      ...config
    };

    this.db = null;
    this.memoryMode = false;
    this.memoryStore = {
      workflows: new Map(),
      approvals: new Map(),
      recovery: new Map(),
      allocations: new Map(),
      audit: [],
      registrySnapshots: [],
      healthSnapshots: new Map()
    };

    this.initialized = false;
    console.log('[STATE MANAGER] Initialized');
  }

  /**
   * Initialize the database
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const sqlite3 = require('sqlite3');
      const dbDir = path.dirname(this.config.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.config.dbPath);
      this.memoryMode = false;

      await this.createTables();
      console.log(`[STATE MANAGER] SQLite connected: ${this.config.dbPath}`);

    } catch (error) {
      console.warn(`[STATE MANAGER] SQLite unavailable (${error.message}), falling back to in-memory`);
      this.memoryMode = true;
      this.db = null;
    }

    this.initialized = true;
    this.emit('initialized', { mode: this.memoryMode ? 'memory' : 'sqlite' });
  }

  /**
   * Create database tables
   */
  createTables() {
    return new Promise((resolve, reject) => {
      const schema = `
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          definition TEXT NOT NULL,
          name TEXT,
          status TEXT NOT NULL,
          payload TEXT,
          steps TEXT,
          current_step INTEGER,
          created_at INTEGER,
          completed_at INTEGER,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          workflow_id TEXT,
          step_id TEXT,
          approvers TEXT,
          requested_at INTEGER,
          responded_at INTEGER,
          status TEXT,
          response TEXT
        );

        CREATE TABLE IF NOT EXISTS recovery_log (
          id TEXT PRIMARY KEY,
          service_id TEXT,
          reason TEXT,
          playbook TEXT,
          status TEXT,
          steps TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS resource_allocations (
          service_id TEXT PRIMARY KEY,
          cpu INTEGER,
          ram INTEGER,
          gpu INTEGER,
          allocated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS audit_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          actor TEXT,
          target TEXT,
          payload TEXT,
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS registry_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS health_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id TEXT NOT NULL,
          health TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
        CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_ledger(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_ledger(event_type);
        CREATE INDEX IF NOT EXISTS idx_health_service ON health_snapshots(service_id);
      `;

      this.db.exec(schema, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Audit ledger: record every significant action
   */
  async audit(eventType, payload = {}) {
    const record = {
      eventType,
      actor: payload.actor || 'system',
      target: payload.target || null,
      payload: JSON.stringify(payload.data || {}),
      timestamp: Date.now()
    };

    if (this.memoryMode) {
      this.memoryStore.audit.push(record);
      if (this.memoryStore.audit.length > this.config.maxAuditRecords) {
        this.memoryStore.audit = this.memoryStore.audit.slice(-this.config.maxAuditRecords / 2);
      }
      return record;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO audit_ledger (event_type, actor, target, payload, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [record.eventType, record.actor, record.target, record.payload, record.timestamp],
        function (err) {
          if (err) reject(err);
          else resolve({ ...record, id: this.lastID });
        }
      );
    });
  }

  /**
   * Persist a workflow instance
   */
  async persistWorkflow(workflow) {
    if (this.memoryMode) {
      this.memoryStore.workflows.set(workflow.id, JSON.parse(JSON.stringify(workflow)));
      return workflow.id;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO workflows
         (id, definition, name, status, payload, steps, current_step, created_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workflow.id,
          workflow.definition,
          workflow.name,
          workflow.status,
          JSON.stringify(workflow.payload || {}),
          JSON.stringify(workflow.steps || []),
          workflow.currentStepIndex || 0,
          workflow.createdAt,
          workflow.completedAt || null,
          workflow.error || null
        ],
        (err) => {
          if (err) reject(err);
          else resolve(workflow.id);
        }
      );
    });
  }

  /**
   * Load all active workflows
   */
  async loadActiveWorkflows() {
    if (this.memoryMode) {
      return Array.from(this.memoryStore.workflows.values())
        .filter(w => w.status === 'running');
    }

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM workflows WHERE status = 'running' ORDER BY created_at DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(r => this.deserializeWorkflow(r)));
        }
      );
    });
  }

  /**
   * Load workflow by ID
   */
  async loadWorkflow(workflowId) {
    if (this.memoryMode) {
      return this.memoryStore.workflows.get(workflowId) || null;
    }

    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM workflows WHERE id = ?`,
        [workflowId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? this.deserializeWorkflow(row) : null);
        }
      );
    });
  }

  /**
   * Persist an approval request
   */
  async persistApproval(approval) {
    if (this.memoryMode) {
      this.memoryStore.approvals.set(approval.id, JSON.parse(JSON.stringify(approval)));
      return approval.id;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO approvals
         (id, workflow_id, step_id, approvers, requested_at, responded_at, status, response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          approval.id,
          approval.workflowId,
          approval.stepId,
          JSON.stringify(approval.approvers || []),
          approval.requestedAt,
          approval.respondedAt || null,
          approval.status,
          JSON.stringify(approval.response || {})
        ],
        (err) => {
          if (err) reject(err);
          else resolve(approval.id);
        }
      );
    });
  }

  /**
   * Persist recovery attempt
   */
  async persistRecovery(attempt) {
    if (this.memoryMode) {
      this.memoryStore.recovery.set(attempt.id, JSON.parse(JSON.stringify(attempt)));
      return attempt.id;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO recovery_log
         (id, service_id, reason, playbook, status, steps, started_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attempt.id,
          attempt.serviceId,
          attempt.reason,
          attempt.playbook,
          attempt.status,
          JSON.stringify(attempt.steps || []),
          attempt.startedAt,
          attempt.completedAt || null,
          attempt.error || null
        ],
        (err) => {
          if (err) reject(err);
          else resolve(attempt.id);
        }
      );
    });
  }

  /**
   * Persist resource allocation
   */
  async persistAllocation(serviceId, allocation) {
    if (this.memoryMode) {
      this.memoryStore.allocations.set(serviceId, JSON.parse(JSON.stringify(allocation)));
      return serviceId;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO resource_allocations
         (service_id, cpu, ram, gpu, allocated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [serviceId, allocation.cpu, allocation.ram, allocation.gpu, allocation.allocatedAt],
        (err) => {
          if (err) reject(err);
          else resolve(serviceId);
        }
      );
    });
  }

  /**
   * Persist registry snapshot
   */
  async persistRegistrySnapshot(snapshot) {
    if (this.memoryMode) {
      this.memoryStore.registrySnapshots.push({ snapshot, timestamp: Date.now() });
      if (this.memoryStore.registrySnapshots.length > 100) {
        this.memoryStore.registrySnapshots = this.memoryStore.registrySnapshots.slice(-50);
      }
      return snapshot;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO registry_snapshots (snapshot, timestamp)
         VALUES (?, ?)`,
        [JSON.stringify(snapshot), Date.now()],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, snapshot });
        }
      );
    });
  }

  /**
   * Persist health snapshot
   */
  async persistHealthSnapshot(serviceId, health) {
    if (this.memoryMode) {
      if (!this.memoryStore.healthSnapshots.has(serviceId)) {
        this.memoryStore.healthSnapshots.set(serviceId, []);
      }
      const snaps = this.memoryStore.healthSnapshots.get(serviceId);
      snaps.push({ health, timestamp: Date.now() });
      if (snaps.length > this.config.maxHealthSnapshots) {
        this.memoryStore.healthSnapshots.set(serviceId, snaps.slice(-this.config.maxHealthSnapshots / 2));
      }
      return serviceId;
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO health_snapshots (service_id, health, timestamp)
         VALUES (?, ?, ?)`,
        [serviceId, JSON.stringify(health), Date.now()],
        (err) => {
          if (err) reject(err);
          else resolve(serviceId);
        }
      );
    });
  }

  /**
   * Query audit ledger
   */
  async queryAudit(options = {}) {
    const { eventType, actor, limit = 100, since } = options;

    if (this.memoryMode) {
      let results = this.memoryStore.audit;
      if (eventType) results = results.filter(r => r.eventType === eventType);
      if (actor) results = results.filter(r => r.actor === actor);
      if (since) results = results.filter(r => r.timestamp >= since);
      return results.slice(-limit).reverse();
    }

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM audit_ledger WHERE 1=1`;
      const params = [];

      if (eventType) { query += ` AND event_type = ?`; params.push(eventType); }
      if (actor) { query += ` AND actor = ?`; params.push(actor); }
      if (since) { query += ` AND timestamp >= ?`; params.push(since); }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Get system-wide status summary
   */
  async getStatus() {
    if (this.memoryMode) {
      return {
        mode: 'memory',
        workflows: this.memoryStore.workflows.size,
        approvals: this.memoryStore.approvals.size,
        recovery: this.memoryStore.recovery.size,
        allocations: this.memoryStore.allocations.size,
        auditRecords: this.memoryStore.audit.length,
        registrySnapshots: this.memoryStore.registrySnapshots.length
      };
    }

    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT
          (SELECT COUNT(*) FROM workflows WHERE status = 'running') as active_workflows,
          (SELECT COUNT(*) FROM workflows) as total_workflows,
          (SELECT COUNT(*) FROM approvals WHERE status = 'pending') as pending_approvals,
          (SELECT COUNT(*) FROM recovery_log) as recovery_attempts,
          (SELECT COUNT(*) FROM resource_allocations) as allocations,
          (SELECT COUNT(*) FROM audit_ledger) as audit_records,
          (SELECT COUNT(*) FROM registry_snapshots) as registry_snapshots`,
        (err, row) => {
          if (err) reject(err);
          else {
            const normalized = {
              mode: 'sqlite',
              activeWorkflows: row.active_workflows,
              totalWorkflows: row.total_workflows,
              pendingApprovals: row.pending_approvals,
              recoveryAttempts: row.recovery_attempts,
              allocations: row.allocations,
              auditRecords: row.audit_records,
              registrySnapshots: row.registry_snapshots
            };
            resolve(normalized);
          }
        }
      );
    });
  }

  /**
   * Deserialize a workflow row from DB
   */
  deserializeWorkflow(row) {
    return {
      id: row.id,
      definition: row.definition,
      name: row.name,
      status: row.status,
      payload: JSON.parse(row.payload || '{}'),
      steps: JSON.parse(row.steps || '[]'),
      currentStepIndex: row.current_step,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      error: row.error
    };
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) console.error('[STATE MANAGER] Error closing DB:', err.message);
          this.db = null;
          this.initialized = false;
          resolve();
        });
      });
    }
    this.initialized = false;
  }
}

module.exports = StateManager;
