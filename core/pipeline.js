require('dotenv').config();
const { createEvent } = require('./event-schema');
const { routeEvent } = require('./hydi-router');
const { analyzeError } = require('./ai-analyzer');
const { writeEvent } = require('./event-writer');

async function processEvent(source, type, payload) {
  const event = createEvent(source, type, payload);
  const route = routeEvent(event);
  
  try {
    if (route.action === 'send_to_ai') {
      try {
        event.ai_analysis = await analyzeError(event);
        event.status = 'processed';
      } catch (aiError) {
        event.ai_analysis = `AI analysis failed: ${aiError.message}`;
        event.status = 'processed'; // Still mark as processed, but with AI failure
      }
    } else if (route.action === 'log_only') {
      event.status = 'processed';
    }
    
    await writeEvent(event);
    return { event, route };
    
  } catch (dbError) {
    // Mark event as failed and increment retries
    event.retries = (event.retries || 0) + 1;
    
    const maxRetries = 3;
    if (event.retries >= maxRetries) {
      // Permanently failed - move to dead letter state
      event.status = 'permanently_failed';
      event.failure_reason = `Max retries (${maxRetries}) exceeded: ${dbError.message}`;
      event.final_failure_at = new Date().toISOString();
    } else {
      event.status = 'failed';
      event.failure_reason = dbError.message;
    }
    
    try {
      // Try to write the failed event (may still fail)
      await writeEvent(event);
    } catch (retryError) {
      // If retry write also fails, we can't persist the failure
      // In production, this would go to a dead-letter queue or local log
      console.error('Failed to write failed event:', retryError.message);
      // Add to local dead letter log as last resort
      console.error('DEAD LETTER:', JSON.stringify({
        timestamp: new Date().toISOString(),
        event_id: event.event_id,
        error: dbError.message,
        retries: event.retries
      }));
    }
    
    // Return error information instead of lying about success
    return { 
      event, 
      route, 
      dbError: dbError.message,
      success: false,
      dead_lettered: event.status === 'permanently_failed'
    };
  }
}

module.exports = { processEvent };
