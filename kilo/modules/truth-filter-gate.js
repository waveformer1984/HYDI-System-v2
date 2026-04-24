// KILO Truth Filter Gate - Ensures KILO only generates repair manifests for verified CASCADE events
// Implements the "truth filter" gate requirement

const { EventEmitter } = require('events');
const { generateFingerprint } = require('../modules/cascade-core'); // Reuse cascade's fingerprint method

class KiloTruthFilterGate extends EventEmitter {
  constructor(cascadeStateSnapshot) {
    super();
    this.cascadeStateSnapshot = cascadeStateSnapshot || {};
    this.verifiedEvents = new Set(); // Track events we've already verified
    this.eventFrequencyMap = new Map(); // Track event frequency for confidence scoring
    this.historicalRecurrenceMap = new Map(); // Track historical recurrence
  }

  // Update the CASCADE global state snapshot
  updateCascadeStateSnapshot(snapshot) {
    this.cascadeStateSnapshot = snapshot;
  }

  // Verify that a CASCADE event is valid and actionable
  verifyCascadeEvent(eventData) {
    // Check 1: Event fingerprint exists in CASCADE state
    if (!this.cascadeStateSnapshot[eventData.fingerprint]) {
      return {
        verified: false,
        reason: 'Event fingerprint not found in CASCADE state snapshot',
        confidence: 0.0
      };
    }

    // Check 2: Anomaly is still active (not resolved or quarantined)
    const eventRecord = this.cascadeStateSnapshot[eventData.fingerprint];
    if (eventRecord.resolved || eventRecord.quarantined) {
      return {
        verified: false,
        reason: 'Event is already resolved or quarantined',
        confidence: 0.0
      };
    }

    // Check 3: Event matches expected classification
    if (eventRecord.classification !== eventData.classification) {
      return {
        verified: false,
        reason: `Event classification mismatch: expected ${eventRecord.classification}, got ${eventData.classification}`,
        confidence: 0.0
      };
    }

    // All checks passed - calculate confidence score
    const confidence = this.calculateConfidenceScore(eventData);
    
    // Track this verified event
    this.verifiedEvents.add(eventData.fingerprint);
    
    return {
      verified: true,
      reason: 'Event verified and actionable',
      confidence: confidence
    };
  }

  // Calculate confidence score based on event frequency, historical recurrence, and system state severity
  calculateConfidenceScore(eventData) {
    const fingerprint = eventData.fingerprint;
    
    // Get event frequency (how often this event has occurred recently)
    const frequency = this.eventFrequencyMap.get(fingerprint) || 1;
    
    // Get historical recurrence (how often this event type has occurred historically)
    const historicalRecurrence = this.historicalRecurrenceMap.get(eventData.classification) || 1;
    
    // Get system state severity from CASCADE snapshot
    const systemState = this.cascadeStateSnapshot.systemState || 'operational';
    let severityScore = 1.0;
    
    switch (systemState) {
      case 'critical':
        severityScore = 1.0;
        break;
      case 'degraded':
        severityScore = 0.7;
        break;
      case 'operational':
      default:
        severityScore = 0.4;
        break;
    }
    
    // Calculate confidence score (weighted combination)
    // Frequency contributes 40%, historical recurrence 30%, system severity 30%
    const frequencyScore = Math.min(frequency / 10, 1.0); // Normalize frequency
    const historicalScore = Math.min(historicalRecurrence / 50, 1.0); // Normalize historical
    
    const confidence = (frequencyScore * 0.4) + (historicalScore * 0.3) + (severityScore * 0.3);
    
    // Update tracking maps
    this.eventFrequencyMap.set(fingerprint, frequency + 1);
    
    return Math.min(confidence, 1.0); // Cap at 1.0
  }

  // Update event frequency tracking
  trackEventFrequency(fingerprint) {
    const currentCount = this.eventFrequencyMap.get(fingerprint) || 0;
    this.eventFrequencyMap.set(fingerprint, currentCount + 1);
  }

  // Update historical recurrence tracking
  trackHistoricalRecurrence(classification) {
    const currentCount = this.historicalRecurrenceMap.get(classification) || 0;
    this.historicalRecurrenceMap.set(classification, currentCount + 1);
  }

  // Get confidence score for an event (without marking as verified)
  getConfidenceScore(eventData) {
    return this.calculateConfidenceScore(eventData);
  }

  // Check if we've already generated a repair manifest for this event recently
  recentlyGeneratedManifest(fingerprint, timeWindowMs = 60000) {
    // In a real implementation, we would check timestamps
    // For now, we'll use our verifiedEvents set as a simple duplicate check
    return this.verifiedEvents.has(fingerprint);
  }
}

// Factory function to create a truth filter gate instance
function createTruthFilterGate(initialCascadeState = {}) {
  return new KiloTruthFilterGate(initialCascadeState);
}

module.exports = { KiloTruthFilterGate, createTruthFilterGate };