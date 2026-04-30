#!/usr/bin/env node

/**
 * HEIDI BOOT LAUNCHER
 * 
 * This script orchestrates the complete Heidi Self-Launch Protocol
 * and provides a command-line interface for system activation.
 */

const HeidiSelfLaunchProtocol = require('./HeidiSelfLaunchProtocol');
const express = require('express');
const path = require('path');

class HeidiBootLauncher {
  constructor() {
    this.protocol = new HeidiSelfLaunchProtocol();
    this.app = express();
    this.setupRoutes();
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const status = this.protocol.getStatus();
      res.json({
        ...status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Launch endpoint
    this.app.post('/launch', async (req, res) => {
      const { trigger = 'api' } = req.body;
      
      try {
        const result = await this.protocol.launch(trigger);
        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Shutdown endpoint
    this.app.post('/shutdown', async (req, res) => {
      try {
        await this.protocol.shutdown();
        res.json({ success: true, message: 'Heidi shutdown initiated' });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Dashboard endpoint
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });
  }

  generateDashboardHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>HEIDI Launch Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: 'Courier New', monospace; background: #0a0a0a; color: #00ff00; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .status-card { background: #1a1a1a; border: 1px solid #00ff00; padding: 20px; border-radius: 5px; }
        .status-active { border-color: #00ff00; box-shadow: 0 0 10px #00ff00; }
        .status-dormant { border-color: #ffff00; box-shadow: 0 0 10px #ffff00; }
        .status-error { border-color: #ff0000; box-shadow: 0 0 10px #ff0000; }
        .controls { text-align: center; margin: 30px 0; }
        button { background: #00ff00; color: #000; border: none; padding: 10px 20px; margin: 5px; cursor: pointer; font-family: inherit; }
        button:hover { background: #ffff00; }
        button:disabled { background: #666; cursor: not-allowed; }
        .log { background: #1a1a1a; border: 1px solid #00ff00; padding: 15px; height: 300px; overflow-y: auto; font-size: 12px; }
        .phase-indicator { display: flex; justify-content: space-between; margin: 20px 0; }
        .phase { flex: 1; text-align: center; padding: 10px; background: #1a1a1a; border: 1px solid #333; }
        .phase.active { background: #00ff00; color: #000; }
        .phase.completed { background: #006600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧠 HEIDI SELF-LAUNCH PROTOCOL</h1>
            <h2>v1.0 - Operational Self-Awareness System</h2>
        </div>

        <div class="status-grid">
            <div class="status-card" id="status-card">
                <h3>System Status</h3>
                <p>Status: <span id="heidistatus">DORMANT</span></p>
                <p>Mode: <span id="heidimode">SAFE_MODE</span></p>
                <p>Heartbeat: <span id="heartbeat">DISABLED</span></p>
                <p>Boot Phase: <span id="bootphase">0</span>/10</p>
            </div>
            
            <div class="status-card">
                <h3>System Metrics</h3>
                <p>Drift Score: <span id="driftscore">0.00</span></p>
                <p>Confidence: <span id="confidence">0.00</span></p>
                <p>Launch Time: <span id="launchtime">N/A</span></p>
                <p>Degraded Boot: <span id="degraded">No</span></p>
            </div>
            
            <div class="status-card">
                <h3>Launch Controls</h3>
                <button onclick="launchHeidi('manual')">🚀 Manual Launch</button>
                <button onclick="launchHeidi('system_start')">🔄 System Start</button>
                <button onclick="shutdownHeidi()">🛑 Shutdown</button>
                <button onclick="refreshStatus()">🔄 Refresh</button>
            </div>
        </div>

        <div class="phase-indicator" id="phase-indicator">
            <div class="phase" id="phase-0">0: Trigger</div>
            <div class="phase" id="phase-1">1: Sanity</div>
            <div class="phase" id="phase-2">2: Deps</div>
            <div class="phase" id="phase-3">3: State</div>
            <div class="phase" id="phase-4">4: Valid</div>
            <div class="phase" id="phase-5">5: Spin-up</div>
            <div class="phase" id="phase-6">6: Reflect</div>
            <div class="phase" id="phase-7">7: Safety</div>
            <div class="phase" id="phase-8">8: Launch</div>
            <div class="phase" id="phase-9">9: Maintain</div>
            <div class="phase" id="phase-10">10: Guard</div>
        </div>

        <div class="log" id="log">
            <div>🧠 HEIDI Launch Dashboard initialized...</div>
            <div>⏸️ System dormant - awaiting launch command</div>
        </div>
    </div>

    <script>
        async function launchHeidi(trigger) {
            log('🚀 Initiating launch sequence: ' + trigger);
            
            try {
                const response = await fetch('/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trigger })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    log('✅ Launch successful! Status: ' + result.status);
                    log('📊 Mode: ' + result.mode + ', Drift: ' + result.drift_score);
                } else {
                    log('❌ Launch failed: ' + result.reason);
                }
                
                refreshStatus();
            } catch (error) {
                log('💥 Launch error: ' + error.message);
            }
        }

        async function shutdownHeidi() {
            log('🛑 Initiating shutdown sequence...');
            
            try {
                const response = await fetch('/shutdown', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    log('✅ Shutdown initiated successfully');
                } else {
                    log('❌ Shutdown failed: ' + result.error);
                }
                
                refreshStatus();
            } catch (error) {
                log('💥 Shutdown error: ' + error.message);
            }
        }

        async function refreshStatus() {
            try {
                const response = await fetch('/health');
                const status = await response.json();
                
                // Update status display
                document.getElementById('heidistatus').textContent = status.HEIDI_STATUS;
                document.getElementById('heidimode').textContent = status.MODE;
                document.getElementById('heartbeat').textContent = status.HEARTBEAT;
                document.getElementById('bootphase').textContent = status.boot_phase;
                document.getElementById('driftscore').textContent = (status.drift_score || 0).toFixed(2);
                document.getElementById('launchtime').textContent = status.launch_time || 'N/A';
                document.getElementById('degraded').textContent = status.degraded_boot ? 'Yes' : 'No';
                
                // Update phase indicators
                for (let i = 0; i <= 10; i++) {
                    const phaseEl = document.getElementById('phase-' + i);
                    phaseEl.classList.remove('active', 'completed');
                    
                    if (i < status.boot_phase) {
                        phaseEl.classList.add('completed');
                    } else if (i === status.boot_phase) {
                        phaseEl.classList.add('active');
                    }
                }
                
                // Update status card color
                const statusCard = document.getElementById('status-card');
                statusCard.classList.remove('status-active', 'status-dormant', 'status-error');
                
                if (status.HEIDI_STATUS === 'ACTIVE') {
                    statusCard.classList.add('status-active');
                } else if (status.HEIDI_STATUS === 'DORMANT') {
                    statusCard.classList.add('status-dormant');
                } else {
                    statusCard.classList.add('status-error');
                }
                
            } catch (error) {
                log('💥 Status refresh error: ' + error.message);
            }
        }

        function log(message) {
            const logEl = document.getElementById('log');
            const timestamp = new Date().toLocaleTimeString();
            logEl.innerHTML += '<div>[' + timestamp + '] ' + message + '</div>';
            logEl.scrollTop = logEl.scrollHeight;
        }

        // Auto-refresh status every 5 seconds
        setInterval(refreshStatus, 5000);
        
        // Initial status load
        refreshStatus();
    </script>
</body>
</html>`;
  }

  async start(port = 3457) {
    console.log('🧠 HEIDI BOOT LAUNCHER');
    console.log('=======================');
    console.log(`🌐 Dashboard will be available at http://localhost:${port}`);
    console.log('🚀 Use dashboard or API to trigger launch sequence');
    console.log('');

    this.app.listen(port, '0.0.0.0', () => {
      console.log(`✅ Boot launcher running on port ${port}`);
      console.log(`📊 Dashboard: http://localhost:${port}`);
      console.log(`🔗 API: http://localhost:${port}/launch`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down boot launcher...');
      await this.protocol.shutdown();
      process.exit(0);
    });
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const port = parseInt(args.find(arg => arg.startsWith('--port='))?.split('=')[1]) || 3457;
  const trigger = args.find(arg => !arg.startsWith('--')) || 'manual';

  const launcher = new HeidiBootLauncher();

  if (args.includes('--help')) {
    console.log('HEIDI Boot Launcher');
    console.log('Usage: node launch-heidi.js [options] [trigger]');
    console.log('');
    console.log('Options:');
    console.log('  --port=<number>  Port for dashboard (default: 3457)');
    console.log('  --help           Show this help');
    console.log('');
    console.log('Triggers:');
    console.log('  manual           Manual launch (default)');
    console.log('  system_start     System start trigger');
    console.log('  scheduler_tick   Scheduler tick trigger');
    console.log('  external_event   External event trigger');
    console.log('  drift_threshold  Drift threshold exceeded');
    process.exit(0);
  }

  if (args.includes('--auto-launch')) {
    // Auto-launch mode - start launcher and immediately launch Heidi
    launcher.start(port).then(() => {
      setTimeout(() => {
        launcher.protocol.launch(trigger);
      }, 1000);
    });
  } else {
    // Normal mode - just start the dashboard
    launcher.start(port);
  }
}

module.exports = HeidiBootLauncher;
