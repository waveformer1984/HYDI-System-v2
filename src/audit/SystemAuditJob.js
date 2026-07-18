/**
 * SYSTEM AUDIT JOB - Automated Daily Audit
 * 
 * This is where Heidi finally earns her existence:
 * Daily job that scans system, compares against manifest, detects drift,
 * detects duplication, and outputs "what changed + what is redundant"
 * 
 * No opinion. Just receipts.
 */

const SystemAuditor = require('./SystemAuditor');
const PreFlightGate = require('./PreFlightGate');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../lib/structured-logger').child({ component: 'SystemAuditJob' });

class SystemAuditJob {
  constructor(config = {}) {
    this.config = {
      auditInterval: config.auditInterval || 86400000, // 24 hours
      manifestPath: config.manifestPath || path.resolve(__dirname, '../../system-manifest.json'),
      auditResultsPath: config.auditResultsPath || path.resolve(__dirname, '../../audit-results.json'),
      auditHistoryPath: config.auditHistoryPath || path.resolve(__dirname, '../../audit-history.json'),
      
      // Alert thresholds
      healthScoreThreshold: config.healthScoreThreshold || 0.7,
      duplicateThreshold: config.duplicateThreshold || 5,
      violationThreshold: config.violationThreshold || 10,
      
      // Notification settings
      enableNotifications: config.enableNotifications !== false,
      notificationWebhook: config.notificationWebhook || null
    };
    
    this.auditor = new SystemAuditor({
      manifestPath: this.config.manifestPath
    });
    
    this.gate = new PreFlightGate({
      manifestPath: this.config.manifestPath,
      enableBlocking: false, // Audit job shouldn't block
      requireRegistration: true
    });
    
    this.isRunning = false;
    this.lastAudit = null;
    this.auditHistory = [];
    
    logger.info('System Audit Job initialized');
    logger.info('Audit interval configured', { intervalHours: this.config.auditInterval / 3600000 });
  }
  
  /**
   * Start the automated audit job
   */
  async start() {
    if (this.isRunning) {
      logger.info('Audit job already running');
      return;
    }

    logger.info('Starting automated audit job');
    this.isRunning = true;
    
    // Run initial audit
    await this.runAudit();
    
    // Schedule recurring audits
    this.scheduleNextAudit();
    
    logger.info('Automated audit job started');
  }
  
  /**
   * Stop the audit job
   */
  async stop() {
    if (!this.isRunning) {
      logger.info('Audit job not running');
      return;
    }

    logger.info('Stopping automated audit job');
    this.isRunning = false;
    
    if (this.auditTimer) {
      clearTimeout(this.auditTimer);
    }
    
    logger.info('Automated audit job stopped');
  }
  
  /**
   * Schedule the next audit
   */
  scheduleNextAudit() {
    if (!this.isRunning) return;
    
    this.auditTimer = setTimeout(async () => {
      try {
        await this.runAudit();
      } catch (error) {
        logger.error('Scheduled audit failed', { error });
      }
      
      // Schedule next audit
      this.scheduleNextAudit();
    }, this.config.auditInterval);
  }
  
  /**
   * Run the complete system audit
   */
  async runAudit() {
    logger.info('Running system audit');
    
    const auditStart = Date.now();
    
    try {
      // 1. Load previous audit for comparison
      const previousAudit = await this.loadPreviousAudit();
      
      // 2. Run current audit
      const currentAudit = await this.auditor.runAudit();
      
      // 3. Analyze changes
      const changes = this.analyzeChanges(previousAudit, currentAudit);
      
      // 4. Generate summary
      const summary = this.generateAuditSummary(currentAudit, changes);
      
      // 5. Store audit results
      await this.storeAuditResults(currentAudit, summary);
      
      // 6. Update audit history
      await this.updateAuditHistory(currentAudit, summary);
      
      // 7. Check for alerts
      await this.checkAlerts(currentAudit, summary);
      
      // 8. Send notifications if needed
      if (this.config.enableNotifications) {
        await this.sendNotifications(summary);
      }
      
      this.lastAudit = currentAudit;
      
      const duration = Date.now() - auditStart;
      logger.info('Audit completed', {
        durationMs: duration,
        healthScore: summary.healthScore.toFixed(2),
        changesDetected: changes.totalChanges
      });
      
      return currentAudit;
      
    } catch (error) {
      logger.error('Audit failed', { error });
      
      // Store error
      const errorAudit = {
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'failed'
      };
      
      await this.storeAuditResults(errorAudit);
      throw error;
    }
  }
  
  /**
   * Load previous audit results
   */
  async loadPreviousAudit() {
    try {
      const data = await fs.readFile(this.config.auditResultsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.info('No previous audit found');
      return null;
    }
  }
  
  /**
   * Analyze changes between audits
   */
  analyzeChanges(previousAudit, currentAudit) {
    const changes = {
      totalChanges: 0,
      newFiles: [],
      removedFiles: [],
      newFunctions: [],
      removedFunctions: [],
      newClasses: [],
      removedClasses: [],
      newDuplicates: [],
      resolvedDuplicates: [],
      newViolations: [],
      resolvedViolations: [],
      healthScoreChange: 0
    };
    
    if (!previousAudit) {
      // First audit - everything is new
      if (currentAudit.inventory) {
        changes.newFiles = currentAudit.inventory.files.map(f => f.relativePath);
        changes.newFunctions = currentAudit.inventory.functions.map(f => f.name);
        changes.newClasses = currentAudit.inventory.classes.map(c => c.name);
        changes.totalChanges = changes.newFiles.length + changes.newFunctions.length + changes.newClasses.length;
      }
      
      if (currentAudit.duplicates) {
        changes.newDuplicates = currentAudit.duplicates;
      }
      
      if (currentAudit.violations) {
        changes.newViolations = currentAudit.violations;
      }
      
      return changes;
    }
    
    // Compare files
    if (previousAudit.inventory && currentAudit.inventory) {
      const prevFiles = new Set(previousAudit.inventory.files.map(f => f.relativePath));
      const currFiles = new Set(currentAudit.inventory.files.map(f => f.relativePath));
      
      changes.newFiles = currentAudit.inventory.files
        .filter(f => !prevFiles.has(f.relativePath))
        .map(f => f.relativePath);
      
      changes.removedFiles = previousAudit.inventory.files
        .filter(f => !currFiles.has(f.relativePath))
        .map(f => f.relativePath);
      
      // Compare functions
      const prevFuncs = new Set(previousAudit.inventory.functions.map(f => f.name));
      const currFuncs = new Set(currentAudit.inventory.functions.map(f => f.name));
      
      changes.newFunctions = currentAudit.inventory.functions
        .filter(f => !prevFuncs.has(f.name))
        .map(f => f.name);
      
      changes.removedFunctions = previousAudit.inventory.functions
        .filter(f => !currFuncs.has(f.name))
        .map(f => f.name);
      
      // Compare classes
      const prevClasses = new Set(previousAudit.inventory.classes.map(c => c.name));
      const currClasses = new Set(currentAudit.inventory.classes.map(c => c.name));
      
      changes.newClasses = currentAudit.inventory.classes
        .filter(c => !prevClasses.has(c.name))
        .map(c => c.name);
      
      changes.removedClasses = previousAudit.inventory.classes
        .filter(c => !currClasses.has(c.name))
        .map(c => c.name);
    }
    
    // Compare duplicates
    if (previousAudit.duplicates && currentAudit.duplicates) {
      const prevDupNames = new Set(previousAudit.duplicates.map(d => d.name || d.pattern));
      const currDupNames = new Set(currentAudit.duplicates.map(d => d.name || d.pattern));
      
      changes.newDuplicates = currentAudit.duplicates
        .filter(d => !prevDupNames.has(d.name || d.pattern));
      
      changes.resolvedDuplicates = previousAudit.duplicates
        .filter(d => !currDupNames.has(d.name || d.pattern));
    }
    
    // Compare violations
    if (previousAudit.violations && currentAudit.violations) {
      const prevViolations = new Set(previousAudit.violations.map(v => v.message));
      const currViolations = new Set(currentAudit.violations.map(v => v.message));
      
      changes.newViolations = currentAudit.violations
        .filter(v => !prevViolations.has(v.message));
      
      changes.resolvedViolations = previousAudit.violations
        .filter(v => !currViolations.has(v.message));
    }
    
    // Calculate health score change
    if (previousAudit.summary && currentAudit.summary) {
      changes.healthScoreChange = currentAudit.summary.healthScore - previousAudit.summary.healthScore;
    }
    
    changes.totalChanges = changes.newFiles.length + changes.removedFiles.length +
                         changes.newFunctions.length + changes.removedFunctions.length +
                         changes.newClasses.length + changes.removedClasses.length +
                         changes.newDuplicates.length + changes.resolvedDuplicates.length +
                         changes.newViolations.length + changes.resolvedViolations.length;
    
    return changes;
  }
  
  /**
   * Generate audit summary
   */
  generateAuditSummary(audit, changes) {
    const summary = {
      timestamp: audit.timestamp,
      status: audit.error ? 'failed' : 'completed',
      healthScore: audit.summary?.healthScore || 0,
      healthScoreChange: changes.healthScoreChange,
      totalComponents: {
        files: audit.inventory?.files?.length || 0,
        functions: audit.inventory?.functions?.length || 0,
        classes: audit.inventory?.classes?.length || 0
      },
      issues: {
        duplicates: audit.duplicates?.length || 0,
        violations: audit.violations?.length || 0,
        circularDependencies: audit.auditor?.dependencyGraph?.circular?.length || 0,
        orphans: audit.auditor?.dependencyGraph?.orphans?.length || 0
      },
      changes: {
        total: changes.totalChanges,
        new: changes.newFiles.length + changes.newFunctions.length + changes.newClasses.length,
        removed: changes.removedFiles.length + changes.removedFunctions.length + changes.removedClasses.length,
        resolved: changes.resolvedDuplicates.length + changes.resolvedViolations.length
      },
      alerts: [],
      recommendations: audit.recommendations || []
    };
    
    // Generate alerts
    if (summary.healthScore < this.config.healthScoreThreshold) {
      summary.alerts.push({
        type: 'low_health_score',
        message: `Health score ${summary.healthScore.toFixed(2)} below threshold ${this.config.healthScoreThreshold}`,
        severity: 'high'
      });
    }
    
    if (summary.issues.duplicates > this.config.duplicateThreshold) {
      summary.alerts.push({
        type: 'high_duplicates',
        message: `${summary.issues.duplicates} duplicates found (threshold: ${this.config.duplicateThreshold})`,
        severity: 'medium'
      });
    }
    
    if (summary.issues.violations > this.config.violationThreshold) {
      summary.alerts.push({
        type: 'high_violations',
        message: `${summary.issues.violations} violations found (threshold: ${this.config.violationThreshold})`,
        severity: 'medium'
      });
    }
    
    if (summary.issues.circularDependencies > 0) {
      summary.alerts.push({
        type: 'circular_dependencies',
        message: `${summary.issues.circularDependencies} circular dependencies detected`,
        severity: 'high'
      });
    }
    
    return summary;
  }
  
  /**
   * Store audit results
   */
  async storeAuditResults(audit, summary = null) {
    const auditData = summary ? { ...audit, summary } : audit;
    
    try {
      await fs.writeFile(this.config.auditResultsPath, JSON.stringify(auditData, null, 2));
      logger.info('Audit results stored', { auditResultsPath: this.config.auditResultsPath });
    } catch (error) {
      logger.error('Failed to store audit results', { error });
    }
  }
  
  /**
   * Update audit history
   */
  async updateAuditHistory(audit, summary) {
    try {
      let history = [];
      
      // Load existing history
      try {
        const data = await fs.readFile(this.config.auditHistoryPath, 'utf8');
        history = JSON.parse(data);
      } catch (error) {
        // File doesn't exist, start fresh
      }
      
      // Add new entry
      history.push({
        timestamp: audit.timestamp,
        healthScore: summary.healthScore,
        totalChanges: summary.changes.total,
        alerts: summary.alerts.length,
        status: audit.status
      });
      
      // Keep only last 30 days
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      history = history.filter(entry => new Date(entry.timestamp).getTime() > cutoff);
      
      // Store updated history
      await fs.writeFile(this.config.auditHistoryPath, JSON.stringify(history, null, 2));
      
      this.auditHistory = history;
      
    } catch (error) {
      logger.error('Failed to update audit history', { error });
    }
  }
  
  /**
   * Check for alerts and take action
   */
  async checkAlerts(audit, summary) {
    for (const alert of summary.alerts) {
      if (alert.severity === 'high') {
        logger.warn('High severity alert', { message: alert.message });
        
        // Could trigger additional actions here
        // - Send to monitoring system
        // - Block deployments
        // - Notify administrators
      }
    }
  }
  
  /**
   * Send notifications
   */
  async sendNotifications(summary) {
    if (!this.config.notificationWebhook) {
      return;
    }
    
    try {
      // This would send to webhook, Slack, Discord, etc.
      logger.info('Notification would be sent', {
        webhook: this.config.notificationWebhook,
        healthScore: summary.healthScore.toFixed(2),
        changes: summary.changes.total,
        alerts: summary.alerts.length
      });
    } catch (error) {
      logger.error('Failed to send notifications', { error });
    }
  }
  
  /**
   * Get audit status
   */
  getStatus() {
    return {
      running: this.isRunning,
      lastAudit: this.lastAudit?.timestamp || null,
      nextAudit: this.auditTimer ? new Date(Date.now() + this.config.auditInterval).toISOString() : null,
      auditHistory: this.auditHistory.length,
      config: this.config
    };
  }
  
  /**
   * Get audit report
   */
  async getAuditReport() {
    try {
      const auditData = await fs.readFile(this.config.auditResultsPath, 'utf8');
      const audit = JSON.parse(auditData);
      
      return {
        current: audit,
        history: this.auditHistory,
        trends: this.calculateTrends()
      };
    } catch (error) {
      return {
        current: null,
        history: this.auditHistory,
        trends: null,
        error: error.message
      };
    }
  }
  
  calculateTrends() {
    if (this.auditHistory.length < 2) {
      return null;
    }
    
    const recent = this.auditHistory.slice(-7); // Last 7 audits
    const healthScores = recent.map(entry => entry.healthScore);
    
    const avgHealthScore = healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length;
    const healthTrend = healthScores[healthScores.length - 1] - healthScores[0];
    
    return {
      averageHealthScore: avgHealthScore,
      healthTrend: healthTrend,
      trendDirection: healthTrend > 0.01 ? 'improving' : healthTrend < -0.01 ? 'declining' : 'stable',
      period: '7 days'
    };
  }
}

module.exports = SystemAuditJob;
