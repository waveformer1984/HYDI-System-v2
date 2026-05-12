require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Real Supabase client for dashboard (using service key for testing)
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_KEY
);

// Ursula dashboard only queries Supabase, doesn't process events

// Dashboard endpoints
app.get('/events', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type;
  
  try {
    let query = supabase
      .from('hydi_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (type) {
      query = query.eq('type', type);
    }
    
    const { data, error } = await query;
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events/pending', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('status', 'pending');
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events/errors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('type', 'error')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events/ai-analysis', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hydi_events')
      .select('*')
      .eq('type', 'error')
      .not('ai_analysis', 'is', null);
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard endpoint with 4 key panels
app.get('/dashboard', async (req, res) => {
  try {
    const [eventsResult, errorsResult, statusCountsResult, retriesResult] = await Promise.all([
      // Panel 1: Event Stream
      supabase
        .from('hydi_events')
        .select('event_id, type, status, timestamp, payload, updated_at')
        .order('created_at', { ascending: false })
        .limit(50),
      
      // Panel 2: Error Focus Panel
      supabase
        .from('hydi_events')
        .select('event_id, type, status, timestamp, payload, ai_analysis, retries, updated_at')
        .eq('type', 'error')
        .order('created_at', { ascending: false })
        .limit(20),
      
      // Panel 3: Processing State
      supabase
        .from('hydi_events')
        .select('status')
        .then(({ data, error }) => {
          if (error) throw error;
          const counts = data.reduce((acc, event) => {
            acc[event.status] = (acc[event.status] || 0) + 1;
            return acc;
          }, {});
          return { data: counts, error: null };
        }),
      
      // Panel 4: Retry / Failure Tracker
      supabase
        .from('hydi_events')
        .select('event_id, type, status, timestamp, payload, retries, updated_at')
        .or('retries.gt.0,status.eq.failed')
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    if (eventsResult.error || errorsResult.error || statusCountsResult.error || retriesResult.error) {
      return res.status(500).json({ 
        error: 'Database query failed',
        details: {
          events: eventsResult.error?.message,
          errors: errorsResult.error?.message,
          statusCounts: statusCountsResult.error?.message,
          retries: retriesResult.error?.message
        }
      });
    }

    res.json({
      events: eventsResult.data || [],
      errors: errorsResult.data || [],
      statusCounts: statusCountsResult.data || {},
      retries: retriesResult.data || [],
      lastUpdated: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-time event streaming endpoint
app.get('/events/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendUpdate = async () => {
    try {
      const { data: events } = await supabase
        .from('hydi_events')
        .select('event_id, type, status, timestamp, payload, updated_at')
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: statusCounts } = await supabase
        .from('hydi_events')
        .select('status');

      const counts = statusCounts?.reduce((acc, event) => {
        acc[event.status] = (acc[event.status] || 0) + 1;
        return acc;
      }, {}) || {};

      res.write(`data: ${JSON.stringify({ events, statusCounts: counts, timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  // Send initial data
  sendUpdate();

  // Send updates every 2 seconds
  const interval = setInterval(sendUpdate, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

app.get('/health/services', async (req, res) => {
  const services = [
    { name: 'ProtoForge', port: 3001, status: 'UP' },
    { name: 'AI Analyzer', port: 8000, status: 'UNKNOWN' }
  ];
  
  // Check AI analyzer
  try {
    const http = require('http');
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 8000, path: '/', timeout: 2000 }, (res) => {
        services[1].status = 'UP';
        resolve();
      });
      req.on('error', () => reject());
      req.on('timeout', () => reject());
      req.end();
    });
  } catch (e) {
    services[1].status = 'DOWN';
  }
  
  res.json(services);
});

// Main dashboard page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HYDI-Ursula Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { text-align: center; margin-bottom: 30px; }
        .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .panel { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .panel h3 { margin-top: 0; color: #333; }
        .error { border-left: 4px solid #e74c3c; }
        .task { border-left: 4px solid #f39c12; }
        .info { border-left: 4px solid #3498db; }
        .status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 15px 0; }
        .status-item { text-align: center; padding: 10px; background: #ecf0f1; border-radius: 4px; }
        .status-count { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .status-label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
        .event-item { padding: 8px; margin: 5px 0; background: #f8f9fa; border-radius: 4px; font-size: 12px; }
        .event-id { font-family: monospace; color: #666; }
        .refresh-btn { background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .refresh-btn:hover { background: #2980b9; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>HYDI-Ursula Dashboard</h1>
        <button class="refresh-btn" onclick="loadDashboard()">Refresh</button>
        <span id="lastUpdated"></span>
      </div>
      
      <div class="panels">
        <!-- Panel 1: Event Stream -->
        <div class="panel">
          <h3>Event Stream</h3>
          <div id="eventStream"></div>
        </div>
        
        <!-- Panel 2: Error Focus -->
        <div class="panel error">
          <h3>Error Focus</h3>
          <div id="errorFocus"></div>
        </div>
        
        <!-- Panel 3: Processing State -->
        <div class="panel">
          <h3>Processing State</h3>
          <div id="statusCounts"></div>
        </div>
        
        <!-- Panel 4: Retry Tracker -->
        <div class="panel task">
          <h3>Retry / Failure Tracker</h3>
          <div id="retryTracker"></div>
        </div>
      </div>
      
      <script>
        let eventSource;
        
        function connectEventStream() {
          eventSource = new EventSource('/events/stream');
          
          eventSource.onmessage = function(event) {
            try {
              const data = JSON.parse(event.data);
              updateDashboard(data);
            } catch (error) {
              console.error('Failed to parse event data:', error);
            }
          };
          
          eventSource.onerror = function(error) {
            console.error('EventStream error:', error);
            // Try to reconnect after 3 seconds
            setTimeout(connectEventStream, 3000);
          };
        }
        
        function updateDashboard(data) {
          if (data.error) {
            console.error('Dashboard update error:', data.error);
            return;
          }
          
          // Update last updated
          document.getElementById('lastUpdated').textContent = 'Live: ' + new Date(data.timestamp).toLocaleTimeString();
          
          // Panel 1: Event Stream
          const eventStream = document.getElementById('eventStream');
          eventStream.innerHTML = data.events.map(event => {
            const typeClass = event.type;
            return \`
              <div class="event-item \${typeClass}">
                <span class="event-id">\${event.event_id.substring(0, 8)}...</span>
                <strong>\${event.type.toUpperCase()}</strong> - \${event.status}
                <br><small>\${new Date(event.timestamp).toLocaleString()}</small>
                <br><small>\${JSON.stringify(event.payload).substring(0, 60)}...</small>
              </div>
            \`;
          }).join('');
          
          // Panel 3: Processing State (real-time)
          const statusCounts = document.getElementById('statusCounts');
          const counts = data.statusCounts;
          statusCounts.innerHTML = \`
            <div class="status-grid">
              <div class="status-item">
                <div class="status-count">\${counts.pending || 0}</div>
                <div class="status-label">Pending</div>
              </div>
              <div class="status-item">
                <div class="status-count">\${counts.processed || 0}</div>
                <div class="status-label">Processed</div>
              </div>
              <div class="status-item">
                <div class="status-count">\${counts.failed || 0}</div>
                <div class="status-label">Failed</div>
              </div>
            </div>
          \`;
        }
        
        // Load initial dashboard data
        async function loadInitialDashboard() {
          try {
            const response = await fetch('/dashboard');
            const data = await response.json();
            
            // Panel 2: Error Focus
            const errorFocus = document.getElementById('errorFocus');
            errorFocus.innerHTML = data.errors.map(error => \`
              <div class="event-item error">
                <span class="event-id">\${error.event_id.substring(0, 8)}...</span>
                <strong>ERROR</strong> - \${error.status}
                <br><small>\${new Date(error.timestamp).toLocaleString()}</small>
                <br><small>\${JSON.stringify(error.payload).substring(0, 80)}...</small>
                \${error.ai_analysis ? \`<br><strong>AI:</strong> \${error.ai_analysis.substring(0, 60)}...\` : ''}
                \${error.retries > 0 ? \`<br><strong>Retries:</strong> \${error.retries}\` : ''}
              </div>
            \`).join('');
            
            // Panel 4: Retry Tracker
            const retryTracker = document.getElementById('retryTracker');
            retryTracker.innerHTML = data.retries.map(retry => \`
              <div class="event-item task">
                <span class="event-id">\${retry.event_id.substring(0, 8)}...</span>
                <strong>\${retry.type.toUpperCase()}</strong> - \${retry.status}
                <br><small>\${new Date(retry.timestamp).toLocaleString()}</small>
                <br><strong>Retries:</strong> \${retry.retries}
                \${retry.status === 'failed' ? '<br><strong>FAILED</strong>' : ''}
              </div>
            \`).join('');
            
          } catch (error) {
            console.error('Failed to load initial dashboard:', error);
          }
        }
        
        // Initialize
        loadInitialDashboard();
        connectEventStream();
      </script>
      
      <h2>All Events</h2>
      <a href="/events">View All Events</a>
    </body>
    </html>
  `);
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Ursula dashboard running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} for the dashboard`);
});
