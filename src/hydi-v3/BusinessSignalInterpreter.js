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
    if (this.eventBus) this.attach(this.eventBus);
  }

  attach(eventBus) {
    this.eventBus = eventBus;
    this._handler = (event) => {
      const signal = this.interpret(event);
      if (signal) this.publish(signal);
    };
    this.eventBus.subscribe('*', this._handler);
  }

  detach() {
    if (this.eventBus && this._handler) this.eventBus.unsubscribe('*', this._handler);
    this._handler = null;
  }

  interpret(event) {
    if (event.type === 'BusinessSignal') return null;
    const p = event.payload || {};
    const displayProject = p.project || 'a project';
    const normalizedProject = normalizeProject(displayProject);
    const objectiveKey = Object.keys(this.projectObjectives).find((k) => normalizedProject.includes(k));
    const objective = objectiveKey ? this.projectObjectives[objectiveKey] : (this.objective || 'default');
    const relPath = p.relPath || p.path || '';
    const subsystem = p.subsystem || detectSubsystem(relPath, displayProject);
    const fileCategory = p.fileCategory || detectFileCategory(relPath);
    const interpretation = this._interpretation(event.type, { ...p, project: displayProject });
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
      case 'BuildArtifactGenerated': return `Build artifact generated in ${base}`;
      case 'ProjectInactive': return `${base} has been inactive`;
      case 'ProjectActive': return `${base} is active again`;
      default: return `Activity in ${base}`;
    }
  }

  _impact(type, fileCategory) {
    if (type === 'BuildArtifactGenerated') return 'artifact-output';
    if (type === 'ProjectInactive') return 'risk-stale';
    if (fileCategory === 'cad-artifact' || fileCategory === 'manufacturing-artifact') return 'manufacturing-ready';
    if (fileCategory === 'audio-asset') return 'creative-ready';
    if (fileCategory === 'source') return 'engineering-progress';
    return 'general';
  }
}

module.exports = BusinessSignalInterpreter;
