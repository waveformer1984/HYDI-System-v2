'use strict';

const SecurityAuditor = require('../hydi-v3/SecurityAuditor');

/**
 * Scorecard computes repository and runtime health scores for the HYDI OS.
 *
 * It evaluates architecture, technical debt, reliability, security, offline
 * readiness, automation, production readiness, and commercial readiness.
 */
class Scorecard {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      scanPaths: options.scanPaths || ['src'],
      ...options,
    };
    this.securityAuditor = new SecurityAuditor({ scanPaths: this.config.scanPaths });
  }

  async evaluate(options = {}) {
    const auditor = options.auditor || null;
    const health = options.health || this.kernel.healthMonitor.getLast();
    const modules = this.kernel.moduleRegistry.list();
    const status = this.kernel.getStatus();

    const securityReport = await this._securityScore();
    const audit = auditor ? await auditor.auditRepository() : { issueCounts: {} };
    const issues = audit.issueCounts || {};

    const architecture = this._scoreArchitecture(modules, issues);
    const debt = this._scoreDebt(issues);
    const reliability = this._scoreReliability(health, modules);
    const security = this._scoreSecurity(securityReport);
    const offline = this._scoreOffline(modules, securityReport);
    const automation = this._scoreAutomation(modules);
    const production = this._scoreProduction(issues, health);
    const commercial = this._scoreCommercial(modules);

    const overall = Math.round(
      (architecture + debt + reliability + security + offline + automation + production + commercial) / 8
    );

    return {
      generatedAt: new Date().toISOString(),
      overall,
      scores: {
        architecture,
        technicalDebt: debt,
        reliability,
        security,
        offlineReadiness: offline,
        automation,
        productionReadiness: production,
        commercialReadiness: commercial,
      },
      details: {
        modules: modules.length,
        healthyModules: health?.healthy || 0,
        failedModules: health?.failed || 0,
        securityFindings: securityReport.findings,
        issues,
      },
    };
  }

  async _securityScore() {
    try {
      const codeFindings = await this.securityAuditor.auditCodeSecurity();
      const inputIssues = [];
      for (const pattern of ['eval()', '<script>', '../', 'shell:true']) {
        const result = this.securityAuditor.validateInput(pattern);
        if (!result.valid) inputIssues.push({ pattern, issues: result.issues });
      }
      return {
        findings: codeFindings.length,
        inputIssues: inputIssues.length,
        ok: codeFindings.length === 0,
      };
    } catch (err) {
      return { findings: 0, inputIssues: 0, ok: true, error: err.message };
    }
  }

  _scoreArchitecture(modules, issues) {
    let score = 100;
    if (issues.circularImports > 0) score -= issues.circularImports * 15;
    if (issues.duplicateLogic > 0) score -= Math.min(issues.duplicateLogic * 2, 20);
    const modulesWithCaps = modules.filter((m) => m.capabilities && m.capabilities.length > 0).length;
    if (modules.length > 0 && modulesWithCaps / modules.length < 0.5) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  _scoreDebt(issues) {
    let score = 100;
    if (issues.deadCode > 0) score -= Math.min(issues.deadCode, 10);
    if (issues.duplicateLogic > 0) score -= Math.min(issues.duplicateLogic * 2, 20);
    if (issues.timerLeaks > 0) score -= issues.timerLeaks * 5;
    if (issues.resourceLeaks > 0) score -= issues.resourceLeaks * 5;
    return Math.max(0, Math.min(100, score));
  }

  _scoreReliability(health, modules) {
    const total = modules.length || 1;
    const failed = health?.failed || 0;
    return Math.max(0, Math.min(100, 100 - (failed / total) * 100));
  }

  _scoreSecurity(securityReport) {
    return securityReport.ok ? 100 : Math.max(0, 100 - securityReport.findings * 10);
  }

  _scoreOffline(modules, securityReport) {
    const localAdapters = modules.filter((m) => m.id.includes('local') || m.id.includes('sqlite') || m.id.includes('ollama')).length;
    return Math.max(0, Math.min(100, 50 + localAdapters * 10 + (securityReport.ok ? 20 : 0)));
  }

  _scoreAutomation(modules) {
    const autonomous = modules.filter((m) => m.id.includes('autonomous') || m.id.includes('doctor') || m.id.includes('operator')).length;
    return Math.min(100, 40 + autonomous * 20);
  }

  _scoreProduction(issues, health) {
    let score = 100;
    if (issues.timerLeaks > 0) score -= 15;
    if (issues.resourceLeaks > 0) score -= 15;
    if ((health?.failed || 0) > 0) score -= 20;
    return Math.max(0, score);
  }

  _scoreCommercial(modules) {
    const factory = modules.some((m) => m.id.includes('factory') || m.id.includes('protoforge'));
    return factory ? 80 : 40;
  }
}

module.exports = Scorecard;
