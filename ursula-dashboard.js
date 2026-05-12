require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { stateTracker } = require('./hydi-processor');

// Ursula Dashboard - SSE Server with Real-time State Tracking
class UrsulaDashboard {
  constructor() {
    this.app = express();
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    this.stateTracker = stateTracker;
    this.port = process.env.DASHBOARD_PORT || 3002;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
  }

  setupRoutes() {
    // Dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });

    // Real-time event streaming
    this.app.get('/events/stream', async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const sendUpdate = async () => {
        try {
          const events = await this.getRecentEvents();
          const stats = await this.stateTracker();
          
          res.write(`data: ${JSON.stringify({ 
            events, 
            stats, 
            timestamp: new Date().toISOString() 
          })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        }
      };

      // Initial data
      sendUpdate();

      // Updates every 2 seconds
      const interval = setInterval(sendUpdate, 2000);

      req.on('close', () => clearInterval(interval));
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  async getRecentEvents() {
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    } catch (error) {
      console.log('Failed to get recent events:', error.message);
      return [];
    }
  }

  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>HYDI Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #1a1a1a; color: #fff; }
        .header { text-align: center; margin-bottom: 30px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .panel { background: #2a2a2a; padding: 20px; border-radius: 8px; border: 1px solid #444; }
        .event-item { background: #333; padding: 10px; margin: 5px 0; border-radius: 4px; }
        .status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center; }
        .status-item { background: #444; padding: 15px; border-radius: 4px; }
        .status-count { font-size: 24px; font-weight: bold; color: #4CAF50; }
        .status-label { font-size: 12px; color: #ccc; }
        .live { color: #4CAF50; }
    </style>
</head>
<body>
    <div class="header">
        <h1>HYDI System Dashboard</h1>
        <div class="live" id="timestamp">Live: Loading...</div>
    </div>
    
    <div class="grid">
        <div class="panel">
            <h3>Recent Events</h3>
            <div id="events"></div>
        </div>
        
        <div class="panel">
            <h3>System Status</h3>
            <div id="stats"></div>
        </div>
    </div>

    <script>
        const eventSource = new EventSource('/events/stream');
        
        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        };
        
        function updateDashboard(data) {
            document.getElementById('timestamp').textContent = 'Live: ' + new Date(data.timestamp).toLocaleTimeString();
            
            // Update events
            const eventsDiv = document.getElementById('events');
            eventsDiv.innerHTML = data.events.map(event => \`
                <div class="event-item">
                    <strong>\${event.type.toUpperCase()}</strong> - \${event.status}
                    <br><small>\${event.event_id.substring(0, 8)}...</small>
                    <br><small>\${new Date(event.created_at).toLocaleString()}</small>
                </div>
            \`).join('');
            
            // Update stats
            const statsDiv = document.getElementById('stats');
            const stats = data.stats;
            statsDiv.innerHTML = \`
                <div class="status-grid">
                    <div class="status-item">
                        <div class="status-count">\${stats.pending || 0}</div>
                        <div class="status-label">Pending</div>
                    </div>
                    <div class="status-item">
                        <div class="status-count">\${stats.processed || 0}</div>
                        <div class="status-label">Processed</div>
                    </div>
                    <div class="status-item">
                        <div class="status-count">\${stats.failed || 0}</div>
                        <div class="status-label">Failed</div>
                    </div>
                </div>
            \`;
        }
    </script>
</body>
</html>`;
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`Ursula Dashboard running on port ${this.port}`);
      console.log(`Dashboard: http://localhost:${this.port}`);
      console.log(`SSE Stream: http://localhost:${this.port}/events/stream`);
    });
  }
}

// Start the dashboard
const dashboard = new UrsulaDashboard();
dashboard.start();
