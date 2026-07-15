// Clean server implementation - single source of truth
import express from 'express';
import { supabase } from './lib/supabaseClient.js';
import { persistEvent, upsertEvent } from './services/persistence.js';
import { protoforgeEventBus } from '../modules/protoforge-event-bus.cjs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(express.json());

// Test database connection at startup
async function testDatabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('event_id')
      .limit(1);
    
    if (error) {
      console.error('Database connection failed:', error.message);
      return false;
    }
    
    console.log('Database connection: OK');
    return true;
  } catch (err) {
    console.error('Database connection error:', err.message);
    return false;
  }
}

// Process endpoint - clean flow: ingest → validate → classify → persist → emit
app.post('/process', async (req, res) => {
  try {
    const payload = req.body;
    
    // Validate event structure
    if (!payload.event_id || !payload.type || !payload.source || !payload.timestamp) {
      return res.status(400).json({
        status: 'rejected',
        reason: 'Missing required fields: event_id, type, source, timestamp'
      });
    }
    
    // Process through event bus (validate → classify)
    const result = await protoforgeEventBus.processEvent(payload);
    
    // Persist to database - simple contract
    const persistResult = await persistEvent({
      event_id: payload.event_id,
      type: payload.type,
      source: payload.source,
      timestamp: payload.timestamp,
      payload: payload.payload,
      processed: true,
      stored_at: new Date().toISOString()
    });
    
    if (!persistResult.success) {
      console.error('Persistence failed:', {
        event_id: payload.event_id,
        stage: 'persistence',
        error: persistResult.error
      });
      
      return res.json({
        status: 'failed',
        event_id: payload.event_id,
        reason: persistResult.error,
        processing_result: result
      });
    }
    
    // Persist opportunity if exists
    if (result.opportunity) {
      const oppPersistResult = await persistEvent({
        event_id: result.opportunity.event_id,
        type: result.opportunity.type,
        source: 'cascade_opportunity',
        timestamp: result.opportunity.timestamp,
        payload: result.opportunity.payload,
        processed: false,
        parent_event_id: payload.event_id,
        stored_at: new Date().toISOString()
      });
      
      if (!oppPersistResult.success) {
        console.error('Opportunity persistence failed:', {
          event_id: result.opportunity.event_id,
          parent_event_id: payload.event_id,
          error: oppPersistResult.error
        });
      }
    }
    
    // Return success
    res.json({
      status: 'processed',
      event_id: payload.event_id,
      timestamp: new Date().toISOString(),
      validation: result.validation,
      classification: result.classification,
      opportunity: result.opportunity || null,
      persistence: 'stored'
    });
    
  } catch (error) {
    console.error('Process endpoint failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await testDatabaseConnection();
    
    res.json({
      status: 'operational',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Simple metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const { count } = await supabase
      .from('hydi_events')
      .select('*', { count: 'exact', head: true });
    
    const eventBusStats = protoforgeEventBus.getStats();
    
    res.json({
      total_events: count,
      event_bus: eventBusStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Start server with database validation
app.listen(PORT, async () => {
  console.log(`Server starting on port ${PORT}`);
  
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error('CRITICAL: Database connection failed. Server exiting.');
    process.exit(1);
  }
  
  console.log(`Server running on port ${PORT}`);
  console.log('Clean architecture - single persistence contract');
});
