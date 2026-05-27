require('dotenv').config();
const express = require('express');
const { processEvent } = require('./hydi-processor');

const app = express();
app.use(express.json());

// Error endpoint - feeds HYDI pipeline
app.post('/error', async (req, res) => {
  try {
    const result = await processEvent('protoforge', 'error', {
      ...req.body,
      timestamp: Date.now(),
      endpoint: '/error'
    });
    res.json({ success: true, route: result.route, event_id: result.event.event_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Task endpoint
app.post('/task', async (req, res) => {
  try {
    const result = await processEvent('protoforge', 'task', {
      ...req.body,
      timestamp: Date.now(),
      endpoint: '/task'
    });
    res.json({ success: true, route: result.route, event_id: result.event.event_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Info endpoint
app.post('/info', async (req, res) => {
  try {
    const result = await processEvent('protoforge', 'info', {
      ...req.body,
      timestamp: Date.now(),
      endpoint: '/info'
    });
    res.json({ success: true, route: result.route, event_id: result.event.event_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`ProtoForge mock server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /error - Send error events to HYDI pipeline`);
  console.log(`  POST /task - Send task events to HYDI pipeline`);
  console.log(`  POST /info - Send info events to HYDI pipeline`);
  console.log(`  GET /health - Health check`);
});
