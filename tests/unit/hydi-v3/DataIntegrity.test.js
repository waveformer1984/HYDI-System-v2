'use strict';

const {
  DataIntegrityError, normalizeRisk, normalizeUnitInterval, normalizeValue, normalizeEffort, normalizeEntity, validateEntity,
} = require('../../../src/hydi-v3/DataIntegrity');

describe('DataIntegrity', () => {
  test('normalizes risk from 0-1 scale', () => {
    expect(normalizeRisk(0.2)).toBe(0.2);
    expect(normalizeRisk(1)).toBe(1);
    expect(normalizeRisk(0)).toBe(0);
  });

  test('normalizes risk from 1-5 scale', () => {
    expect(normalizeRisk(1, '1-5')).toBe(0);
    expect(normalizeRisk(3, '1-5')).toBe(0.5);
    expect(normalizeRisk(5, '1-5')).toBe(1);
  });

  test('normalizes risk from 1-10 scale', () => {
    expect(normalizeRisk(1, '1-10')).toBe(0);
    expect(normalizeRisk(5, '1-10')).toBeCloseTo(0.444, 3);
    expect(normalizeRisk(10, '1-10')).toBe(1);
  });

  test('normalizes risk from 0-100% string', () => {
    expect(normalizeRisk('50%')).toBe(0.5);
    expect(normalizeRisk('0%')).toBe(0);
    expect(normalizeRisk('100%')).toBe(1);
  });

  test('normalizes textual risk', () => {
    expect(normalizeRisk('low')).toBe(0);
    expect(normalizeRisk('medium')).toBe(0.5);
    expect(normalizeRisk('high')).toBe(1);
  });

  test('auto-detects integer 1-5 and 1-10 scales', () => {
    expect(normalizeRisk(5)).toBe(1); // 1-5 => 1
    expect(normalizeRisk(7)).toBeCloseTo(0.667, 3); // 1-10
    expect(normalizeRisk(50)).toBe(0.5); // percent
  });

  test('rejects out-of-range risk values', () => {
    expect(() => normalizeRisk(150)).toThrow(DataIntegrityError);
    expect(() => normalizeRisk(-0.1)).toThrow(DataIntegrityError);
    expect(() => normalizeRisk('unknown')).toThrow(DataIntegrityError);
  });

  test('normalizes probability, confidence, and strategic', () => {
    expect(normalizeUnitInterval(0.9, 'probability')).toBe(0.9);
    expect(normalizeUnitInterval('80%', 'confidence')).toBe(0.8);
    expect(normalizeUnitInterval(20, 'strategic')).toBe(0.2);
    expect(() => normalizeUnitInterval(200, 'probability')).toThrow(DataIntegrityError);
  });

  test('normalizes currency and numeric values', () => {
    expect(normalizeValue('$1,250', 'value')).toBe(1250);
    expect(normalizeValue('500')).toBe(500);
    expect(() => normalizeValue('-100')).toThrow(DataIntegrityError);
    expect(() => normalizeValue('abc')).toThrow(DataIntegrityError);
  });

  test('normalizes effort to at least 1', () => {
    expect(normalizeEffort(0)).toBe(1);
    expect(normalizeEffort(3)).toBe(3);
    expect(() => normalizeEffort('abc')).toThrow(DataIntegrityError);
  });

  test('normalizeEntity converts all accepted risk formats', () => {
    const entity = {
      type: 'opportunity',
      name: 'Big Deal',
      value: '$10,000',
      effort: 2,
      risk: 'high',
      probability: '80%',
      confidence: '90%',
      strategic: '20%',
      tags: ['resonate'],
    };
    const n = normalizeEntity(entity);
    expect(n.value).toBe(10000);
    expect(n.risk).toBe(1);
    expect(n.probability).toBe(0.8);
    expect(n.confidence).toBe(0.9);
    expect(n.strategic).toBe(0.2);
    expect(n.effort).toBe(2);
  });

  test('validateEntity throws clear errors for invalid fields', () => {
    expect(() => validateEntity({ type: 'unknown', name: 'x' })).toThrow(DataIntegrityError);
    expect(() => validateEntity({ type: 'opportunity', name: '', value: 100 })).toThrow(DataIntegrityError);
    expect(() => validateEntity({ type: 'opportunity', name: 'x', value: -1 })).toThrow(DataIntegrityError);
    expect(() => validateEntity({ type: 'opportunity', name: 'x', value: 100, effort: 0.5, risk: 2 })).toThrow(DataIntegrityError);
  });
});
