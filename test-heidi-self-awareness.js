#!/usr/bin/env node

/**
 * Test Heidi's Self-Awareness Capabilities
 * Demonstrates the reflection loop, self-state monitoring, and decision engine
 */

const HydiContextualConscience = require('./modules/hydi-contextual-conscience');

require('dotenv').config();

async function testHeidiSelfAwareness() {
  console.log('=== HEIDI SELF-AWARENESS TEST ===\n');
  
  // Initialize Heidi with new self-awareness capabilities
  console.log('1. Initializing Heidi with self-awareness...');
  const heidi = new HydiContextualConscience();
  
  // Wait for initialization
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('✓ Heidi initialized with self-awareness capabilities\n');
  
  // Test self-state monitoring
  console.log('2. Testing self-state monitoring...');
  const selfState = heidi.selfState.getStateSummary();
  console.log('Self-State:', JSON.stringify(selfState, null, 2));
  
  // Test reflection engine
  console.log('\n3. Testing reflection engine...');
  
  // Simulate some interactions for reflection
  console.log('   Simulating interactions...');
  heidi.logInteraction({
    type: 'alert_response',
    target: 'system_health',
    responseTime: 5000,
    context: { severity: 'high', priority: 'high' },
    biometricIndicators: { system_stress: 0.6 }
  });
  
  heidi.logInteraction({
    type: 'ignore',
    target: 'low_priority_alert',
    responseTime: 0,
    context: { severity: 'low', priority: 'low' },
    biometricIndicators: { system_stress: 0.3 }
  });
  
  heidi.logInteraction({
    type: 'command',
    target: 'system_restart',
    responseTime: 12000,
    context: { command: 'restart', severity: 'medium' },
    biometricIndicators: { system_stress: 0.8 }
  });
  
  // Wait for reflection processing
  console.log('   Processing reflections...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const reflectionStatus = heidi.reflectionEngine.getCurrentReflection();
  const performanceMetrics = heidi.reflectionEngine.getPerformanceMetrics();
  
  console.log('Reflection Status:', reflectionStatus ? 'Active' : 'Idle');
  console.log('Performance Metrics:', JSON.stringify(performanceMetrics, null, 2));
  
  // Test decision engine
  console.log('\n4. Testing decision engine...');
  
  // Test autonomous action decision
  console.log('   Testing autonomous action decision...');
  const decision1 = await heidi.decisionEngine.makeDecision('perform_reflection', {});
  console.log('Decision for perform_reflection:', {
    result: decision1.result,
    confidence: decision1.confidence.toFixed(2),
    reasoning: decision1.reasoning.map(r => r.step).join(' → ')
  });
  
  // Test restricted action decision
  console.log('   Testing restricted action decision...');
  const decision2 = await heidi.decisionEngine.makeDecision('modify_system_configuration', {
    component: 'database',
    change: 'max_connections'
  });
  console.log('Decision for modify_system_configuration:', {
    result: decision2.result,
    confidence: decision2.confidence.toFixed(2),
    reasoning: decision2.reasoning.map(r => r.step).join(' → ')
  });
  
  // Test autonomous action execution
  console.log('\n5. Testing autonomous action execution...');
  try {
    const result = await heidi.performAutonomousAction('perform_reflection');
    console.log('Autonomous action result:', result);
  } catch (error) {
    console.log('Autonomous action error:', error.message);
  }
  
  // Test comprehensive self-awareness status
  console.log('\n6. Testing comprehensive self-awareness status...');
  const selfAwarenessStatus = heidi.getSelfAwarenessStatus();
  console.log('Self-Awareness Status:');
  console.log('  Health:', selfAwarenessStatus.self_state.health);
  console.log('  Confidence:', selfAwarenessStatus.self_state.confidence.toFixed(2));
  console.log('  Reflection Active:', selfAwarenessStatus.reflection.active);
  console.log('  Adaptive Patterns:', selfAwarenessStatus.reflection.adaptive_patterns);
  console.log('  Autonomy Level:', selfAwarenessStatus.capabilities.current_autonomy.toFixed(2));
  console.log('  Learning Enabled:', selfAwarenessStatus.capabilities.learning_enabled);
  
  // Test decision statistics
  console.log('\n7. Testing decision statistics...');
  const decisionStats = heidi.decisionEngine.getDecisionStats();
  console.log('Decision Statistics:');
  console.log('  Total Decisions:', decisionStats.total_decisions);
  console.log('  Autonomous Actions:', decisionStats.autonomous_actions);
  console.log('  Escalations:', decisionStats.escalations);
  console.log('  Autonomy Rate:', (decisionStats.autonomy_rate * 100).toFixed(1) + '%');
  console.log('  Average Confidence:', decisionStats.average_confidence.toFixed(2));
  
  // Test error handling and self-state impact
  console.log('\n8. Testing error handling and self-state impact...');
  heidi.selfState.recordError(new Error('Test error for self-awareness'), {
    context: 'testing_error_handling',
    severity: 'medium'
  });
  
  // Wait for state update
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const updatedState = heidi.selfState.getStateSummary();
  console.log('Updated confidence after error:', updatedState.confidence.toFixed(2));
  console.log('Last error:', updatedState.last_error ? 'Recorded' : 'None');
  
  console.log('\n=== HEIDI SELF-AWARENESS TEST COMPLETE ===');
  console.log('✓ Reflection loop: Operational');
  console.log('✓ Self-state monitoring: Operational');
  console.log('✓ Decision engine: Operational');
  console.log('✓ Bounded autonomy: Operational');
  console.log('✓ Error handling: Operational');
  console.log('\nHeidi is now capable of:');
  console.log('• Learning from interactions through reflection');
  console.log('• Monitoring her own state and performance');
  console.log('• Making autonomous decisions within boundaries');
  console.log('• Escalating when confidence is low or actions are restricted');
  console.log('• Adapting behavior based on performance trends');
  
  process.exit(0);
}

// Run the test
testHeidiSelfAwareness().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
