// Simple persistence service - single responsibility
import { supabase } from '../lib/supabaseClient.js';

/**
 * Persist event to database - no retries, no abstraction
 * @param {Object} event - Event to persist
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function persistEvent(event) {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .insert(event);
    
    if (error) {
      return {
        success: false,
        error: error.message
      };
    }
    
    return {
      success: true,
      data
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Upsert event - only if needed
 * @param {Object} event - Event to upsert
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function upsertEvent(event) {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .upsert(event, { onConflict: 'event_id' });
    
    if (error) {
      return {
        success: false,
        error: error.message
      };
    }
    
    return {
      success: true,
      data
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}
