const { v4: uuidv4 } = require('uuid');

function createEvent(source, type, payload, status = 'pending') {
  return {
    event_id: uuidv4(),
    timestamp: new Date().toISOString(),
    source,
    type,       // 'error' | 'task' | 'info'
    payload,
    status,     // 'pending' | 'processed' | 'failed'
    ai_analysis: null,
    retries: 0
  };
}

module.exports = { createEvent };
