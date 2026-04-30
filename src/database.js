// SINGLE Supabase client - the only database interface
// No duplicates, no ambiguity, no emotional labor for broken imports

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Validate environment at startup
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Strip quotes if present
if (supabaseUrl && supabaseUrl.startsWith('"')) {
  supabaseUrl = supabaseUrl.slice(1, -1);
}
if (supabaseKey && supabaseKey.startsWith('"')) {
  supabaseKey = supabaseKey.slice(1, -1);
}

console.log('[DATABASE] SUPABASE_URL:', supabaseUrl ? supabaseUrl.substring(0, 20) + '...' : 'MISSING');
console.log('[DATABASE] SUPABASE_KEY:', supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'MISSING');

if (!supabaseUrl || !supabaseKey) {
  throw new Error('CRITICAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file');
}

// Create singleton client - the ONLY database interface
const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection immediately
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('event_id')
      .limit(1);
    
    if (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
    
    console.log('Database connection: OK');
    return true;
  } catch (error) {
    console.error('Database connection test error:', error);
    return false;
  }
}

// Simple persistence contract - no retry, no quarantine, no abstraction
async function persistEvent(event, classification, opportunity) {
  try {
    // Store original event - simple v2 upsert
    const { data, error } = await supabase
      .from('hydi_events')
      .upsert({
        event_id: event.event_id,
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
        payload: event.payload,
        processed: true,
        stored_at: new Date().toISOString()
      }, {
        onConflict: 'event_id'
      })
      .select();
    
    if (error) {
      // Return explicit single error reason - no abstraction
      return {
        success: false,
        error: `Database error: ${error.message}`,
        code: error.code
      };
    }
    
    // Store opportunity if exists - simple v2 upsert
    if (opportunity) {
      const { error: oppError } = await supabase
        .from('hydi_events')
        .upsert({
          event_id: opportunity.event_id,
          type: opportunity.type,
          source: 'cascade_opportunity',
          timestamp: opportunity.timestamp,
          payload: opportunity.payload,
          processed: false,
          parent_event_id: event.event_id,
          stored_at: new Date().toISOString()
        }, {
          onConflict: 'event_id'
        });
      
      if (oppError) {
        return {
          success: false,
          error: `Opportunity storage error: ${oppError.message}`,
          code: oppError.code
        };
      }
    }
    
    return {
      success: true,
      data: data
    };
    
  } catch (error) {
    // Return explicit single error reason - no abstraction
    return {
      success: false,
      error: `Runtime error: ${error.message}`,
      code: 'RUNTIME_ERROR'
    };
  }
}

// Export singleton - the ONLY way to access database
module.exports = {
  supabase,
  testConnection,
  persistEvent
};
