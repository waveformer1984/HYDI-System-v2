'use strict';

const fs = require('fs');
const path = require('path');
const { getCapability, isKnownCapability } = require('../execution-fabric/capabilities');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'specialists.json');

const FORBIDDEN_RISK = new Set(['build']);
const FORBIDDEN_ADAPTER_CONFIRM = new Set(['evolution.execute', 'evolution.rollback', 'evolution.execute_async']);

function loadSpecialistConfig(configPath = DEFAULT_CONFIG) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!raw.templates || typeof raw.templates !== 'object') {
    throw new Error('specialists.json missing templates');
  }
  return raw;
}

function capabilityAllowed(capId, config) {
  if (!isKnownCapability(capId)) return { ok: false, error: 'unknown_capability' };
  const cap = getCapability(capId);
  const forbiddenPerms = config.forbidden_capability_permissions || [];
  if (forbiddenPerms.includes(cap.permission)) return { ok: false, error: 'forbidden_permission' };
  if (FORBIDDEN_RISK.has(cap.risk)) return { ok: false, error: 'forbidden_risk' };
  if (cap.confirmRequired && FORBIDDEN_ADAPTER_CONFIRM.has(capId)) return { ok: false, error: 'confirm_exec' };
  for (const prefix of config.forbidden_capability_prefixes || []) {
    if (capId === prefix || capId.startsWith(`${prefix}.`) || capId.startsWith(prefix)) {
      return { ok: false, error: 'forbidden_prefix' };
    }
  }
  if (cap.permission === 'fabric:control') return { ok: false, error: 'fabric_control' };
  return { ok: true, cap };
}

function validateTemplate(templateId, template, config) {
  const errors = [];
  if (!template || typeof template !== 'object') errors.push('invalid_template');
  if (!Array.isArray(template.allowed_capabilities) || !template.allowed_capabilities.length) {
    errors.push('no_capabilities');
  }
  for (const capId of template.allowed_capabilities || []) {
    const v = capabilityAllowed(capId, config);
    if (!v.ok) errors.push(`${capId}:${v.error}`);
  }
  if (template.llm === true) {
    const hasLlm = (template.allowed_capabilities || []).some((c) => c === 'pool.llm_complete' || c === 'pool.verify_evidence');
    if (!hasLlm && !(template.allowed_capabilities || []).includes('pool.llm_complete')) {
      /* verifier may use verify only */
    }
  }
  const mc = Number(template.max_clones);
  const budget = Number(template.per_day_task_budget);
  const timeout = Number(template.per_task_timeout_ms);
  if (!Number.isFinite(mc) || mc < 1 || mc > 32) errors.push('max_clones');
  if (!Number.isFinite(budget) || budget < 1) errors.push('per_day_task_budget');
  if (!Number.isFinite(timeout) || timeout < 1000) errors.push('per_task_timeout_ms');
  return { ok: errors.length === 0, errors, templateId };
}

function validateAllTemplates(configPath = DEFAULT_CONFIG) {
  const config = loadSpecialistConfig(configPath);
  const results = [];
  for (const [id, tpl] of Object.entries(config.templates)) {
    results.push(validateTemplate(id, tpl, config));
  }
  const ok = results.every((r) => r.ok);
  return { ok, results, config };
}

function getTemplate(templateId, configPath = DEFAULT_CONFIG) {
  const v = validateAllTemplates(configPath);
  if (!v.ok) throw new Error('invalid specialist templates');
  const tpl = v.config.templates[templateId];
  if (!tpl) return null;
  return { id: templateId, ...tpl };
}

function cloneMayUseCapability(templateId, capabilityId, configPath = DEFAULT_CONFIG) {
  const v = validateAllTemplates(configPath);
  const tpl = v.config.templates[templateId];
  if (!tpl) return { ok: false, error: 'unknown_template' };
  if (!(tpl.allowed_capabilities || []).includes(capabilityId)) {
    return { ok: false, error: 'capability_not_in_template' };
  }
  return capabilityAllowed(capabilityId, v.config);
}

const BLOCKED_POOL_CAPABILITIES = Object.freeze(['pool.mission_enqueue', 'pool.spawn_clone', 'pool.enqueue_mission']);

function assertNotCloneForbidden(capabilityId) {
  if (BLOCKED_POOL_CAPABILITIES.includes(capabilityId)) {
    return { ok: false, error: 'clone_forbidden_capability' };
  }
  return { ok: true };
}

module.exports = {
  loadSpecialistConfig,
  validateAllTemplates,
  getTemplate,
  cloneMayUseCapability,
  capabilityAllowed,
  assertNotCloneForbidden,
  BLOCKED_POOL_CAPABILITIES,
  DEFAULT_CONFIG,
};