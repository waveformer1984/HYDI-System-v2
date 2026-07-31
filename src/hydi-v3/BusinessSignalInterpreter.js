'use strict';

const DEFAULT_PROJECT_OBJECTIVES = {
  resonate: 'resonate',
  rezonate: 'resonate',
  protoforge: 'operations',
  protogrance: 'manufacturing',
  'prototype housing': 'manufacturing',
  cad: 'manufacturing',
  research: 'research',
  music: 'music',
};

function normalizeProject(name) {
  return String(name).toLowerCase().replace(/[_\s-]+/g, ' ').trim();
}

function detectSubsystem(relPath, projectName = '') {
  const lower = relPath.toLowerCase();
  const projectLower = String(projectName).toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'Documentation';
  if (lower.includes('audio') || lower.includes('dsp') || lower.includes('sound')) return 'Audio Engine';
  if (lower.includes('ui') || lower.includes('interface') || lower.includes('components')) return 'UI';
  if (lower.includes('cad') || lower.includes('stl')) return 'CAD';
  if (lower.includes('gcode') || lower.includes('print')) return 'Manufacturing';
  if (lower.includes('test')) return 'Tests';
  if (lower.includes('docs')) return 'Documentation';
  if (lower.includes('build') || lower.includes('dist') || lower.includes('release')) return 'Build';
  if (lower.includes('research') || lower.includes('experiment') || projectLower.includes('research')) return 'Research';
  if (lower.includes('music') || lower.includes('song') || projectLower.includes('music')) return 'Music';
  if (projectLower.includes('resonate') || projectLower.includes('rezonate')) return 'Audio Engine';
  if (projectLower.includes('protogrance') || projectLower.includes('manufacturing') || projectLower.includes('cad')) return 'Manufacturing';
  return 'General';
}

function detectFileCategory(relPath) {
  const ext = relPath.split('.').pop().toLowerCase();
  const map = {
    js: 'source', ts: 'source', jsx: 'source', tsx: 'source', cpp: 'source', c: 'source', h: 'source',
    py: 'source', rs: 'source', go: 'source',
    json: 'config', yaml: 'config', yml: 'config', toml: 'config', env: 'config',
    md: 'documentation', txt: 'documentation',
    stl: 'cad-artifact', step: 'cad-artifact', f3d: 'cad-artifact', gcode: 'manufacturing-artifact',
    wav: 'audio-asset', mp3: 'audio-asset', aiff: 'audio-asset',
    pdf: 'document', png: 'asset', jpg: 'asset', svg: 'asset',
  };
  return map[ext] || 'file';
}

class BusinessSignalInterpreter {
  constructor(config = {}) {
    this.eventBus = config.eventBus || null;
    this.projectObjectives = config.projectObjectives || DEFAULT_PROJECT_OBJECTIVES;
    this.objective = config.objective || null;
    this.handledEventTypes = [
      'ProjectOpened', 'ProjectActive',
      'FileCreated', 'FileModified', 'FileDeleted',
      'DirectoryCreated', 'DirectoryDeleted',
      'CommitCreated', 'BranchCreated', 'BranchDeleted', 'BranchStale',
      'WorkingTreeDirty', 'WorkingTreeClean',
      'RevenueReceived', 'RevenueRefunded', 'InvoicePaid', 'InvoiceOverdue',
      'SubscriptionStarted', 'SubscriptionCancelled',
    ];
    if (this.eventBus) this.attach(this.eventBus);
  }

  attach(eventBus) {
    this.eventBus = eventBus;
    this._handler = (event) => {
      const signal = this.interpret(event);
      if (signal) this.publish(signal);
    };
    this.eventBus.subscribe('*', this._handler);
    this._registerWithRegistry();
  }

  _registerWithRegistry() {
    if (this.eventBus && this.eventBus.registry) {
      for (const type of this.handledEventTypes) {
        this.eventBus.registry.declareHandled(type, 'BusinessSignalInterpreter');
      }
      // BusinessSignal is a synthesized internal event consumed by the
      // Executive OS. It is not a sensor event, so register it and mark it
      // ignored so it does not register as unknown or dropped coverage.
      this.eventBus.registry.register('BusinessSignal', 'BusinessSignalInterpreter');
      this.eventBus.registry.declareIgnored('BusinessSignal', 'internal synthesized event consumed by ExecutiveOperatingSystem');
    }
  }

  detach() {
    if (this.eventBus && this._handler) this.eventBus.unsubscribe('*', this._handler);
    this._handler = null;
  }

  interpret(event) {
    if (event.type === 'BusinessSignal') return null;
    if (!this.handledEventTypes.includes(event.type)) return null;
    const p = event.payload || {};

    if (event.type.startsWith('Revenue') || event.type.startsWith('Invoice') || event.type.startsWith('Subscription')) {
      return this._interpretRevenue(event, p);
    }

    const displayProject = p.project || 'a project';
    const normalizedProject = normalizeProject(displayProject);
    const objectiveKey = Object.keys(this.projectObjectives).find((k) => normalizedProject.includes(k));
    const objective = objectiveKey ? this.projectObjectives[objectiveKey] : (this.objective || 'default');
    const relPath = p.relPath || p.path || '';
    const subsystem = p.subsystem || detectSubsystem(relPath, displayProject);
    const fileCategory = p.fileCategory || detectFileCategory(relPath);
    const interpretation = this._interpretation(event.type, { ...p, project: displayProject });
    if (interpretation === null) return null;
    return {
      type: 'BusinessSignal',
      source: 'BusinessSignalInterpreter',
      at: event.at,
      payload: {
        interpretation,
        strategicObjective: objective,
        subsystem,
        project: displayProject,
        path: p.path,
        fileCategory,
        originatingEvent: event.type,
        confidence: p.confidence || 'high',
        impact: p.impact || this._impact(event.type, fileCategory),
        meta: p,
      },
    };
  }

  _interpretRevenue(event, p) {
    const eventType = event.type || 'RevenueReceived';
    const rawAmount = Number.isFinite(p.amount) ? p.amount : 0;
    const isNegative = ['RevenueRefunded', 'SubscriptionCancelled'].includes(eventType);
    const amount = isNegative ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    const currency = p.currency || 'USD';
    const interpretation = this._interpretation(eventType, { ...p, amount, currency });
    return {
      type: 'BusinessSignal',
      source: 'BusinessSignalInterpreter',
      at: event.at,
      payload: {
        interpretation,
        strategicObjective: 'revenue',
        subsystem: 'Revenue',
        project: p.project || p.customer || 'Revenue',
        path: p.path,
        fileCategory: 'revenue',
        originatingEvent: eventType,
        confidence: p.confidence || 0.99,
        impact: this._impact(eventType, 'revenue'),
        amount,
        currency,
        customer: p.customer,
        recommendation: this._recommendation(eventType, p),
        meta: { ...p, eventType, amount },
      },
    };
  }

  publish(signal) {
    if (this.eventBus) {
      this.eventBus.emit('BusinessSignal', signal.payload, signal.source);
    }
    return signal;
  }

  _interpretation(type, p) {
    const base = p.project || 'a project';
    switch (type) {
      case 'ProjectOpened': return `Activity detected in ${base}`;
      case 'FileCreated': return `New ${p.fileCategory || 'file'} added to ${base}`;
      case 'FileModified': return `Work in progress in ${base}`;
      case 'FileDeleted': return `File removed in ${base}`;
      case 'DirectoryCreated': return `New directory created in ${base}`;
      case 'DirectoryDeleted': return `Directory removed in ${base}`;
      case 'ProjectActive': return `${base} is active again`;

      // Git events. The sensor reports facts about a repository; the meaning
      // of those facts is assigned here, so GitSensor stays free of business
      // vocabulary and the Executive OS never learns that git exists.
      case 'CommitCreated': {
        const who = p.author ? ` by ${p.author}` : '';
        const scope = p.fileCount ? ` (${p.fileCount} file${p.fileCount === 1 ? '' : 's'})` : '';
        return `Work committed to ${base}${who}${scope}: ${p.subject || 'no message'}`;
      }
      case 'BranchCreated': return `New line of work started in ${base}: branch ${p.branch}`;
      case 'BranchDeleted': return `Line of work closed in ${base}: branch ${p.branch}`;
      case 'BranchStale': {
        const days = p.staleForMs ? Math.floor(p.staleForMs / 86400000) : 0;
        return `Branch ${p.branch} in ${base} has been untouched for ${days} day${days === 1 ? '' : 's'}`;
      }
      case 'WorkingTreeDirty': {
        const n = p.fileCount || 0;
        return `Uncommitted work in ${base}: ${n} file${n === 1 ? '' : 's'} not yet committed`;
      }
      case 'WorkingTreeClean': return `${base} working tree is clean; all work is committed`;

      case 'RevenueReceived': {
        const amount = Number.isFinite(p.amount) ? p.amount : 0;
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Revenue of ${amount} ${currency} received${note}`;
      }
      case 'RevenueRefunded': {
        const amount = Math.abs(Number.isFinite(p.amount) ? p.amount : 0);
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Refund of ${amount} ${currency} issued${note}`;
      }
      case 'InvoicePaid': {
        const amount = Number.isFinite(p.amount) ? p.amount : 0;
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Invoice of ${amount} ${currency} paid${note}`;
      }
      case 'InvoiceOverdue': {
        const amount = Number.isFinite(p.amount) ? p.amount : 0;
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Invoice of ${amount} ${currency} is overdue${note}`;
      }
      case 'SubscriptionStarted': {
        const amount = Number.isFinite(p.amount) ? p.amount : 0;
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Subscription started: ${amount} ${currency}${note}`;
      }
      case 'SubscriptionCancelled': {
        const amount = Math.abs(Number.isFinite(p.amount) ? p.amount : 0);
        const currency = p.currency || 'USD';
        const note = p.description ? ` (${p.description})` : '';
        return `Subscription cancelled, recurring revenue reduced by ${amount} ${currency}${note}`;
      }

      default: return null;
    }
  }

  _impact(type, fileCategory) {
    if (type === 'RevenueReceived') return 'revenue-positive';
    if (type === 'RevenueRefunded') return 'revenue-negative';
    if (type === 'InvoicePaid') return 'revenue-positive';
    if (type === 'InvoiceOverdue') return 'revenue-risk';
    if (type === 'SubscriptionStarted') return 'revenue-positive';
    if (type === 'SubscriptionCancelled') return 'revenue-negative';
    if (type === 'BuildArtifactGenerated') return 'artifact-output';
    if (type === 'ProjectInactive') return 'risk-stale';
    if (type === 'CommitCreated') return 'engineering-delivered';
    if (type === 'BranchCreated') return 'engineering-started';
    if (type === 'BranchDeleted') return 'engineering-closed';
    if (type === 'BranchStale') return 'risk-stale';
    if (type === 'WorkingTreeDirty') return 'risk-uncommitted';
    if (type === 'WorkingTreeClean') return 'engineering-progress';
    if (fileCategory === 'cad-artifact' || fileCategory === 'manufacturing-artifact') return 'manufacturing-ready';
    if (fileCategory === 'audio-asset') return 'creative-ready';
    if (fileCategory === 'source') return 'engineering-progress';
    return 'general';
  }

  _recommendation(type, _p) {
    const map = {
      RevenueReceived: 'Record revenue in the ledger and notify the Finance agent.',
      RevenueRefunded: 'Process refund and update revenue recognition.',
      InvoicePaid: 'Mark invoice as paid and reconcile accounts.',
      InvoiceOverdue: 'Follow up on overdue invoice; cash-flow risk.',
      SubscriptionStarted: 'Add subscription to recurring revenue tracking.',
      SubscriptionCancelled: 'Cancel subscription and adjust churn forecast.',
    };
    return map[type] || null;
  }
}

module.exports = BusinessSignalInterpreter;
