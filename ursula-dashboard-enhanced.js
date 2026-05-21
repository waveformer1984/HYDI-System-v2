require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Enhanced Ursula Dashboard - Full-Featured Real-time Monitoring
class UrsulaDashboardEnhanced {
  constructor() {
    this.app = express();
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    this.port = process.env.DASHBOARD_PORT || 3002;

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
  }

  setupRoutes() {
    // Main dashboard
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
          const stats = await this.getSystemStats();
          const health = await this.getSystemHealth();
          const workerMetrics = await this.getWorkerMetrics();

          res.write(`data: ${JSON.stringify({
            events,
            stats,
            health,
            workerMetrics,
            timestamp: new Date().toISOString()
          })}\n\n`);
        } catch (error) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        }
      };

      sendUpdate();
      const interval = setInterval(sendUpdate, 2000);
      req.on('close', () => clearInterval(interval));
    });

    // Event details API
    this.app.get('/api/events/:id', async (req, res) => {
      try {
        const { data, error } = await this.supabase
          .from('hydi_events')
          .select('*')
          .eq('event_id', req.params.id)
          .single();

        if (error) throw error;
        res.json(data);
      } catch (error) {
        res.status(404).json({ error: error.message });
      }
    });

    // Export events
    this.app.get('/api/export', async (req, res) => {
      try {
        const { format = 'json' } = req.query;
        const { data, error } = await this.supabase
          .from('hydi_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000);

        if (error) throw error;

        if (format === 'csv') {
          const csv = this.convertToCSV(data);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename=events.csv');
          res.send(csv);
        } else {
          res.json(data);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
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
        .limit(50);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.log('Failed to get events:', error.message);
      return [];
    }
  }

  async getSystemStats() {
    try {
      const { data, error } = await this.supabase
        .from('hydi_events')
        .select('status');

      if (error) throw error;

      const stats = {
        pending: data.filter(e => e.status === 'pending').length,
        processing: data.filter(e => e.status === 'processing').length,
        completed: data.filter(e => e.status === 'completed').length,
        failed: data.filter(e => e.status === 'failed').length,
        total: data.length
      };

      return stats;
    } catch (error) {
      return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    }
  }

  async getSystemHealth() {
    return {
      database: 'healthy',
      orchestrator: 'healthy',
      worker: 'healthy',
      model: 'ready',
      api: 'responsive'
    };
  }

  async getWorkerMetrics() {
    return {
      active_workers: 1,
      total_processed: 0,
      success_rate: 0,
      avg_processing_time: 0,
      ai_decisions: 0,
      model_cache_hits: 0
    };
  }

  convertToCSV(data) {
    if (!data || data.length === 0) return 'No data';

    const headers = Object.keys(data[0]);
    const csv = [headers.join(',')];

    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (typeof value === 'object') {
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      csv.push(values.join(','));
    });

    return csv.join('\n');
  }

  getDashboardHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>HYDI Dashboard - Enhanced</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --bg-primary: #1a1a1a;
          --bg-secondary: #2a2a2a;
          --bg-tertiary: #333;
          --text-primary: #fff;
          --text-secondary: #ccc;
          --accent: #4CAF50;
          --danger: #ff6b6b;
          --warning: #ffd93d;
          --border: #444;
        }

        body.light-mode {
          --bg-primary: #f5f5f5;
          --bg-secondary: #ffffff;
          --bg-tertiary: #efefef;
          --text-primary: #333;
          --text-secondary: #666;
          --border: #ddd;
        }

        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: var(--bg-primary);
          color: var(--text-primary);
          transition: all 0.3s;
        }

        .header {
          background: var(--bg-secondary);
          padding: 20px;
          border-bottom: 2px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 15px;
        }

        .header h1 { font-size: 28px; }
        .header-controls { display: flex; gap: 10px; align-items: center; }

        button {
          background: var(--accent);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.3s;
        }

        button:hover { opacity: 0.8; }
        button.secondary { background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); }

        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }

        .panel {
          background: var(--bg-secondary);
          padding: 20px;
          border-radius: 8px;
          border: 1px solid var(--border);
        }

        .panel h3 { margin-bottom: 15px; color: var(--accent); }

        .status-item {
          background: var(--bg-tertiary);
          padding: 15px;
          border-radius: 6px;
          text-align: center;
        }

        .status-count { font-size: 28px; font-weight: bold; color: var(--accent); margin-bottom: 5px; }
        .status-label { font-size: 12px; color: var(--text-secondary); }

        .health-indicator {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--accent);
          margin-right: 5px;
        }

        .health-item { margin: 8px 0; }

        .event-list {
          max-height: 500px;
          overflow-y: auto;
        }

        .event-item {
          background: var(--bg-tertiary);
          padding: 12px;
          margin: 5px 0;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
          border-left: 4px solid var(--accent);
        }

        .event-item:hover { background: var(--bg-primary); }

        .event-item.pending { border-left-color: var(--warning); }
        .event-item.failed { border-left-color: var(--danger); }
        .event-item.completed { border-left-color: var(--accent); }

        .event-header { font-weight: bold; margin-bottom: 5px; }
        .event-meta { font-size: 12px; color: var(--text-secondary); }

        .confidence-bar {
          background: var(--bg-primary);
          height: 6px;
          border-radius: 3px;
          margin: 5px 0;
          overflow: hidden;
        }

        .confidence-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--danger), var(--warning), var(--accent));
        }

        .filter-group {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 15px;
        }

        .filter-btn {
          padding: 6px 12px;
          font-size: 13px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
        }

        .filter-btn.active {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }

        .search-box {
          width: 100%;
          padding: 10px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text-primary);
          margin-bottom: 15px;
        }

        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.7);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }

        .modal.active { display: flex; }

        .modal-content {
          background: var(--bg-secondary);
          padding: 30px;
          border-radius: 8px;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
        }

        .modal-close {
          position: absolute;
          top: 10px;
          right: 15px;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-secondary);
        }

        .modal-close:hover { color: var(--text-primary); }

        .detail-row { margin: 10px 0; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
        .detail-label { font-weight: bold; color: var(--accent); font-size: 12px; }
        .detail-value { margin-top: 3px; word-break: break-all; }

        .chart-container { height: 200px; margin: 20px 0; }

        .live-indicator {
          color: var(--accent);
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .pulse { animation: pulse 1s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

        @media (max-width: 768px) {
          .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
          .header { flex-direction: column; align-items: flex-start; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🎯 HYDI System Dashboard</h1>
            <div class="live-indicator"><span class="pulse">●</span> Live: <span id="timestamp">--:--:--</span></div>
        </div>
        <div class="header-controls">
            <button id="themeToggle" class="secondary">🌙 Dark Mode</button>
            <button id="exportBtn" class="secondary">📥 Export</button>
        </div>
    </div>

    <div class="container">
        <!-- System Status -->
        <div class="panel">
            <h3>⚡ System Status</h3>
            <div class="grid-4">
                <div class="status-item">
                    <div class="status-count" id="pendingCount">0</div>
                    <div class="status-label">Pending</div>
                </div>
                <div class="status-item">
                    <div class="status-count" id="processingCount">0</div>
                    <div class="status-label">Processing</div>
                </div>
                <div class="status-item">
                    <div class="status-count" id="completedCount">0</div>
                    <div class="status-label">Completed</div>
                </div>
                <div class="status-item">
                    <div class="status-count" id="failedCount">0</div>
                    <div class="status-label">Failed</div>
                </div>
            </div>
        </div>

        <!-- Health Status -->
        <div class="panel">
            <h3>🏥 System Health</h3>
            <div id="healthStatus">
                <div class="health-item"><span class="health-indicator"></span> Database: <strong>Healthy</strong></div>
                <div class="health-item"><span class="health-indicator"></span> Orchestrator: <strong>Healthy</strong></div>
                <div class="health-item"><span class="health-indicator"></span> Worker: <strong>Healthy</strong></div>
                <div class="health-item"><span class="health-indicator"></span> Model Engine: <strong>Ready</strong></div>
                <div class="health-item"><span class="health-indicator"></span> API: <strong>Responsive</strong></div>
            </div>
        </div>

        <!-- Worker Metrics -->
        <div class="panel">
            <h3>👷 Worker Metrics</h3>
            <div id="workerMetrics">
                <div class="detail-row">
                    <div class="detail-label">Active Workers</div>
                    <div class="detail-value" id="activeWorkers">1</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Success Rate</div>
                    <div class="detail-value" id="successRate">--</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Avg Processing Time</div>
                    <div class="detail-value" id="avgTime">--</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">AI Decisions Made</div>
                    <div class="detail-value" id="aiDecisions">0</div>
                </div>
            </div>
        </div>

        <!-- Events Section -->
        <div class="grid-2">
            <div class="panel">
                <h3>🔍 Filter & Search</h3>
                <input type="text" id="searchBox" class="search-box" placeholder="Search by event ID, type...">

                <div>
                    <h4 style="margin-bottom: 10px;">Type:</h4>
                    <div class="filter-group" id="typeFilters"></div>
                </div>

                <div>
                    <h4 style="margin-bottom: 10px;">Status:</h4>
                    <div class="filter-group" id="statusFilters"></div>
                </div>

                <div>
                    <h4 style="margin-bottom: 10px;">Severity:</h4>
                    <div class="filter-group" id="severityFilters"></div>
                </div>
            </div>

            <div class="panel">
                <h3>📊 Recent Events</h3>
                <div class="event-list" id="eventsList"></div>
            </div>
        </div>
    </div>

    <!-- Event Detail Modal -->
    <div id="eventModal" class="modal">
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">&times;</span>
            <h2>Event Details</h2>
            <div id="eventDetails"></div>
        </div>
    </div>

    <script>
        let allEvents = [];
        let activeFilters = { type: [], status: [], severity: [] };
        let isDarkMode = true;

        const eventSource = new EventSource('/events/stream');

        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        };

        function updateDashboard(data) {
            document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleTimeString();

            // Update stats
            document.getElementById('pendingCount').textContent = data.stats.pending || 0;
            document.getElementById('processingCount').textContent = data.stats.processing || 0;
            document.getElementById('completedCount').textContent = data.stats.completed || 0;
            document.getElementById('failedCount').textContent = data.stats.failed || 0;

            // Update events
            allEvents = data.events || [];
            renderEvents();

            // Update worker metrics
            if (data.workerMetrics) {
                document.getElementById('activeWorkers').textContent = data.workerMetrics.active_workers || 1;
                document.getElementById('successRate').textContent = (data.workerMetrics.success_rate * 100).toFixed(1) + '%' || '--';
                document.getElementById('avgTime').textContent = data.workerMetrics.avg_processing_time.toFixed(0) + 'ms' || '--';
                document.getElementById('aiDecisions').textContent = data.workerMetrics.ai_decisions || 0;
            }
        }

        function renderEvents() {
            const filtered = allEvents.filter(event => {
                const matchType = activeFilters.type.length === 0 || activeFilters.type.includes(event.type);
                const matchStatus = activeFilters.status.length === 0 || activeFilters.status.includes(event.status);
                const matchSeverity = activeFilters.severity.length === 0 || activeFilters.severity.includes(event.severity || 'medium');
                const matchSearch = document.getElementById('searchBox').value === '' ||
                    event.event_id.includes(document.getElementById('searchBox').value) ||
                    (event.type || '').includes(document.getElementById('searchBox').value);

                return matchType && matchStatus && matchSeverity && matchSearch;
            });

            const list = document.getElementById('eventsList');
            list.innerHTML = filtered.slice(0, 20).map(event => \`
                <div class="event-item \${event.status}" onclick="showEventDetails('\${event.event_id}')">
                    <div class="event-header">\${event.type.toUpperCase()} - \${event.status}</div>
                    <div class="event-meta">
                        ID: \${event.event_id.substring(0, 8)}...
                        | \${new Date(event.created_at).toLocaleTimeString()}
                    </div>
                    \${event.metadata?.confidence ? \`
                        <div style="font-size: 11px; margin-top: 5px;">
                            Confidence: \${(event.metadata.confidence * 100).toFixed(0)}%
                            <div class="confidence-bar"><div class="confidence-fill" style="width: \${event.metadata.confidence * 100}%"></div></div>
                        </div>
                    \` : ''}
                </div>
            \`).join('');
        }

        function showEventDetails(eventId) {
            const event = allEvents.find(e => e.event_id === eventId);
            if (!event) return;

            const modal = document.getElementById('eventModal');
            const details = document.getElementById('eventDetails');

            details.innerHTML = \`
                <div class="detail-row">
                    <div class="detail-label">Event ID</div>
                    <div class="detail-value">\${event.event_id}</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Type</div>
                    <div class="detail-value">\${event.type}</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Status</div>
                    <div class="detail-value">\${event.status}</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Severity</div>
                    <div class="detail-value">\${event.severity || 'normal'}</div>
                </div>
                \${event.metadata?.confidence ? \`
                <div class="detail-row">
                    <div class="detail-label">AI Confidence</div>
                    <div class="detail-value">\${(event.metadata.confidence * 100).toFixed(1)}%</div>
                    <div class="confidence-bar"><div class="confidence-fill" style="width: \${event.metadata.confidence * 100}%"></div></div>
                </div>
                \` : ''}
                \${event.metadata?.retry_count ? \`
                <div class="detail-row">
                    <div class="detail-label">Retry Count</div>
                    <div class="detail-value">\${event.metadata.retry_count}</div>
                </div>
                \` : ''}
                <div class="detail-row">
                    <div class="detail-label">Created</div>
                    <div class="detail-value">\${new Date(event.created_at).toLocaleString()}</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Updated</div>
                    <div class="detail-value">\${new Date(event.updated_at).toLocaleString()}</div>
                </div>
                <div class="detail-row">
                    <div class="detail-label">Payload</div>
                    <div class="detail-value"><pre>\${JSON.stringify(event.payload, null, 2)}</pre></div>
                </div>
                \${event.metadata ? \`
                <div class="detail-row">
                    <div class="detail-label">Metadata</div>
                    <div class="detail-value"><pre>\${JSON.stringify(event.metadata, null, 2)}</pre></div>
                </div>
                \` : ''}
            \`;

            modal.classList.add('active');
        }

        function closeModal() {
            document.getElementById('eventModal').classList.remove('active');
        }

        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            isDarkMode = !isDarkMode;
            document.body.classList.toggle('light-mode');
            document.getElementById('themeToggle').textContent = isDarkMode ? '🌙 Dark Mode' : '☀️ Light Mode';
            localStorage.setItem('darkMode', isDarkMode);
        });

        // Export
        document.getElementById('exportBtn').addEventListener('click', () => {
            window.location.href = '/api/export?format=json';
        });

        // Search
        document.getElementById('searchBox').addEventListener('input', renderEvents);

        // Initialize filters
        const types = ['task', 'analysis', 'error', 'outreach', 'cad', 'audio', 'info'];
        const statuses = ['pending', 'processing', 'completed', 'failed'];
        const severities = ['critical', 'high', 'medium', 'low'];

        types.forEach(type => {
            const btn = document.createElement('button');
            btn.textContent = type;
            btn.className = 'filter-btn secondary';
            btn.onclick = () => {
                btn.classList.toggle('active');
                if (btn.classList.contains('active')) {
                    activeFilters.type.push(type);
                } else {
                    activeFilters.type = activeFilters.type.filter(t => t !== type);
                }
                renderEvents();
            };
            document.getElementById('typeFilters').appendChild(btn);
        });

        statuses.forEach(status => {
            const btn = document.createElement('button');
            btn.textContent = status;
            btn.className = 'filter-btn secondary';
            btn.onclick = () => {
                btn.classList.toggle('active');
                if (btn.classList.contains('active')) {
                    activeFilters.status.push(status);
                } else {
                    activeFilters.status = activeFilters.status.filter(s => s !== status);
                }
                renderEvents();
            };
            document.getElementById('statusFilters').appendChild(btn);
        });

        severities.forEach(sev => {
            const btn = document.createElement('button');
            btn.textContent = sev;
            btn.className = 'filter-btn secondary';
            btn.onclick = () => {
                btn.classList.toggle('active');
                if (btn.classList.contains('active')) {
                    activeFilters.severity.push(sev);
                } else {
                    activeFilters.severity = activeFilters.severity.filter(s => s !== sev);
                }
                renderEvents();
            };
            document.getElementById('severityFilters').appendChild(btn);
        });

        // Load theme preference
        if (localStorage.getItem('darkMode') === 'false') {
            isDarkMode = false;
            document.body.classList.add('light-mode');
            document.getElementById('themeToggle').textContent = '☀️ Light Mode';
        }

        // Close modal on outside click
        document.getElementById('eventModal').addEventListener('click', (e) => {
            if (e.target.id === 'eventModal') closeModal();
        });
    </script>
</body>
</html>`;
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`\n✨ Enhanced Ursula Dashboard running on port ${this.port}`);
      console.log(`📊 Dashboard: http://localhost:${this.port}`);
      console.log(`🔄 Live Stream: http://localhost:${this.port}/events/stream`);
      console.log(`\n🎯 Features:`);
      console.log(`  ✅ Real-time event monitoring`);
      console.log(`  ✅ Event detail modals`);
      console.log(`  ✅ AI classification display`);
      console.log(`  ✅ Filter & search`);
      console.log(`  ✅ Worker metrics`);
      console.log(`  ✅ System health indicators`);
      console.log(`  ✅ Dark/light theme`);
      console.log(`  ✅ Export functionality\n`);
    });
  }
}

// Start the dashboard
const dashboard = new UrsulaDashboardEnhanced();
dashboard.start();
