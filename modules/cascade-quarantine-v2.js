// CASCADE Quarantine V2 - With dead-letter finality
// Permanent storage for events exceeding retry threshold

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class CascadeQuarantineV2 extends EventEmitter {
  constructor() {
    super();
    this.quarantinedEvents = new Map();
    this.deadLetterEvents = new Map();
    this.retryPolicies = new Map();
    this.maxQuarantineSize = 1000;
    this.cleanupInterval = null;
    
    // Dead-letter storage
    this.deadLetterPath = path.join(__dirname, '../data/dead-letters.json');
    this.deadLetterMaxMemory = 100; // Keep last 100 in memory
    
    this.initializeRetryPolicies();
    this.startCleanupTimer();
    this.loadDeadLetters();
  }

  // Quarantine an event
  quarantine(event, reason, metadata = {}) {
    const quarantineRecord = {
      event_id: event.event_id,
      event: event,
      reason: reason,
      metadata: metadata,
      quarantined_at: new Date().toISOString(),
      retry_count: 0,
      last_retry: null,
      next_retry: null,
      status: 'quarantined', // quarantined | retrying | released | dead_letter
      dead_letter_reason: null
    };

    // Check quarantine size limit
    if (this.quarantinedEvents.size >= this.maxQuarantineSize) {
      this.evictOldest();
    }

    this.quarantinedEvents.set(event.event_id, quarantineRecord);
    
    // Set next retry time based on policy
    const policy = this.retryPolicies.get(reason);
    if (policy) {
      quarantineRecord.next_retry = this.calculateNextRetry(
        quarantineRecord.quarantined_at, 
        policy, 
        0
      );
    }

    this.emit('event_quarantined', quarantineRecord);
    
    return quarantineRecord;
  }

  // Attempt to release from quarantine
  async attemptRelease(eventId) {
    const record = this.quarantinedEvents.get(eventId);
    
    if (!record) {
      throw new Error(`Event ${eventId} not found in quarantine`);
    }

    if (record.status !== 'quarantined') {
      return { status: record.status, record };
    }

    // Check if it's time to retry
    const now = new Date();
    const nextRetry = new Date(record.next_retry);
    
    if (now < nextRetry) {
      return { 
        status: 'not_ready', 
        next_retry: record.next_retry,
        record 
      };
    }

    // Mark as retrying
    record.status = 'retrying';
    record.retry_count++;
    record.last_retry = now.toISOString();

    // Check retry limit (5 attempts = dead letter)
    const policy = this.retryPolicies.get(record.reason);
    if (record.retry_count >= policy.maxRetries) {
      return this.sendToDeadLetter(record, 'max_retries_exceeded');
    }

    // Emit for reprocessing
    this.emit('release_attempt', record);
    
    return { status: 'retrying', record };
  }

  // Send to dead-letter storage
  async sendToDeadLetter(record, reason) {
    const deadLetterRecord = {
      ...record,
      dead_letter_at: new Date().toISOString(),
      dead_letter_reason: reason,
      original_quarantine_reason: record.reason,
      total_retries: record.retry_count,
      final_failure: true
    };

    // Add to dead letter storage
    this.deadLetterEvents.set(record.event_id, deadLetterRecord);
    
    // Remove from active quarantine
    this.quarantinedEvents.delete(record.event_id);
    
    // Persist to disk
    await this.persistDeadLetter(deadLetterRecord);
    
    // Update record status
    record.status = 'dead_letter';
    record.dead_letter_reason = reason;
    
    this.emit('event_dead_lettered', deadLetterRecord);
    
    return { status: 'dead_letter', record: deadLetterRecord };
  }

  // Persist dead letter to disk
  async persistDeadLetter(record) {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.deadLetterPath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Read existing dead letters
      let deadLetters = [];
      try {
        const data = await fs.readFile(this.deadLetterPath, 'utf8');
        deadLetters = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet
      }
      
      // Add new dead letter
      deadLetters.push(record);
      
      // Keep only last 1000 dead letters in file
      if (deadLetters.length > 1000) {
        deadLetters = deadLetters.slice(-1000);
      }
      
      // Write back to file
      await fs.writeFile(
        this.deadLetterPath, 
        JSON.stringify(deadLetters, null, 2),
        'utf8'
      );
      
      // Keep only last 100 in memory
      if (this.deadLetterEvents.size > this.deadLetterMaxMemory) {
        const oldest = Array.from(this.deadLetterEvents.keys())[0];
        this.deadLetterEvents.delete(oldest);
      }
      
      console.log(`[QUARANTINE] Event ${record.event_id} sent to dead letter: ${reason}`);
      
    } catch (error) {
      console.error('[QUARANTINE] Failed to persist dead letter:', error);
    }
  }

  // Load dead letters from disk
  async loadDeadLetters() {
    try {
      const data = await fs.readFile(this.deadLetterPath, 'utf8');
      const deadLetters = JSON.parse(data);
      
      // Load most recent into memory
      const recent = deadLetters.slice(-this.deadLetterMaxMemory);
      recent.forEach(record => {
        this.deadLetterEvents.set(record.event_id, record);
      });
      
      console.log(`[QUARANTINE] Loaded ${recent.length} dead letters from disk`);
      
    } catch (error) {
      // File doesn't exist yet, which is fine
      console.log('[QUARANTINE] No existing dead letters file');
    }
  }

  // Manual release (for admin intervention)
  manualRelease(eventId, approvedBy) {
    const record = this.quarantinedEvents.get(eventId);
    
    if (!record) {
      throw new Error(`Event ${eventId} not found in quarantine`);
    }

    record.status = 'released';
    record.released_at = new Date().toISOString();
    record.released_by = approvedBy;

    this.emit('event_released', record);
    
    return record;
  }

  // Calculate next retry time
  calculateNextRetry(lastAttempt, policy, retryCount) {
    const base = new Date(lastAttempt);
    let delay = policy.baseDelay;

    // Apply exponential backoff if enabled
    if (policy.exponentialBackoff) {
      delay = delay * Math.pow(2, retryCount);
    }

    // Apply jitter if enabled
    if (policy.jitter) {
      const jitterAmount = delay * policy.jitter;
      delay = delay + (Math.random() * jitterAmount * 2 - jitterAmount);
    }

    // Cap at max delay
    delay = Math.min(delay, policy.maxDelay);

    return new Date(base.getTime() + delay).toISOString();
  }

  // Initialize retry policies (max 5 retries)
  initializeRetryPolicies() {
    // unstable_pattern_detected
    this.retryPolicies.set('unstable_pattern_detected', {
      maxRetries: 5,
      baseDelay: 60000, // 1 minute
      maxDelay: 300000, // 5 minutes
      exponentialBackoff: true,
      jitter: 0.1
    });

    // validation_failed
    this.retryPolicies.set('validation_failed', {
      maxRetries: 3,
      baseDelay: 30000, // 30 seconds
      maxDelay: 120000, // 2 minutes
      exponentialBackoff: true,
      jitter: 0.05
    });

    // duplicate_event
    this.retryPolicies.set('duplicate_event', {
      maxRetries: 1,
      baseDelay: 10000, // 10 seconds
      maxDelay: 60000, // 1 minute
      exponentialBackoff: false,
      jitter: 0
    });

    // system_overload
    this.retryPolicies.set('system_overload', {
      maxRetries: 5,
      baseDelay: 120000, // 2 minutes
      maxDelay: 600000, // 10 minutes
      exponentialBackoff: true,
      jitter: 0.2
    });

    // manual_review_required - no automatic retries
    this.retryPolicies.set('manual_review_required', {
      maxRetries: 0,
      baseDelay: 0,
      maxDelay: 0,
      exponentialBackoff: false,
      jitter: 0
    });
  }

  // Get events ready for retry
  getEventsReadyForRetry() {
    const ready = [];
    const now = new Date();

    this.quarantinedEvents.forEach((record, eventId) => {
      if (record.status === 'quarantined' && record.next_retry) {
        const nextRetry = new Date(record.next_retry);
        if (now >= nextRetry) {
          ready.push(record);
        }
      }
    });

    return ready;
  }

  // Evict oldest event when quarantine is full
  evictOldest() {
    let oldest = null;
    let oldestTime = null;

    this.quarantinedEvents.forEach((record, eventId) => {
      if (!oldest || record.quarantined_at < oldestTime) {
        oldest = eventId;
        oldestTime = record.quarantined_at;
      }
    });

    if (oldest) {
      const evicted = this.quarantinedEvents.get(oldest);
      this.quarantinedEvents.delete(oldest);
      this.emit('event_evicted', evicted);
    }
  }

  // Start cleanup timer
  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEvents();
    }, 60000); // Every minute
  }

  // Clean up expired events
  cleanupExpiredEvents() {
    const now = new Date();
    const expired = [];

    this.quarantinedEvents.forEach((record, eventId) => {
      // Remove events older than 24 hours
      const quarantineAge = now - new Date(record.quarantined_at);
      if (quarantineAge > 24 * 60 * 60 * 1000) {
        expired.push(eventId);
      }
    });

    expired.forEach(eventId => {
      const record = this.quarantinedEvents.get(eventId);
      this.quarantinedEvents.delete(eventId);
      this.emit('event_expired', record);
    });
  }

  // Get quarantine statistics
  getStats() {
    const stats = {
      total_quarantined: this.quarantinedEvents.size,
      dead_letter_count: this.deadLetterEvents.size,
      by_status: {},
      by_reason: {},
      oldest_event: null,
      newest_event: null
    };

    let oldest = null;
    let newest = null;

    this.quarantinedEvents.forEach((record) => {
      // Count by status
      stats.by_status[record.status] = (stats.by_status[record.status] || 0) + 1;
      
      // Count by reason
      stats.by_reason[record.reason] = (stats.by_reason[record.reason] || 0) + 1;
      
      // Track oldest and newest
      if (!oldest || record.quarantined_at < oldest) {
        oldest = record.quarantined_at;
      }
      if (!newest || record.quarantined_at > newest) {
        newest = record.quarantined_at;
      }
    });

    stats.oldest_event = oldest;
    stats.newest_event = newest;
    stats.ready_for_retry = this.getEventsReadyForRetry().length;

    return stats;
  }

  // Get detailed quarantine report
  getReport(limit = 50) {
    const events = Array.from(this.quarantinedEvents.values())
      .sort((a, b) => new Date(b.quarantined_at) - new Date(a.quarantined_at))
      .slice(0, limit);

    return {
      summary: this.getStats(),
      events: events,
      dead_letters: this.getDeadLetterReport(10),
      generated_at: new Date().toISOString()
    };
  }

  // Get dead letter report
  getDeadLetterReport(limit = 50) {
    const deadLetters = Array.from(this.deadLetterEvents.values())
      .sort((a, b) => new Date(b.dead_letter_at) - new Date(a.dead_letter_at))
      .slice(0, limit);

    return {
      count: this.deadLetterEvents.size,
      events: deadLetters.map(record => ({
        event_id: record.event_id,
        original_reason: record.original_quarantine_reason,
        dead_letter_reason: record.dead_letter_reason,
        total_retries: record.total_retries,
        dead_letter_at: record.dead_letter_at
      }))
    };
  }

  // Clear dead letters
  async clearDeadLetters() {
    this.deadLetterEvents.clear();
    
    try {
      await fs.unlink(this.deadLetterPath);
      console.log('[QUARANTINE] Dead letters file cleared');
    } catch (error) {
      // File doesn't exist
    }
  }

  // Stop quarantine system
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

module.exports = CascadeQuarantineV2;
