/**
 * Test the feedback loop - prove thresholds change
 */

require('dotenv').config();
const HeidiControlPlane = require('./src/control/HeidiControlPlane');

async function testFeedbackLoop() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     TESTING FEEDBACK LOOP - THRESHOLDS       ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const controlPlane = new HeidiControlPlane({
    enableAdaptiveLearning: true
  });

  // Get initial thresholds
  const initialThresholds = controlPlane.outcomeValidator.getThresholds();
  console.log('📍 INITIAL THRESHOLDS:');
  console.log(`  → Outreach Personalization: ${initialThresholds.outreachMinPersonalization}`);
  console.log(`  → Execution Margin: ${(initialThresholds.executionMinMargin * 100).toFixed(1)}%\n`);

  // STEP 1: Test task that will fail current threshold
  console.log('📍 STEP 1: Testing task below threshold');
  const testTask = {
    id: 'test_task',
    type: 'outreach',
    leadSource: 'linkedin', // Valid source
    message: 'Hi there - we offer services',
    personalizationScore: 0.6 // Below 0.7 threshold
  };

  const firstResult = await controlPlane.realityFilter.filter(testTask);
  console.log(`  Result: ${firstResult.approved ? '✅ APPROVED' : '❌ BLOCKED'}`);
  console.log(`  Reason: ${firstResult.reason || 'None'}\n`);

  // STEP 2: Record many successful outcomes with low scores
  console.log('📍 STEP 2: Recording outcomes to trigger adaptation...');
  
  for (let i = 0; i < 15; i++) {
    const task = {
      id: `task_${i}`,
      type: 'outreach',
      leadSource: 'linkedin', // Valid source
      message: `Message ${i}`,
      personalizationScore: 0.6 // Same low score
    };

    const execution = { cost: 50, duration: 1000 };
    const outcome = { 
      success: true, 
      revenue: 100 + (i * 10), // Varying revenue
      leadQuality: 0.8
    };

    await controlPlane.recordTaskOutcome(task, execution, outcome);
  }
  
  console.log('  → Recorded 15 successful outcomes with low personalization scores');

  // STEP 3: Force adaptation
  console.log('\n📍 STEP 3: Forcing adaptation...');
  await controlPlane.outcomeValidator.forceAdaptation();

  // STEP 4: Check if thresholds changed
  const newThresholds = controlPlane.outcomeValidator.getThresholds();
  console.log('\n📍 UPDATED THRESHOLDS:');
  console.log(`  → Outreach Personalization: ${newThresholds.outreachMinPersonalization}`);
  console.log(`  → Execution Margin: ${(newThresholds.executionMinMargin * 100).toFixed(1)}%`);

  // STEP 5: Test the same task again
  console.log('\n📍 STEP 4: Testing same task after adaptation');
  const secondResult = await controlPlane.realityFilter.filter(testTask);
  console.log(`  Result: ${secondResult.approved ? '✅ APPROVED' : '❌ BLOCKED'}`);
  console.log(`  Reason: ${secondResult.reason || 'None'}\n`);

  // STEP 6: Verify the loop is closed
  console.log('📍 STEP 5: FEEDBACK LOOP VERIFICATION');
  
  const thresholdChanged = initialThresholds.outreachMinPersonalization !== newThresholds.outreachMinPersonalization;
  const decisionChanged = firstResult.approved !== secondResult.approved;
  
  console.log(`  → Threshold changed: ${thresholdChanged ? '✅ YES' : '❌ NO'}`);
  console.log(`    From: ${initialThresholds.outreachMinPersonalization}`);
  console.log(`    To: ${newThresholds.outreachMinPersonalization}`);
  
  console.log(`  → Decision changed: ${decisionChanged ? '✅ YES' : '❌ NO'}`);
  console.log(`    Before: ${firstResult.approved ? 'APPROVED' : 'BLOCKED'}`);
  console.log(`    After: ${secondResult.approved ? 'APPROVED' : 'BLOCKED'}`);

  if (thresholdChanged || decisionChanged) {
    console.log('\n✅ FEEDBACK LOOP IS CLOSED!');
    console.log('   The system learned from outcomes and adapted its behavior.');
  } else {
    console.log('\n❌ FEEDBACK LOOP NOT CLOSED');
    console.log('   The system did not adapt based on outcomes.');
  }

  // Show adaptation history
  const history = await controlPlane.outcomeValidator.getAdaptationHistory(1);
  if (history.length > 0) {
    console.log('\n📊 RECENT ADAPTATION:');
    history[0].adaptations.forEach(a => {
      console.log(`  • ${a.description}`);
    });
  }

  return thresholdChanged || decisionChanged;
}

// Run the test
if (require.main === module) {
  testFeedbackLoop()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\nFatal error:', error);
      process.exit(1);
    });
}

module.exports = { testFeedbackLoop };
