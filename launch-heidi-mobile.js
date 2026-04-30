#!/usr/bin/env node
/**
 * Launch Heidi Mobile Chat Portal
 * Starts Express server with Heidi chat, WebSocket, and health integration
 */

const express = require('express');
const http = require('http');
const path = require('path');
require('dotenv').config();

const HeidiWebSocketServer = require('./modules/heidi-websocket-server');

// Configuration
const PORT = process.env.HEIDI_PORT || 3006;
const HOST = process.env.HEIDI_HOST || 'localhost';

// Create Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// API Routes
app.get('/api/health', async (req, res) => {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/system_dashboard?select=*`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      res.json(data[0] || {});
    } else {
      res.status(500).json({ error: 'Failed to fetch health data' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Heidi API endpoint (fallback for HTTP)
app.post('/api/heidi', async (req, res) => {
  try {
    const { message, model, action } = req.body;
    
    if (action === 'status') {
      // Return Heidi status
      res.json({
        response: 'Heidi is online with local model support',
        model: process.env.LOCAL_MODEL_NAME || 'llama2',
        provider: process.env.LOCAL_MODEL_PROVIDER || 'ollama',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Simple response for now (would integrate with local model handler)
    res.json({
      response: `Heidi received: "${message}". Local model integration available.`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat router (existing system integration)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, system } = req.body;
    
    if (system === 'heidi') {
      // Route to Heidi handler
      const response = await fetch(`http://${HOST}:${PORT}/api/heidi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      
      const data = await response.json();
      return res.json(data);
    }
    
    // Other systems would be handled by existing chat router
    res.json({
      response: `Message routed to ${system}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the Heidi mobile chat interface
app.get('/heidi-mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'heidi-mobile-chat.html'));
});

// Also serve as root for convenience
app.get('/', (req, res) => {
  res.redirect('/heidi-mobile');
});

// Server stats endpoint
app.get('/api/stats', (req, res) => {
  if (wsServer) {
    res.json(wsServer.getStats());
  } else {
    res.json({ error: 'WebSocket server not initialized' });
  }
});

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
let wsServer = null;

// Start server
server.listen(PORT, HOST, () => {
  console.log(`\n🧠 Heidi Mobile Chat Portal`);
  console.log(`📱 Mobile Interface: http://${HOST}:${PORT}/heidi-mobile`);
  console.log(`🔗 WebSocket: ws://${HOST}:${PORT}/ws/heidi`);
  console.log(`📊 Health API: http://${HOST}:${PORT}/api/health`);
  console.log(`📈 Server Stats: http://${HOST}:${PORT}/api/stats`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Local Model URL: ${process.env.LOCAL_MODEL_URL || 'http://localhost:11434'}`);
  console.log(`   Model: ${process.env.LOCAL_MODEL_NAME || 'llama2'}`);
  console.log(`   Provider: ${process.env.LOCAL_MODEL_PROVIDER || 'ollama'}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`\n🚀 Server running on port ${PORT}\n`);
  
  // Initialize WebSocket server after HTTP server is ready
  wsServer = new HeidiWebSocketServer(server);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Heidi Mobile Chat Portal...');
  
  if (wsServer) {
    wsServer.wss.close(() => {
      console.log('✅ WebSocket server closed');
    });
  }
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received');
  process.exit(0);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Check dependencies
console.log('🔍 Checking dependencies...');

// Check if local model service is available
async function checkLocalModel() {
  try {
    const axios = require('axios');
    const url = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
    
    if (process.env.LOCAL_MODEL_PROVIDER === 'ollama') {
      const response = await axios.get(`${url}/api/tags`, { timeout: 2000 });
      console.log(`✅ Ollama available at ${url}`);
      if (response.data.models?.length > 0) {
        console.log(`   Available models: ${response.data.models.map(m => m.name).join(', ')}`);
      }
    } else if (process.env.LOCAL_MODEL_PROVIDER === 'lmstudio') {
      const response = await axios.get(`${url}/v1/models`, { timeout: 2000 });
      console.log(`✅ LM Studio available at ${url}`);
      if (response.data.data?.length > 0) {
        console.log(`   Available models: ${response.data.data.map(m => m.id).join(', ')}`);
      }
    }
  } catch (error) {
    console.log(`⚠️  Local model service not available at ${process.env.LOCAL_MODEL_URL || 'http://localhost:11434'}`);
    console.log('   Heidi will work with fallback responses');
  }
}

// Check Supabase connection
async function checkSupabase() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      console.log('⚠️  Supabase credentials not configured');
      console.log('   Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
      return;
    }
    
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
      }
    });
    
    if (response.ok) {
      console.log('✅ Supabase connection verified');
    } else {
      console.log('⚠️  Supabase connection failed');
    }
  } catch (error) {
    console.log('⚠️  Cannot reach Supabase');
  }
}

// Run checks
Promise.all([
  checkLocalModel(),
  checkSupabase()
]).then(() => {
  console.log('🔍 Dependency check complete\n');
});
