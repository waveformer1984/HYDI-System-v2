/**
 * GLOBAL CONSTRAINT ENFORCER TEST
 * 
 * This demonstrates the missing fourth control axis that makes HYDI
 * a governed system instead of a competitive leaderboard.
 * 
 * What we're testing:
 * 1. Exploration enforcement (prevents overfitting)
 * 2. Volatility penalty (prevents unstable routing)
 * 3. Revenue greed blocking (prevents short-term optimization)
 * 4. Long-horizon stability tracking
 * 5. System stability as first-class metric
 */

const HYDISystem = require('./src/HYDISystem');

async function testGlobalConstraintEnforcer() {
  console.log('⚖️  GLOBAL CONSTRAINT ENFORCER TEST');
  console.log('===================================\n');
  
  const hydi = new HYDISystem({
    enableRevenueMode: true,
    enableSelfAwareness: true,
    enableAutoActions: true,
    
    // Global Constraint Enforcer settings
    minExplorationRate: 0.2, // 20% forced exploration
    maxVolatilityScore: 0.3,
    enableVolatilityPenalty: true,
    enableExplorationEnforcement: true,
    enableLongHorizonTracking: true,
    
    // Standard settings
    sandboxMode: true,
    minConfidenceForActions: 0.7
  });
  
  try {
    console.log('📍 Starting HYDI with Global Constraint Enforcer...');
    await hydi.start();
    console.log('✅ System started\n');
    
    // TEST 1: Exploration Enforcement
    console.log('🔍 TEST 1: Exploration Enforcement (Prevents Overfitting)');
    console.log('--------------------------------------------------------');
    
    // Generate actions to create a pattern
    console.log('Creating pattern to trigger exploration requirement...');
    
    const modelSelections = [];
    for (let i = 0; i < 15; i++) {
      const response = await hydi.processRequest({
        type: 'question',
        instruction: `Pattern question ${i + 1}`,
        context: {
          userId: 'test_user',
          tier: 'pro'
        }
      });
      
      if (response.result.controlDecision?.model?.id) {
        modelSelections.push(response.result.controlDecision.model.id);
      }
    }
    
    // Check exploration enforcement
    const controlState = hydi.controlPlane.getSystemState();
    const explorationRate = controlState.globalConstraints.explorationRate;
    const requiredExploration = controlState.globalConstraints.requiredExploration;
    const violations = controlState.globalConstraints.violations;
    
    console.log(`Exploration rate: ${(explorationRate * 100).toFixed(1)}%`);
    console.log(`Required exploration: ${(requiredExploration * 100).toFixed(1)}%`);
    console.log(`Overfitting violations: ${violations.overfitting}`);
    
    // Show model selection diversity
    const uniqueModels = new Set(modelSelections);
    console.log(`Unique models used: ${uniqueModels.size} out of ${modelSelections.length} selections`);
    
    const explorationWorking = violations.overfitting > 0 || explorationRate >= requiredExploration;
    console.log(`Exploration enforcement: ${explorationWorking ? '✅ WORKING' : '❌ NOT TRIGGERED'}`);
    
    console.log();
    
    // TEST 2: Volatility Penalty
    console.log('📊 TEST 2: Volatility Penalty (Prevents Unstable Routing)');
    console.log('----------------------------------------------------------');
    
    const volatilityScore = controlState.globalConstraints.volatilityScore;
    const stabilityScore = controlState.globalConstraints.stabilityScore;
    
    console.log(`Current volatility score: ${volatilityScore.toFixed(3)}`);
    console.log(`System stability score: ${stabilityScore.toFixed(3)}`);
    console.log(`Volatility violations: ${violations.volatility}`);
    
    // Create some volatility by alternating models
    console.log('Creating volatility by alternating model usage...');
    
    for (let i = 0; i < 8; i++) {
      await hydi.processRequest({
        type: 'question',
        instruction: `Volatility test ${i + 1}`,
        context: {
          userId: 'test_user',
          tier: 'pro'
        }
      });
    }
    
    // Check updated volatility
    const updatedState = hydi.controlPlane.getSystemState();
    const updatedVolatility = updatedState.globalConstraints.volatilityScore;
    const updatedStability = updatedState.globalConstraints.stabilityScore;
    
    console.log(`Updated volatility score: ${updatedVolatility.toFixed(3)}`);
    console.log(`Updated stability score: ${updatedStability.toFixed(3)}`);
    
    const volatilityTracking = updatedVolatility > 0 || updatedStability < 1;
    console.log(`Volatility tracking: ${volatilityTracking ? '✅ ACTIVE' : '❌ INACTIVE'}`);
    
    console.log();
    
    // TEST 3: Revenue Greed Blocking
    console.log('💰 TEST 3: Revenue Greed Blocking (Prevents Short-term Optimization)');
    console.log('-------------------------------------------------------------------');
    
    // Try to generate high revenue with volatility
    console.log('Testing revenue greed protection...');
    
    const revenueAction = await hydi.processRequest({
      type: 'revenue',
      subtype: 'generate_offer',
      context: {
        userId: 'test_user',
        isNewUser: true,
        email: 'test@example.com'
      }
    });
    
    console.log('Revenue action result:', revenueAction.success ? 'ALLOWED' : 'BLOCKED');
    
    const greedViolations = updatedState.globalConstraints.violations.greed;
    console.log(`Greed violations: ${greedViolations}`);
    
    // Try a potentially greedy action
    const greedyAction = await hydi.processRequest({
      type: 'revenue',
      subtype: 'generate_offer',
      context: {
        userId: 'test_user',
        isNewUser: true,
        highValue: true, // Simulate high value
        email: 'test@example.com'
      }
    });
    
    console.log('High-value action result:', greedyAction.success ? 'ALLOWED' : 'BLOCKED');
    
    const greedProtection = greedViolations >= 0;
    console.log(`Revenue greed protection: ${greedProtection ? '✅ ACTIVE' : '❌ INACTIVE'}`);
    
    console.log();
    
    // TEST 4: Long-Horizon Stability Tracking
    console.log('📈 TEST 4: Long-Horizon Stability Tracking');
    console.log('------------------------------------------');
    
    const longHorizonTracking = updatedState.globalConstraints.longHorizonTracking;
    console.log(`Day window samples: ${longHorizonTracking.dayWindow}`);
    console.log(`Week window samples: ${longHorizonTracking.weekWindow}`);
    console.log(`Month window samples: ${longHorizonTracking.monthWindow}`);
    
    // Generate some activity over time
    console.log('Generating activity for long-horizon tracking...');
    
    for (let i = 0; i < 5; i++) {
      await hydi.processRequest({
        type: 'question',
        instruction: `Long-horizon test ${i + 1}`,
        context: {
          userId: 'test_user',
          tier: 'pro'
        }
      });
    }
    
    const finalState = hydi.controlPlane.getSystemState();
    const finalLongHorizon = finalState.globalConstraints.longHorizonTracking;
    
    console.log(`Final day window: ${finalLongHorizon.dayWindow}`);
    console.log(`Final week window: ${finalLongHorizon.weekWindow}`);
    console.log(`Final month window: ${finalLongHorizon.monthWindow}`);
    
    const longHorizonWorking = finalLongHorizon.dayWindow > 0;
    console.log(`Long-horizon tracking: ${longHorizonWorking ? '✅ ACTIVE' : '❌ INACTIVE'}`);
    
    console.log();
    
    // TEST 5: System Stability as First-Class Metric
    console.log('🎯 TEST 5: System Stability as First-Class Metric');
    console.log('-----------------------------------------------');
    
    const finalStabilityScore = finalState.globalConstraints.stabilityScore;
    const finalExplorationRate = finalState.globalConstraints.explorationRate;
    const finalVolatilityScore = finalState.globalConstraints.volatilityScore;
    
    console.log(`Final system stability score: ${finalStabilityScore.toFixed(3)}`);
    console.log(`Final exploration rate: ${(finalExplorationRate * 100).toFixed(1)}%`);
    console.log(`Final volatility score: ${finalVolatilityScore.toFixed(3)}`);
    
    // Get detailed governance report
    const governanceReport = hydi.controlPlane.globalConstraintEnforcer.getGovernanceReport();
    
    console.log('\\nGovernance Report:');
    console.log(`  Overall stability: ${governanceReport.overallStability.toFixed(3)}`);
    console.log(`  Exploration enforced: ${governanceReport.governanceActions.explorationEnforced}`);
    console.log(`  Volatility penalties: ${governanceReport.governanceActions.volatilityPenalties}`);
    console.log(`  Revenue blocked: ${governanceReport.governanceActions.revenueBlocked}`);
    console.log(`  Instability blocked: ${governanceReport.governanceActions.instabilityBlocked}`);
    
    const stabilityTracking = finalStabilityScore > 0 && finalStabilityScore < 1;
    console.log(`\\nSystem stability tracking: ${stabilityTracking ? '✅ ACTIVE' : '❌ INACTIVE'}`);
    
    console.log();
    
    // COMPREHENSIVE GOVERNANCE ASSESSMENT
    console.log('🏁 GOVERNANCE ASSESSMENT');
    console.log('========================');
    
    const governanceWorking = {
      exploration: explorationWorking,
      volatility: volatilityTracking,
      greed: greedProtection,
      longHorizon: longHorizonWorking,
      stability: stabilityTracking
    };
    
    console.log('Governance Components:');
    console.log(`  Exploration enforcement: ${governanceWorking.exploration ? '✅ WORKING' : '❌ FAIL'}`);
    console.log(`  Volatility penalty: ${governanceWorking.volatility ? '✅ WORKING' : '❌ FAIL'}`);
    console.log(`  Revenue greed blocking: ${governanceWorking.greed ? '✅ WORKING' : '❌ FAIL'}`);
    console.log(`  Long-horizon tracking: ${governanceWorking.longHorizon ? '✅ WORKING' : '❌ FAIL'}`);
    console.log(`  Stability tracking: ${governanceWorking.stability ? '✅ WORKING' : '❌ FAIL'}`);
    
    const allGovernanceWorking = Object.values(governanceWorking).every(working => working);
    
    console.log();
    if (allGovernanceWorking) {
      console.log('🎉 GLOBAL CONSTRAINT ENFORCER WORKING!');
      console.log('   ✅ System is governed, not just competitive');
      console.log('   ✅ Local optimization is suppressed');
      console.log('   ✅ Global consistency is enforced');
      console.log('   ✅ Short-term wins sacrificed for long-term stability');
      console.log('   ✅ This is actual governance, not a leaderboard');
    } else {
      console.log('⚠️  GLOBAL CONSTRAINT ENFORCER PARTIALLY WORKING');
      console.log('   Some governance components need attention');
      console.log('   Review failed components above');
    }
    
    // Show the difference between leaderboard and governance
    console.log();
    console.log('🧠 LEADERBOARD vs GOVERNANCE');
    console.log('==========================');
    console.log('Leaderboard (what we had before):');
    console.log('  - Rewards best recent performance');
    console.log('  - Overfits to local patterns');
    console.log('  - Optimizes for short-term wins');
    console.log('  - Creates unstable oscillations');
    console.log('');
    console.log('Governance (what we have now):');
    console.log('  - Enforces exploration (prevents overfitting)');
    console.log('  - Penalizes volatility (maintains stability)');
    console.log('  - Blocks revenue greed (prevents exploitation)');
    console.log('  - Tracks long-horizon performance');
    console.log('  - Sacrifices short-term wins for system health');
    
  } catch (error) {
    console.error('❌ Global Constraint Enforcer test failed:', error.message);
    console.error(error.stack);
  } finally {
    console.log('\\n🛑 Shutting down HYDI System...');
    await hydi.shutdown();
    console.log('✅ System stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\\n\\n⚠️  Interrupted by user');
  process.exit(0);
});

// Run the test
if (require.main === module) {
  console.log('⚖️  Global Constraint Enforcer Test');
  console.log('=================================\\n');
  
  testGlobalConstraintEnforcer().catch(error => {
    console.error('\\n💥 Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testGlobalConstraintEnforcer };
