/**
 * Test Single Worker
 * Tests if a single worker can connect and initialize
 */

const QueueManager = require('./workers/QueueManager');
require('dotenv').config();

async function testSingleWorker() {
    console.log('🧪 Testing Single Worker Connection...\n');
    
    // Check environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log(`📍 URL: ${supabaseUrl ? 'Present' : 'Missing'}`);
    console.log(`🔑 Key: ${supabaseKey && !supabaseKey.includes('YOUR_SERVICE_ROLE_KEY_HERE') ? 'Present' : 'Missing or placeholder'}`);
    
    if (!supabaseUrl || !supabaseKey || supabaseKey.includes('YOUR_SERVICE_ROLE_KEY_HERE')) {
        console.log('\n❌ Please update your .env file with the correct Supabase Service Role Key');
        console.log('Run: node update-env-key.js');
        return false;
    }
    
    try {
        // Test queue manager
        console.log('\n🔌 Testing Queue Manager...');
        const queue = new QueueManager();
        await queue.initialize();
        
        // Register a test worker
        await queue.registerWorker('test_worker', 'test-001');
        console.log('✅ Worker registered successfully');
        
        // Get queue stats
        const stats = await queue.getQueueStats();
        console.log('✅ Queue stats retrieved:', stats);
        
        // Cleanup
        await queue.shutdown();
        console.log('✅ Test completed successfully!');
        
        return true;
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.message.includes('Invalid API key')) {
            console.log('\n🔑 The Service Role Key is invalid. Please get a new one from Supabase dashboard.');
        }
        return false;
    }
}

testSingleWorker();
