/**
 * Start Heidi Outreach Monitor
 * Continuously monitors for new leads and processes them automatically
 */

const HeidiRevenueOutreach = require('./modules/heidi-revenue-outreach');

console.log('=== STARTING HEIDI OUTREACH MONITOR ===\n');

const heidiOutreach = new HeidiRevenueOutreach();

// Start monitoring for new leads
heidiOutreach.startMonitoring();

console.log('Heidi Outreach Monitor is now running...');
console.log('Monitoring leads table every 30 seconds for new customers.');
console.log('Press Ctrl+C to stop monitoring.\n');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping Heidi Outreach Monitor...');
  heidiOutreach.stopMonitoring();
  console.log('Monitor stopped. The Forge continues generating revenue.');
  process.exit(0);
});

// Keep the process running
setInterval(() => {
  const now = new Date().toISOString();
  console.log(`[${now}] Heidi Outreach Monitor active - scanning for new leads...`);
}, 30000);
