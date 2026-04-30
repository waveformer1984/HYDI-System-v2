/**
 * HYDI SYSTEM INTEGRATION EXAMPLE
 * 
 * This shows how to use the complete HYDI system with all 5 layers:
 * 
 * 1. Interface (You ↔ Heidi)
 * 2. Orchestrator (The Brainstem)  
 * 3. Model Stack (Hybrid Intelligence)
 * 4. Memory System (Session, Database, Reflective)
 * 5. Action Layer (Stripe, emails, DB operations)
 * 
 * Plus:
 * - Core Loop (Observe→Evaluate→Decide→Act→Measure→Reflect→Adapt)
 * - Self-Awareness (Drift detection, reflection engine)
 * - Revenue Engine (Stripe integration, offer engine)
 */

const HYDISystem = require('./src/HYDISystem');

async function demonstrateHYDISystem() {
  console.log('🚀 Starting HYDI System Demonstration...\n');
  
  // Initialize HYDI with your configuration
  const hydi = new HYDISystem({
    // Enable all features for demo
    enableRevenueMode: true,
    enableSelfAwareness: true,
    enableAutoActions: true,
    
    // Model settings
    localFirst: true,
    confidenceThreshold: 0.7,
    costThreshold: 0.10,
    
    // Loop settings
    loopInterval: 30000, // 30 seconds for demo (normally 1 minute)
    observationInterval: 120000, // 2 minutes for demo
    
    // Revenue settings
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    enableAutoOffers: true
  });
  
  try {
    // Start the system
    console.log('📍 Starting HYDI System...');
    await hydi.start();
    console.log('✅ HYDI System started successfully!\n');
    
    // Wait a moment for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Example 1: Intelligence Request
    console.log('🧠 Example 1: Intelligence Request');
    console.log('----------------------------------------');
    
    const intelligenceResponse = await hydi.processRequest({
      type: 'question',
      instruction: 'What are the key factors for successful AI system architecture?',
      context: {
        userId: 'user123',
        tier: 'pro'
      }
    });
    
    console.log('Response:', intelligenceResponse.result.text?.substring(0, 200) + '...');
    console.log('Model used:', intelligenceResponse.result.model);
    console.log('Strategy:', intelligenceResponse.result.strategy);
    console.log('✅ Intelligence request completed\n');
    
    // Example 2: Revenue Generation
    console.log('💰 Example 2: Revenue Generation');
    console.log('----------------------------------------');
    
    const offerResponse = await hydi.processRequest({
      type: 'revenue',
      subtype: 'generate_offer',
      context: {
        userId: 'user123',
        isNewUser: true,
        email: 'user@example.com'
      }
    });
    
    console.log('Offer generated:', offerResponse.result.title);
    console.log('Offer type:', offerResponse.result.type);
    console.log('Pricing:', offerResponse.result.pricing);
    console.log('Checkout URL:', offerResponse.result.checkout?.url);
    console.log('✅ Revenue request completed\n');
    
    // Example 3: Action Execution
    console.log('⚡ Example 3: Action Execution');
    console.log('----------------------------------------');
    
    const actionResponse = await hydi.processRequest({
      type: 'action',
      subtype: 'send_email',
      params: {
        to: 'user@example.com',
        subject: 'Your HYDI Offer is Ready!',
        html: '<h1>Special Offer Just For You</h1><p>Check out your personalized HYDI offer.</p>'
      },
      context: {
        userId: 'user123'
      }
    });
    
    console.log('Email sent:', actionResponse.result.messageId);
    console.log('Provider:', actionResponse.result.provider);
    console.log('✅ Action request completed\n');
    
    // Example 4: System Status
    console.log('📊 Example 4: System Status');
    console.log('----------------------------------------');
    
    const statusResponse = await hydi.processRequest({
      type: 'system',
      subtype: 'status',
      context: {
        userId: 'admin'
      }
    });
    
    console.log('HYDI Version:', statusResponse.result.version);
    console.log('System Running:', statusResponse.result.running);
    console.log('Uptime:', Math.round(statusResponse.result.uptime / 1000) + ' seconds');
    console.log('Core Loop Status:', statusResponse.result.layers.coreLoop.activeLoops + ' active loops');
    
    if (statusResponse.result.layers.selfAwareness) {
      console.log('Self-Awareness Level:', statusResponse.result.layers.selfAwareness.selfAwareness.level);
      console.log('Drift Score:', statusResponse.result.layers.selfAwareness.drift.score.toFixed(3));
    }
    
    if (statusResponse.result.layers.revenueEngine) {
      console.log('Revenue Generated:', '$' + statusResponse.result.layers.revenueEngine.revenue.total.toFixed(2));
      console.log('Conversion Rate:', (statusResponse.result.layers.revenueEngine.revenue.conversionRate * 100).toFixed(1) + '%');
    }
    
    console.log('✅ System status retrieved\n');
    
    // Example 5: Self-Awareness Report
    console.log('🪞 Example 5: Self-Awareness Report');
    console.log('----------------------------------------');
    
    const awarenessResponse = await hydi.processRequest({
      type: 'system',
      subtype: 'self_awareness',
      context: {
        userId: 'admin'
      }
    });
    
    if (awarenessResponse.result.error) {
      console.log('Self-awareness not available:', awarenessResponse.result.error);
    } else {
      console.log('Self-Awareness Level:', awarenessResponse.result.level);
      console.log('Confidence:', (awarenessResponse.result.confidence * 100).toFixed(1) + '%');
      console.log('Health Score:', (awarenessResponse.result.healthScore * 100).toFixed(1) + '%');
      console.log('Capabilities:', Object.keys(awarenessResponse.result.capabilities).filter(k => awarenessResponse.result.capabilities[k]).join(', '));
      console.log('Limitations:', awarenessResponse.result.limitations.length + ' identified');
    }
    
    console.log('✅ Self-awareness report retrieved\n');
    
    // Example 6: Revenue Report
    console.log('💳 Example 6: Revenue Report');
    console.log('----------------------------------------');
    
    const revenueResponse = await hydi.processRequest({
      type: 'system',
      subtype: 'revenue_report',
      context: {
        userId: 'admin'
      }
    });
    
    if (revenueResponse.result.error) {
      console.log('Revenue engine not available:', revenueResponse.result.error);
    } else {
      console.log('Total Revenue:', '$' + revenueResponse.result.total.toFixed(2));
      console.log('Today\'s Revenue:', '$' + revenueResponse.result.today.toFixed(2));
      console.log('Conversion Rate:', (revenueResponse.result.conversionRate * 100).toFixed(1) + '%');
      console.log('Average Order Value:', '$' + revenueResponse.result.averageOrderValue.toFixed(2));
      console.log('Offers Generated:', revenueResponse.result.metrics.offersGenerated);
      console.log('Offers Converted:', revenueResponse.result.metrics.offersConverted);
    }
    
    console.log('✅ Revenue report retrieved\n');
    
    // Let the system run for a bit to demonstrate the core loop
    console.log('⏱️  Letting HYDI run for 60 seconds to demonstrate the core loop...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    // Show final status
    console.log('\n📈 Final System Status');
    console.log('----------------------------------------');
    
    const finalStatus = hydi.getSystemStatus();
    console.log('Loops Completed:', finalStatus.layers.coreLoop.metrics.loopsCompleted);
    console.log('Actions Taken:', finalStatus.layers.actionLayer.active);
    
    if (finalStatus.layers.selfAwareness) {
      console.log('Drift Score:', finalStatus.layers.selfAwareness.drift.score.toFixed(3));
      console.log('Self-Awareness Level:', finalStatus.layers.selfAwareness.selfAwareness.level);
    }
    
    if (finalStatus.layers.revenueEngine) {
      console.log('Total Revenue:', '$' + finalStatus.layers.revenueEngine.revenue.total.toFixed(2));
    }
    
    console.log('\n🎉 HYDI System Demonstration Complete!');
    console.log('----------------------------------------');
    console.log('✅ All 5 layers working together');
    console.log('✅ Core loop running continuously');
    console.log('✅ Self-awareness tracking performance');
    console.log('✅ Revenue engine generating offers');
    console.log('✅ System adapting and learning');
    
  } catch (error) {
    console.error('❌ Demonstration failed:', error.message);
    console.error(error.stack);
  } finally {
    // Clean shutdown
    console.log('\n🛑 Shutting down HYDI System...');
    await hydi.shutdown();
    console.log('✅ HYDI System stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted by user');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught exception:', error);
  process.exit(1);
});

// Run the demonstration
if (require.main === module) {
  console.log('🔧 HYDI System Integration Example');
  console.log('=====================================\n');
  
  // Check for required environment variables
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('⚠️  Warning: STRIPE_SECRET_KEY not set, revenue features will be limited');
  }
  
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️  Warning: No external API keys found, using local models only');
  }
  
  demonstrateHYDISystem().catch(error => {
    console.error('\n💥 Demonstration failed:', error);
    process.exit(1);
  });
}

module.exports = { demonstrateHYDISystem };
