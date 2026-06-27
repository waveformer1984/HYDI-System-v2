#!/usr/bin/env node

// Test various confidence levels for non-sensitive tasks
const testCases = [
  { confidence: 0.92, withinBounds: true, expected: 'AUTO-APPROVE', label: 'High confidence + within bounds' },
  { confidence: 0.80, withinBounds: true, expected: 'REVIEW', label: 'Below threshold (80% < 85%)' },
  { confidence: 0.40, withinBounds: true, expected: 'BLOCK', label: 'Low confidence (40% < 50%)' },
  { confidence: 0.85, withinBounds: false, expected: 'REVIEW', label: 'High confidence but OUT of bounds' },
];

const threshold = 0.85;
const sensitiveDivisions = ['financial', 'crypto', 'vendor'];

console.log('Testing confidence gate for NON-SENSITIVE tasks (e.g., "deployment"):');
console.log('─'.repeat(80));

let passCount = 0;
let failCount = 0;

testCases.forEach(test => {
  const originalConfidence = test.confidence;
  let verdict = '';
  let reason = '';

  if (sensitiveDivisions.includes('deployment')) {
    verdict = 'REVIEW';
    reason = 'Sensitive division';
  } else if (originalConfidence >= threshold && test.withinBounds) {
    verdict = 'AUTO-APPROVE';
    reason = `${(originalConfidence * 100).toFixed(0)}% confidence + within bounds`;
  } else if (originalConfidence < 0.5) {
    verdict = 'BLOCK';
    reason = `Low confidence ${(originalConfidence * 100).toFixed(0)}%`;
  } else {
    verdict = 'REVIEW';
    reason = `${(originalConfidence * 100).toFixed(0)}% confidence, below ${(threshold * 100).toFixed(0)}% threshold`;
  }

  const pass = verdict === test.expected;
  if (pass) passCount++; else failCount++;

  console.log(`Test: ${test.label}`);
  console.log(`  Input: confidence=${(originalConfidence * 100).toFixed(0)}%, within_bounds=${test.withinBounds}`);
  console.log(`  Expected: ${test.expected}, Actual: ${verdict}`);
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
});

console.log('─'.repeat(80));
console.log(`Summary: ${passCount}/${passCount + failCount} passed`);
console.log('');
console.log(failCount === 0 ? '✅ All confidence gate tests passed!' : `❌ ${failCount} test(s) failed!`);
