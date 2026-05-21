#!/usr/bin/env node

/**
 * Reset Failed Events to Pending Status
 *
 * Converts all failed events back to pending status with incremented retry counts
 * and appropriate retry strategy metadata. Includes validation, logging, and error handling.
 */

const path = require('path');

// Load environment from .env file
const envPath = path.join(__dirname, '.env.production');
console.log(`Loading environment from: ${envPath}`);

require('dotenv').config({ path: envPath });

const { createClient } = require('@supabase/supabase-js');

class FailedEventResetter {
  constructor() {
    // Verify environment variables are loaded
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('ERROR: Missing Supabase credentials');
      console.error(`SUPABASE_URL: ${supabaseUrl ? 'loaded' : 'MISSING'}`);
      console.error(`SUPABASE_SERVICE_ROLE_KEY: ${supabaseKey ? 'loaded' : 'MISSING'}`);
      process.exit(1);
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.stats = {
      total_failed: 0,
      reset_to_pending: 0,
      skipped: 0,
      errors: 0
    };
  }

  /**
   * Fetch all failed events
   */
  async fetchFailedEvents() {
    console.log('\n=== FETCHING FAILED EVENTS ===\n');

    try {
      const { data: failedEvents, error } = await this.supabase
        .from('hydi_events')
        .select('*')
        .eq('status', 'failed')
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Database query failed: ${error.message}`);
      }

      this.stats.total_failed = failedEvents?.length || 0;
      console.log(`Found ${this.stats.total_failed} failed events`);

      if (failedEvents && failedEvents.length > 0) {
        console.log(`\nFirst 5 failed events:`);
        failedEvents.slice(0, 5).forEach(event => {
          console.log(`  - ${event.event_id} (${event.type}): ${event.metadata?.error || 'Unknown error'}`);
        });
      }

      return failedEvents || [];

    } catch (error) {
      console.error(`Error fetching failed events: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset a single failed event
   */
  async resetEvent(event) {
    try {
      const currentRetries = event.metadata?.retry_count || 0;
      const newRetryCount = currentRetries + 1;

      // Calculate next retry time (exponential backoff)
      const backoffMs = Math.min(
        1000 * Math.pow(2, currentRetries),
        60000
      );
      const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

      const updateData = {
        status: 'pending',
        updated_at: new Date().toISOString(),
        metadata: {
          ...event.metadata,
          retry_count: newRetryCount,
          last_reset: new Date().toISOString(),
          reset_reason: 'Batch reset from failed status',
          next_retry_at: nextRetryAt,
          retry_strategy: {
            max_retries: 5,
            backoff_multiplier: 2,
            max_backoff: 60000
          }
        }
      };

      const { error } = await this.supabase
        .from('hydi_events')
        .update(updateData)
        .eq('event_id', event.event_id);

      if (error) {
        throw new Error(`Update failed for ${event.event_id}: ${error.message}`);
      }

      this.stats.reset_to_pending++;
      return true;

    } catch (error) {
      console.error(`Error resetting event ${event.event_id}: ${error.message}`);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Reset all failed events
   */
  async resetAllFailedEvents(limit = null) {
    console.log('\n=== RESETTING FAILED EVENTS ===\n');

    try {
      const failedEvents = await this.fetchFailedEvents();

      if (failedEvents.length === 0) {
        console.log('No failed events to reset');
        return;
      }

      const eventsToReset = limit ? failedEvents.slice(0, limit) : failedEvents;

      console.log(`\nResetting ${eventsToReset.length} events...\n`);

      for (let i = 0; i < eventsToReset.length; i++) {
        const event = eventsToReset[i];
        const success = await this.resetEvent(event);

        if (success) {
          process.stdout.write('.');
        } else {
          process.stdout.write('E');
        }

        // Progress update every 20 events
        if ((i + 1) % 20 === 0) {
          console.log(` (${i + 1}/${eventsToReset.length})`);
        }
      }

      console.log('\n');

    } catch (error) {
      console.error(`Reset operation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify reset was successful
   */
  async verifyReset() {
    console.log('\n=== VERIFYING RESET ===\n');

    try {
      const { data: statusCounts, error } = await this.supabase
        .from('hydi_events')
        .select('status, count(*)', { count: 'exact' })
        .group('status');

      if (error) {
        throw new Error(`Verification query failed: ${error.message}`);
      }

      console.log('Event Status Counts:');
      if (statusCounts) {
        statusCounts.forEach(row => {
          const count = row.count || 0;
          console.log(`  ${row.status}: ${count}`);
        });
      }

      return statusCounts;

    } catch (error) {
      console.error(`Verification failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Print summary report
   */
  printSummary() {
    console.log('\n=== RESET SUMMARY ===\n');
    console.log(`Total Failed Events Found: ${this.stats.total_failed}`);
    console.log(`Successfully Reset to Pending: ${this.stats.reset_to_pending}`);
    console.log(`Skipped: ${this.stats.skipped}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`\nSuccess Rate: ${((this.stats.reset_to_pending / this.stats.total_failed) * 100).toFixed(1)}%`);
  }

  /**
   * Run complete reset operation
   */
  async run(limit = null) {
    try {
      console.log('='.repeat(50));
      console.log('FAILED EVENTS RESET UTILITY');
      console.log('='.repeat(50));

      // Check connection first
      console.log('\nVerifying Supabase connection...');
      const { error } = await this.supabase.from('hydi_events').select('count(*)', { count: 'exact', head: true });

      if (error) {
        throw new Error(`Supabase connection failed: ${error.message}`);
      }
      console.log('✓ Supabase connection successful\n');

      // Run reset
      await this.resetAllFailedEvents(limit);

      // Verify
      await this.verifyReset();

      // Print summary
      this.printSummary();

      console.log('\n='.repeat(50));
      console.log('Reset operation completed successfully');
      console.log('='.repeat(50) + '\n');

    } catch (error) {
      console.error('\n' + '='.repeat(50));
      console.error('RESET OPERATION FAILED');
      console.error('='.repeat(50));
      console.error(`Error: ${error.message}\n`);
      process.exit(1);
    }
  }
}

// CLI execution
if (require.main === module) {
  const resetter = new FailedEventResetter();

  // Get limit from command line args if provided
  const limit = process.argv[2] ? parseInt(process.argv[2]) : null;

  if (limit && isNaN(limit)) {
    console.error('Invalid limit parameter. Usage: node reset-failed-events.js [limit]');
    process.exit(1);
  }

  resetter.run(limit).then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { FailedEventResetter };
