// Vercel API route for SSE streaming
// This handles the /events/stream endpoint for the Ursula dashboard

const { EventEmitter } = require('events');
const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken');

// Create a simple event emitter for broadcasting
const eventEmitter = new EventEmitter();

export default function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, x-hydi-service-token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  // Service token auth guard
  const tokenResult = verifyServiceToken(req.headers['x-hydi-service-token']);
  if (!tokenResult.valid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', reason: tokenResult.reason }));
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  console.log('[URSULA] New client connected to SSE stream (Vercel)');
  
  // Send initial connection event
  res.write('event: connected\n');
  res.write(`data: ${JSON.stringify({
    type: 'system_status',
    message: 'Connected to ProtoForge Central Nervous System (Vercel)',
    timestamp: new Date().toISOString()
  })}\n\n`);
  
  // Listen for events and forward to client
  const onEvent = (event) => {
    try {
      res.write(`event: ${event.type || 'message'}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      console.error('[URSULA] Failed to send event to client:', error);
    }
  };
  
  // Subscribe to events
  eventEmitter.on('event', onEvent);
  
  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write('event: heartbeat\n');
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    } catch (error) {
      clearInterval(heartbeat);
      eventEmitter.off('event', onEvent);
    }
  }, 30000);
  
  // Clean up on disconnect
  req.on('close', () => {
    console.log('[URSULA] Client disconnected from SSE stream (Vercel)');
    clearInterval(heartbeat);
    eventEmitter.off('event', onEvent);
  });
}

// Export the event emitter so other parts can broadcast events
export { eventEmitter };
