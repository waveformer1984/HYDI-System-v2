// Event Ledger - Persistence Truth Finalization Layer
// Accepts validated + classified events, guarantees persistence success/failure state
// Retries or quarantines failures

const { EventEmitter } = require('events');

class EventLedger extends EventEmitter {
  constructor() {
    super();
    
    // Persistence state tracking
    this.persistenceQueue = [];
    this.quarantinedEvents = [];
    this.retryAttempts = new Map(); // event_id -> retry_count
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    
    // Statistics
    this.stats = {
      total_events: 0,
      stored_successfully: 0,
      quarantined: 0,
      retried: 0,
      persistence_failures: 0
    };
    
    // Start retry processor
    this.startRetryProcessor();
  }

  /**
   * Store event with guaranteed persistence state
   */
  async storeEvent(event, classification, opportunity) {
    this.stats.total_events++;
    
    const ledgerEntry = {
      event_id: event.event_id,
      event: event,
      classification: classification,
      opportunity: opportunity,
      timestamp: new Date().toISOString(),
      persistence_status: 'PENDING',
      retry_count: 0,
      created_at: new Date().toISOString()
    };
    
    try {
      // Attempt immediate persistence
      const success = await this.attemptPersistence(ledgerEntry);
      
      if (success) {
        this.stats.stored_successfully++;
        ledgerEntry.persistence_status = 'STORED';
        this.emit('event_stored', ledgerEntry);
        return {
          status: 'STORED',
          event_id: event.event_id,
          ledger_entry: ledgerEntry
        };
      } else {
        // Add to retry queue
        this.persistenceQueue.push(ledgerEntry);
        ledgerEntry.persistence_status = 'QUEUED_FOR_RETRY';
        this.emit('event_queued', ledgerEntry);
        return {
          status: 'QUEUED_FOR_RETRY',
          event_id: event.event_id,
          ledger_entry: ledgerEntry
        };
      }
      
    } catch (error) {
      console.error(`EventLedger: Critical failure for event ${event.event_id}:`, error);
      this.quarantineEvent(ledgerEntry, error);
      return {
        status: 'QUARANTINED',
        event_id: event.event_id,
        error: error.message,
        ledger_entry: ledgerEntry
      };
    }
  }

  /**
   * Attempt persistence to database
   */
  async attemptPersistence(ledgerEntry) {
    try {
      // Import the single Supabase client
      const { supabase } = require('../src/database');
      
      // Store original event
      const { data, error } = await supabase
        .from('hydi_events')
        .upsert({
          event_id: ledgerEntry.event.event_id,
          type: ledgerEntry.event.type,
          payload: ledgerEntry.event.payload,
          processed: true,
          classification: ledgerEntry.classification,
          stored_at: new Date().toISOString()
        }, {
          onConflict: 'event_id'
        })
        .select();
      
      if (error) throw error;
      
      // Store opportunity if exists
      if (ledgerEntry.opportunity) {
        const { error: oppError } = await supabase
          .from('hydi_events')
          .upsert({
            event_id: ledgerEntry.opportunity.event_id,
            type: ledgerEntry.opportunity.type,
            payload: ledgerEntry.opportunity.payload,
            processed: false,
            parent_event_id: ledgerEntry.event.event_id,
            stored_at: new Date().toISOString()
          }, {
            onConflict: 'event_id'
          });
        
        if (oppError) throw oppError;
      }
      
      console.log(`EventLedger: Successfully stored event ${ledgerEntry.event_id}`);
      return true;
      
    } catch (error) {
      console.error(`EventLedger: Persistence failed for event ${ledgerEntry.event_id}:`, error);
      this.stats.persistence_failures++;
      return false;
    }
  }

  /**
   * Retry processor for failed events
   */
  startRetryProcessor() {
    setInterval(() => {
      this.processRetryQueue();
    }, this.retryDelay);
  }

  /**
   * Process retry queue
   */
  async processRetryQueue() {
    if (this.persistenceQueue.length === 0) return;
    
    const eventsToRetry = this.persistenceQueue.splice(0, 5); // Process 5 at a time
    
    for (const ledgerEntry of eventsToRetry) {
      ledgerEntry.retry_count++;
      this.stats.retried++;
      
      if (ledgerEntry.retry_count > this.maxRetries) {
        this.quarantineEvent(ledgerEntry, new Error('Max retries exceeded'));
        continue;
      }
      
      const success = await this.attemptPersistence(ledgerEntry);
      
      if (success) {
        this.stats.stored_successfully++;
        ledgerEntry.persistence_status = 'STORED';
        this.emit('event_stored_after_retry', ledgerEntry);
      } else {
        // Put back in queue for later retry
        this.persistenceQueue.push(ledgerEntry);
        this.emit('event_retry_failed', ledgerEntry);
      }
    }
  }

  /**
   * Quarantine event that cannot be stored
   */
  quarantineEvent(ledgerEntry, error) {
    ledgerEntry.persistence_status = 'QUARANTINED';
    ledgerEntry.quarantine_reason = error.message;
    ledgerEntry.quarantined_at = new Date().toISOString();
    
    this.quarantinedEvents.push(ledgerEntry);
    this.stats.quarantined++;
    
    this.emit('event_quarantined', ledgerEntry);
    console.error(`EventLedger: Event ${ledgerEntry.event_id} quarantined:`, error.message);
  }

  /**
   * Get ledger statistics
   */
  getStats() {
    return {
      ...this.stats,
      queue_size: this.persistenceQueue.length,
      quarantined_count: this.quarantinedEvents.length,
      success_rate: this.stats.total_events > 0 ? 
        this.stats.stored_successfully / this.stats.total_events : 0,
      failure_rate: this.stats.total_events > 0 ? 
        (this.stats.quarantined + this.stats.persistence_failures) / this.stats.total_events : 0
    };
  }

  /**
   * Get quarantined events
   */
  getQuarantinedEvents() {
    return this.quarantinedEvents.map(event => ({
      event_id: event.event_id,
      quarantine_reason: event.quarantine_reason,
      retry_count: event.retry_count,
      quarantined_at: event.quarantined_at
    }));
  }

  /**
   * Get retry queue status
   */
  getRetryQueueStatus() {
    return {
      queue_size: this.persistenceQueue.length,
      events_in_queue: this.persistenceQueue.map(event => ({
        event_id: event.event_id,
        retry_count: event.retry_count,
        created_at: event.created_at
      }))
    };
  }

  /**
   * Manual retry for quarantined events
   */
  async retryQuarantinedEvent(eventId) {
    const quarantinedIndex = this.quarantinedEvents.findIndex(
      event => event.event_id === eventId
    );
    
    if (quarantinedIndex === -1) {
      throw new Error(`Event ${eventId} not found in quarantine`);
    }
    
    const ledgerEntry = this.quarantinedEvents.splice(quarantinedIndex, 1)[0];
    ledgerEntry.retry_count = 0;
    ledgerEntry.persistence_status = 'PENDING';
    
    const success = await this.attemptPersistence(ledgerEntry);
    
    if (success) {
      this.stats.stored_successfully++;
      ledgerEntry.persistence_status = 'STORED';
      this.emit('event_stored_after_manual_retry', ledgerEntry);
      return { status: 'STORED', event_id: eventId };
    } else {
      // Put back in quarantine
      this.quarantineEvent(ledgerEntry, new Error('Manual retry failed'));
      return { status: 'QUARANTINED', event_id: eventId };
    }
  }

  /**
   * Clear quarantine (admin function)
   */
  clearQuarantine() {
    const clearedCount = this.quarantinedEvents.length;
    this.quarantinedEvents = [];
    console.log(`EventLedger: Cleared ${clearedCount} quarantined events`);
    return clearedCount;
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      total_events: 0,
      stored_successfully: 0,
      quarantined: 0,
      retried: 0,
      persistence_failures: 0
    };
  }
}

// Export singleton instance
const eventLedger = new EventLedger();
module.exports = eventLedger;
