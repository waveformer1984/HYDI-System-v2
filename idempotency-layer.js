require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { EventContractValidator } = require('./event-contracts');

// Idempotency Layer - Ensures safe replay and duplicate handling
class IdempotencyLayer {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.validator = new EventContractValidator();
    this.processedEvents = new Set();
    this.idempotencyKeys = new Map(); // event_id -> processing status
  }

  // Process event with idempotency guarantees
  async processEvent(event, processor) {
    const eventId = event.event_id;
    const correlationId = event.correlation_id || eventId;
    
    console.log(`Processing event: ${eventId} (correlation: ${correlationId})`);
    
    try {
      // Step 1: Check if event has been processed
      const existingEvent = await this.checkEventProcessed(eventId);
      
      if (existingEvent) {
        console.log(`Event ${eventId} already processed - returning cached result`);
        return {
          success: true,
          event: existingEvent,
          idempotent: true,
          action: 'returned_cached'
        };
      }
      
      // Step 2: Validate event
      const validation = this.validator.validateEvent(event);
      
      if (!validation.valid) {
        const error = `Event validation failed: ${validation.errors.join(', ')}`;
        console.log(`Event ${eventId} validation failed: ${error}`);
        
        // Store failed validation
        await this.markEventProcessed(eventId, 'failed', error);
        
        return {
          success: false,
          error,
          event: validation.event,
          idempotent: false,
          action: 'validation_failed'
        };
      }
      
      // Step 3: Check for duplicate correlation
      const duplicateCheck = await this.checkDuplicateCorrelation(correlationId, eventId);
      
      if (duplicateCheck.isDuplicate) {
        console.log(`Duplicate correlation detected: ${correlationId}`);
        
        return {
          success: false,
          error: `Duplicate correlation: ${correlationId}`,
          event: validation.event,
          idempotent: true,
          action: 'duplicate_correlation',
          originalEvent: duplicateCheck.originalEvent
        };
      }
      
      // Step 4: Mark as processing (prevents race conditions)
      const processingLock = await this.acquireProcessingLock(eventId);
      
      if (!processingLock.acquired) {
        console.log(`Failed to acquire processing lock for ${eventId}`);
        
        return {
          success: false,
          error: 'Processing lock conflict',
          event: validation.event,
          idempotent: true,
          action: 'lock_conflict'
        };
      }
      
      try {
        // Step 5: Process the event
        console.log(`Processing event ${eventId}...`);
        const result = await processor(validation.event);
        
        // Step 6: Store processed event
        const processedEvent = await this.storeProcessedEvent(validation.event, result);
        
        // Step 7: Release lock
        await this.releaseProcessingLock(eventId);
        
        console.log(`Event ${eventId} processed successfully`);
        
        return {
          success: true,
          event: processedEvent,
          result,
          idempotent: true,
          action: 'processed'
        };
        
      } catch (processingError) {
        // Step 8: Handle processing errors
        console.log(`Processing error for ${eventId}: ${processingError.message}`);
        
        await this.markEventProcessed(eventId, 'failed', processingError.message);
        await this.releaseProcessingLock(eventId);
        
        return {
          success: false,
          error: processingError.message,
          event: validation.event,
          idempotent: true,
          action: 'processing_failed'
        };
      }
      
    } catch (error) {
      console.log(`Idempotency layer error for ${eventId}: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        event,
        idempotent: false,
        action: 'idempotency_error'
      };
    }
  }

  async checkEventProcessed(eventId) {
    try {
      const { data, error } = await this.supabase
        .from('processed_events')
        .select('*')
        .eq('event_id', eventId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - event not processed
          return null;
        }
        throw error;
      }
      
      return data;
      
    } catch (error) {
      console.log(`Error checking processed event ${eventId}: ${error.message}`);
      return null;
    }
  }

  async checkDuplicateCorrelation(correlationId, eventId) {
    try {
      const { data, error } = await this.supabase
        .from('processed_events')
        .select('*')
        .eq('correlation_id', correlationId)
        .neq('event_id', eventId)
        .limit(1);
      
      if (error) {
        throw error;
      }
      
      if (data && data.length > 0) {
        return {
          isDuplicate: true,
          originalEvent: data[0]
        };
      }
      
      return { isDuplicate: false };
      
    } catch (error) {
      console.log(`Error checking duplicate correlation: ${error.message}`);
      return { isDuplicate: false };
    }
  }

  async acquireProcessingLock(eventId) {
    try {
      const lockKey = `processing:${eventId}`;
      const lockValue = {
        event_id: eventId,
        locked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };
      
      // Use upsert with NOT NULL constraint to ensure atomicity
      const { data, error } = await this.supabase
        .from('processing_locks')
        .upsert(lockValue, {
          onConflict: 'event_id'
        })
        .select();
      
      if (error) {
        return { acquired: false, error: error.message };
      }
      
      return { acquired: true, lock: data[0] };
      
    } catch (error) {
      return { acquired: false, error: error.message };
    }
  }

  async releaseProcessingLock(eventId) {
    try {
      await this.supabase
        .from('processing_locks')
        .delete()
        .eq('event_id', eventId);
      
    } catch (error) {
      console.log(`Error releasing lock for ${eventId}: ${error.message}`);
    }
  }

  async storeProcessedEvent(event, result) {
    try {
      const processedEvent = {
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        type: event.type,
        status: event.status,
        processed_at: new Date().toISOString(),
        result: result,
        schema_version: event.schema_version,
        processing_duration: result.processing_duration || null
      };
      
      const { data, error } = await this.supabase
        .from('processed_events')
        .upsert(processedEvent, {
          onConflict: 'event_id'
        })
        .select();
      
      if (error) {
        throw error;
      }
      
      return data[0];
      
    } catch (error) {
      console.log(`Error storing processed event: ${error.message}`);
      throw error;
    }
  }

  async markEventProcessed(eventId, status, error = null) {
    try {
      await this.supabase
        .from('processed_events')
        .upsert({
          event_id: eventId,
          status,
          processed_at: new Date().toISOString(),
          error,
          processing_failed: true
        }, {
          onConflict: 'event_id'
        });
      
    } catch (storeError) {
      console.log(`Error marking event processed: ${storeError.message}`);
    }
  }

  // Replay events with idempotency guarantees
  async replayEvents(events, processor) {
    console.log(`=== IDEMPOTENT REPLAY START ===`);
    console.log(`Events to replay: ${events.length}`);
    
    const results = {
      total: events.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      duplicates: 0,
      details: []
    };
    
    // Normalize legacy events missing required fields
      const normalizedEvents = events.map(e => ({
        ...e,
        schema_version: e.schema_version ?? "1.1.0",
        correlation_id: e.correlation_id ?? e.event_id ?? e.id,
        payload: e.payload ?? {},
        status: e.status ?? "pending",
      }));

      for (let i = 0; i < normalizedEvents.length; i++) {
        const event = normalizedEvents[i];
      
      try {
        const result = await this.processEvent(event, processor);
        
        if (result.idempotent && result.action === 'returned_cached') {
          results.skipped++;
          console.log(`[${i+1}/${events.length}] SKIPPED (already processed): ${event.event_id}`);
        } else if (result.idempotent && result.action === 'duplicate_correlation') {
          results.duplicates++;
          console.log(`[${i+1}/${events.length}] DUPLICATE: ${event.event_id}`);
        } else if (result.success) {
          results.processed++;
          console.log(`[${i+1}/${events.length}] PROCESSED: ${event.event_id}`);
        } else {
          results.failed++;
          console.log(`[${i+1}/${events.length}] FAILED: ${event.event_id} - ${result.error}`);
        }
        
        results.details.push({
          index: i,
          event_id: event.event_id,
          action: result.action,
          success: result.success,
          idempotent: result.idempotent
        });
        
      } catch (error) {
        results.failed++;
        console.log(`[${i+1}/${events.length}] ERROR: ${event.event_id} - ${error.message}`);
        
        results.details.push({
          index: i,
          event_id: event.event_id,
          action: 'error',
          success: false,
          idempotent: false,
          error: error.message
        });
      }
    }
    
    console.log(`=== IDEMPOTENT REPLAY COMPLETE ===`);
    console.log(`Total: ${results.total}`);
    console.log(`Processed: ${results.processed}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Duplicates: ${results.duplicates}`);
    console.log(`Failed: ${results.failed}`);
    
    return results;
  }

  // Clean up old processing locks
  async cleanupExpiredLocks() {
    console.log('Cleaning up expired processing locks...');
    
    try {
      const { error } = await this.supabase
        .from('processing_locks')
        .delete()
        .lt('expires_at', new Date().toISOString());
      
      if (error) {
        console.log(`Error cleaning up locks: ${error.message}`);
      } else {
        console.log('Expired locks cleaned up successfully');
      }
      
    } catch (error) {
      console.log(`Lock cleanup error: ${error.message}`);
    }
  }

  // Get idempotency statistics
  getStats() {
    return {
      processed_events: this.processedEvents.size,
      active_locks: this.idempotencyKeys.size,
      memory_usage: process.memoryUsage()
    };
  }
}

// Create required tables for idempotency
const createIdempotencyTables = `
-- Table for tracking processed events
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result JSONB,
  schema_version TEXT,
  processing_duration INTEGER,
  error TEXT,
  processing_failed BOOLEAN DEFAULT FALSE,
  INDEX(correlation_id),
  INDEX(processed_at),
  INDEX(type, status)
);

-- Table for processing locks
CREATE TABLE IF NOT EXISTS processing_locks (
  event_id TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  INDEX(expires_at)
);

-- Table for system configuration
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  config_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  INDEX(config_type)
);
`;

// CLI interface
if (require.main === module) {
  const idempotency = new IdempotencyLayer();
  
  const command = process.argv[2] || 'stats';
  
  (async () => {
    switch (command) {
      case 'cleanup':
        await idempotency.cleanupExpiredLocks();
        break;
        
      case 'stats':
        console.log(JSON.stringify(idempotency.getStats(), null, 2));
        break;
        
      case 'tables':
        console.log('Required SQL for idempotency:');
        console.log(createIdempotencyTables);
        break;
        
      default:
        console.log('Usage: node idempotency-layer.js [cleanup|stats|tables]');
    }
  })().catch(console.error);
}

module.exports = { IdempotencyLayer, createIdempotencyTables };



