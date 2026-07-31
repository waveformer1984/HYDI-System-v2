'use strict';

class DataIntegrityError extends Error {
  constructor(errors) {
    super(`Data integrity error: ${errors.join('; ')}`);
    this.errors = errors;
  }
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isNaN(value) ? NaN : value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,%\s]/g, '');
    const n = Number(cleaned);
    return Number.isNaN(n) ? NaN : n;
  }
  return NaN;
}

function normalizeRisk(value, scaleHint = 'auto') {
  if (value === undefined || value === null) return 0;

  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['low', 'lo', 'l'].includes(s)) return 0;
    if (['medium', 'med', 'm'].includes(s)) return 0.5;
    if (['high', 'hi', 'h'].includes(s)) return 1;
    if (s.endsWith('%')) return clamp(toNumber(s) / 100, 0, 1);
    const n = toNumber(s);
    if (Number.isNaN(n)) throw new DataIntegrityError([`Risk "${value}" is not a recognized risk value`]);
    return normalizeRisk(n, scaleHint);
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    if (scaleHint === '1-5') return clamp((value - 1) / 4, 0, 1);
    if (scaleHint === '1-10') return clamp((value - 1) / 9, 0, 1);
    if (scaleHint === 'percent') return clamp(value / 100, 0, 1);
    if (value >= 0 && value <= 1) return clamp(value, 0, 1);
    if (Number.isInteger(value)) {
      if (value >= 1 && value <= 5) return clamp((value - 1) / 4, 0, 1);
      if (value >= 6 && value <= 10) return clamp((value - 1) / 9, 0, 1);
      if (value >= 0 && value <= 100) return clamp(value / 100, 0, 1);
    }
    if (value > 1 && value <= 100) return clamp(value / 100, 0, 1);
    throw new DataIntegrityError([`Risk ${value} is outside accepted 0-1, 1-5, 1-10, or 0-100% range`]);
  }

  throw new DataIntegrityError([`Risk ${value} has unsupported type`]);
}

function normalizeUnitInterval(value, field = 'value') {
  if (value === undefined || value === null) return 1;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['low', 'lo', 'l'].includes(s)) return 0;
    if (['medium', 'med', 'm'].includes(s)) return 0.5;
    if (['high', 'hi', 'h'].includes(s)) return 1;
    if (s.endsWith('%')) return clamp(toNumber(s) / 100, 0, 1);
    const n = toNumber(s);
    if (Number.isNaN(n)) throw new DataIntegrityError([`${field} "${value}" is not a valid unit-interval value`]);
    return normalizeUnitInterval(n, field);
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    if (value >= 0 && value <= 1) return clamp(value, 0, 1);
    if (value >= 0 && value <= 100) return clamp(value / 100, 0, 1);
    throw new DataIntegrityError([`${field} ${value} is outside accepted 0-1 or 0-100% range`]);
  }
  throw new DataIntegrityError([`${field} ${value} has unsupported type`]);
}

function normalizeValue(value, field = 'value') {
  if (value === undefined || value === null) return 0;
  const n = toNumber(value);
  if (Number.isNaN(n)) throw new DataIntegrityError([`${field} "${value}" is not a valid number`]);
  if (n < 0) throw new DataIntegrityError([`${field} ${n} cannot be negative`]);
  return n;
}

function normalizeEffort(value) {
  if (value === undefined || value === null) return 1;
  const n = toNumber(value);
  if (Number.isNaN(n)) throw new DataIntegrityError([`Effort "${value}" is not a valid number`]);
  if (n < 0) throw new DataIntegrityError([`Effort ${n} cannot be negative`]);
  return Math.max(n, 1);
}

function normalizeEntity(entity) {
  const scaleHint = entity.riskScale || 'auto';
  const normalized = {
    ...entity,
    value: normalizeValue(entity.value, 'value'),
    cost: entity.cost !== undefined ? normalizeValue(entity.cost, 'cost') : undefined,
    revenue: entity.revenue !== undefined ? normalizeValue(entity.revenue, 'revenue') : undefined,
    effort: normalizeEffort(entity.effort),
    risk: normalizeRisk(entity.risk, scaleHint),
    probability: entity.probability !== undefined ? normalizeUnitInterval(entity.probability, 'probability') : undefined,
    confidence: entity.confidence !== undefined ? normalizeUnitInterval(entity.confidence, 'confidence') : undefined,
    strategic: entity.strategic !== undefined ? normalizeUnitInterval(entity.strategic, 'strategic') : undefined,
  };
  return normalized;
}

const VALID_TYPES = new Set(['project', 'client', 'vendor', 'equipment', 'opportunity', 'task', 'decision', 'activity']);

function validateEntity(entity) {
  const errors = [];
  if (!entity.type || !VALID_TYPES.has(entity.type)) errors.push(`Unknown or missing entity type: ${entity.type}`);
  if (typeof entity.name !== 'string' || entity.name.trim() === '') errors.push('Entity name must be a non-empty string');
  if (Number.isNaN(entity.value) || entity.value < 0) errors.push('value must be a non-negative number');
  if (Number.isNaN(entity.effort) || entity.effort < 1) errors.push('effort must be at least 1');
  if (Number.isNaN(entity.risk) || entity.risk < 0 || entity.risk > 1) errors.push('risk must be normalized to 0-1');
  if (entity.probability !== undefined && (Number.isNaN(entity.probability) || entity.probability < 0 || entity.probability > 1)) errors.push('probability must be 0-1');
  if (entity.confidence !== undefined && (Number.isNaN(entity.confidence) || entity.confidence < 0 || entity.confidence > 1)) errors.push('confidence must be 0-1');
  if (entity.strategic !== undefined && (Number.isNaN(entity.strategic) || entity.strategic < 0 || entity.strategic > 1)) errors.push('strategic must be 0-1');
  if (entity.cost !== undefined && (Number.isNaN(entity.cost) || entity.cost < 0)) errors.push('cost must be non-negative');
  if (entity.revenue !== undefined && (Number.isNaN(entity.revenue) || entity.revenue < 0)) errors.push('revenue must be non-negative');
  if (entity.tags !== undefined && !Array.isArray(entity.tags)) errors.push('tags must be an array');
  if (errors.length > 0) throw new DataIntegrityError(errors);
}

module.exports = {
  DataIntegrityError,
  normalizeRisk,
  normalizeUnitInterval,
  normalizeValue,
  normalizeEffort,
  normalizeEntity,
  validateEntity,
  VALID_TYPES,
};
