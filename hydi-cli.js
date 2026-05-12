#!/usr/bin/env node

require('dotenv').config();
const { processEvent } = require('./core/pipeline');

// CLI interface for HYDI system
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
HYDI CLI - Event Processing Interface

Usage:
  node hydi-cli.js <command> [options]

Commands:
  error <message>           Send error event
  task <task-name>          Send task event  
  info <message>            Send info event
  test                      Run pipeline test
  status                    Show system status
  help                      Show this help

Examples:
  node hydi-cli.js error "Database connection failed"
  node hydi-cli.js task "backup_database"
  node hydi-cli.js info "System startup complete"
  node hydi-cli.js test
    `);
    return;
  }

  const command = args[0];
  
  switch (command) {
    case 'error':
      if (!args[1]) {
        console.error('ERROR: Message required for error command');
        process.exit(1);
      }
      await sendEvent('error', { message: args[1], source: 'cli' });
      break;
      
    case 'task':
      if (!args[1]) {
        console.error('ERROR: Task name required for task command');
        process.exit(1);
      }
      await sendEvent('task', { name: args[1], source: 'cli' });
      break;
      
    case 'info':
      if (!args[1]) {
        console.error('ERROR: Message required for info command');
        process.exit(1);
      }
      await sendEvent('info', { message: args[1], source: 'cli' });
      break;
      
    case 'test':
      console.log('Running pipeline test...');
      await sendEvent('error', { message: 'synthetic test error', source: 'cli-test' });
      await sendEvent('task', { name: 'test_task', source: 'cli-test' });
      await sendEvent('info', { message: 'test info message', source: 'cli-test' });
      console.log('Test complete - check dashboard at http://localhost:3002');
      break;
      
    case 'status':
      await checkStatus();
      break;
      
    case 'help':
      console.log(`
HYDI CLI - Event Processing Interface

Usage:
  node hydi-cli.js <command> [options]

Commands:
  error <message>           Send error event
  task <task-name>          Send task event  
  info <message>            Send info event
  test                      Run pipeline test
  status                    Show system status
  help                      Show this help

Examples:
  node hydi-cli.js error "Database connection failed"
  node hydi-cli.js task "backup_database"
  node hydi-cli.js info "System startup complete"
  node hydi-cli.js test
      `);
      break;
      
    default:
      console.error(`ERROR: Unknown command "${command}"`);
      console.log('Run "node hydi-cli.js help" for usage');
      process.exit(1);
  }
}

async function sendEvent(type, payload) {
  try {
    const result = await processEvent('cli', type, payload);
    console.log(`[${type.toUpperCase()}] Route: ${result.route.action} | Priority: ${result.route.priority} | Event ID: ${result.event.event_id}`);
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exit(1);
  }
}

async function checkStatus() {
  const http = require('http');
  
  console.log('HYDI System Status:');
  console.log('==================');
  
  // Check ProtoForge (port 3001)
  try {
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 3001, path: '/health', timeout: 2000 }, (res) => {
        console.log('ProtoForge: UP (port 3001)');
        resolve();
      });
      req.on('error', () => reject());
      req.on('timeout', () => reject());
      req.end();
    });
  } catch (e) {
    console.log('ProtoForge: DOWN (port 3001)');
  }
  
  // Check Ursula Dashboard (port 3002)
  try {
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 3002, path: '/', timeout: 2000 }, (res) => {
        console.log('Ursula Dashboard: UP (port 3002)');
        resolve();
      });
      req.on('error', () => reject());
      req.on('timeout', () => reject());
      req.end();
    });
  } catch (e) {
    console.log('Ursula Dashboard: DOWN (port 3002)');
  }
  
  // Check AI Analyzer (port 8000)
  try {
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 8000, path: '/', timeout: 2000 }, (res) => {
        console.log('AI Analyzer: UP (port 8000)');
        resolve();
      });
      req.on('error', () => reject());
      req.on('timeout', () => reject());
      req.end();
    });
  } catch (e) {
    console.log('AI Analyzer: DOWN (port 8000)');
  }
  
  console.log('\nDashboard: http://localhost:3002');
  console.log('ProtoForge API: http://localhost:3001');
}

if (require.main === module) {
  main().catch(error => {
    console.error('CLI ERROR:', error.message);
    process.exit(1);
  });
}

module.exports = { main, sendEvent, checkStatus };
