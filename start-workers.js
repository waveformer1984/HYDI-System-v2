#!/usr/bin/env node
/**
 * Start HYDI Worker System
 * Simple script to launch the worker orchestrator
 */

const WorkerOrchestrator = require('./workers/WorkerOrchestrator');

console.log('🚀 Starting HYDI Worker System...\n');

const orchestrator = new WorkerOrchestrator();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down workers...');
    await orchestrator.stop();
    console.log('✅ All workers stopped safely');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Shutting down workers...');
    await orchestrator.stop();
    console.log('✅ All workers stopped safely');
    process.exit(0);
});

// Handle uncaught errors
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled rejection:', err);
    orchestrator.stop().then(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    orchestrator.stop().then(() => process.exit(1));
});

// Start the orchestrator
orchestrator.start()
    .then(() => {
        console.log('\n✅ HYDI Worker System is running!');
        console.log('📊 Check the dashboard for worker status');
        console.log('Press Ctrl+C to stop\n');
    })
    .catch(err => {
        console.error('\n❌ Failed to start worker system:', err);
        console.error('\nPlease check:');
        console.error('1. Supabase credentials in .env');
        console.error('2. Database connection');
        console.error('3. Queue tables are created\n');
        process.exit(1);
    });
