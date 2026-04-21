const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Get module count (placeholder)
    const moduleCount = 0;
    
    // Get events count
    const { count } = await supabase
      .from('hydi_events')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      status: 'ok',
      modules: moduleCount,
      events: count || 0
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Process endpoint
app.post('/process', async (req, res) => {
  try {
    const payload = req.body;
    
    // Insert event into Supabase (idempotent)
    const { data, error } = await supabase
      .from('hydi_events')
      .insert({
        event_id: payload.event_id || Math.random().toString(36).substr(2, 9),
        type: payload.type || 'unknown',
        payload: payload.payload || payload,
        processed: false
      })
      .onConflict('event_id')
      .doNothing()
      .select();
    
    if (error) throw error;
    
    // TODO: Trigger HEIDI processing here
    // For now, just acknowledge receipt
    res.json({
      status: 'processed',
      eventId: data[0]?.event_id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Process endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Insight endpoint
app.get('/insight', async (req, res) => {
  try {
    // Get recent events
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    res.json({
      insights: data.map(event => ({
        id: event.id,
        type: event.type,
        timestamp: event.created_at,
        summary: `Processed ${event.type} event`
      })),
      count: data.length
    });
  } catch (error) {
    console.error('Insight endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Event logging endpoint
app.post('/event', async (req, res) => {
  try {
    const eventData = req.body;
    
    // Log system event
    const { data, error } = await supabase
      .from('hydi_events')
      .insert({
        event_id: eventData.event_id || `sys-${Date.now()}`,
        type: eventData.type || 'system_event',
        payload: eventData.payload || {},
        processed: true // System events are pre-processed
      })
      .select();
    
    if (error) throw error;
    
    res.json({
      status: 'logged',
      eventId: data[0]?.event_id
    });
  } catch (error) {
    console.error('Event endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
