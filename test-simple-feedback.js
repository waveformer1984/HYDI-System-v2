/**
 * Simple test to prove feedback loop works
 */

require('dotenv').config();
const HeidiControlPlane = require('./src/control/HeidiControlPlane');

async function testSimpleFeedback() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     SIMPLE FEEDBACK LOOP TEST                ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const controlPlane = new HeidiControlPlane({
    enableAdaptiveLearning: true
  });

  // Get initial thresholds
  const initialThresholds = controlPlane.outcomeValidator.getThresholds();
  console.log('📍 INITIAL THRESHOLDS:');
  console.log(`  → Execution Margin: ${(initialThresholds.executionMinMargin * 100).toFixed(1)}%\n`);

  // STEP 1: Test task with margin below threshold
  console.log('📍 STEP 1: Testing task with 20% margin (below 30% threshold)');
  const testTask = {
    id: 'margin_test',
    type: 'execution',
    estimatedRevenue: 100,
    estimatedCost: 80 // 20% margin
  };

  const firstResult = await controlPlane.realityFilter.filter(testTask);
  console.log(`  Result: ${firstResult.approved ? '✅ APPROVED' : '❌ BLOCKED'}`);
  console.log(`  Reason: ${firstResult.reason || 'None'}\n`);

  // STEP 2: Record many successful outcomes with low margins
  console.log('📍 STEP 2: Recording 20 successful outcomes with 20% margin...');
  
  for (let i = 0; i < 20; i++) {
    const task = {
      id: `task_${i}`,
      type: 'execution',
      estimatedRevenue: 100,
      estimatedCost: 80
    };

    const execution = { cost: 80, duration: 1000 };
    const outcome = { 
      success: true, 
      revenue: 100,
      margin: 20
    };

    await controlPlane.recordTaskOutcome(task, execution, outcome);
  }
  
  console.log('  → Recorded 20 successful outcomes with 20% margin');

  // STEP 3: Force adaptation
  console.log('\n📍 STEP 3: Forcing adaptation...');
  await controlPlane.outcomeValidator.forceAdaptation();

  // Update the filter thresholds
  controlPlane.updateRealityFilterThresholds();

  // STEP 4: Check if thresholds changed
  const newThresholds = controlPlane.outcomeValidator.getThresholds();
  console.log('\n📍 UPDATED THRESHOLDS:');
  console.log(`  → Execution Margin: ${(newThresholds.executionMinMargin * 100).toFixed(1)}%`);

  // STEP 5: Test the same task again
  console.log('\n📍 STEP 4: Testing same task after adaptation');
  const secondResult = await controlPlane.realityFilter.filter(testTask);
  console.log(`  Result: ${secondResult.approved ? '✅ APPROVED' : '❌ BLOCKED'}`);
  console.log(`  Reason: ${secondResult.reason || 'None'}\n`);

  // STEP 6: Verify the loop is closed
  console.log('📍 STEP 5: FEEDBACK LOOP VERIFICATION');
  
  const thresholdChanged = initialThresholds.executionMinMargin !== newThresholds.executionMinMargin;
  const decisionChanged = firstResult.approved !== secondResult.approved;
  
  console.log(`  → Threshold changed: ${thresholdChanged ? '✅ YES' : '❌ NO'}`);
  console.log(`    From: ${(initialThresholds.executionMinMargin * 100).toFixed(1)}%`);
  console.log(`    To: ${(newThresholds.executionMinMargin * 100).toFixed(1)}%`);
  
  console.log(`  → Decision changed: ${decisionChanged ? '✅ YES' : '❌ NO'}`);
  console.log(`    Before: ${firstResult.approved ? 'APPROVED' : 'BLOCKED'}`);
  console.log(`    After: ${secondResult.approved ? 'APPROVED' : 'BLOCKED'}`);

  if (thresholdChanged || decisionChanged) {
    console.log('\n✅ FEEDBACK LOOP IS CLOSED!');
    console.log('   The system learned from outcomes and adapted its behavior.');
    return true;
  } else {
    console.log('\n❌ FEEDBACK LOOP NOT CLOSED');
    console.log('   The system did not adapt based on outcomes.');
    
    // Show adaptation info
    const history = await controlPlane.outcomeValidator.getAdaptationHistory(1);
    if (history.length > 0) {
      console.log('\n📊 Adaptation attempted:');
      console.log(JSON.stringify(history[0], null, 2));
    }
    
    return false;
  }
}

// Run the test
if (require.main === module) {
  testSimpleFeedback()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\nFatal error:', error);
      process.exit(1);
    });
}

module.exports = { testSimpleFeedback };
