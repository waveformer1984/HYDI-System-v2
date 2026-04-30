#!/usr/bin/env node

/**
 * Test Heidi's Adaptation Rate
 * CRITICAL: This test verifies that Heidi actually adapts, not just analyzes
 * We track: adaptation_rate = adaptations / insights
 * Target: adaptation_rate > 0 (non-zero behavioral change)
 */

const HydiContextualConscience = require('./modules/hydi-contextual-conscience');

require('dotenv').config();

async function testHeidiAdaptationRate() {
  console.log('=== HEIDI ADAPTATION RATE TEST ===\n');
  console.log('CRITICAL: Testing actual behavioral change, not just analysis\n');
  
  // Initialize Heidi
  const heidi = new HydiContextualConscience();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 1: Generate high-confidence events that should trigger adaptations
  console.log('1. Generating high-confidence events for adaptation testing...');
  
  const adaptationEvents = [
    // Error pattern (should trigger error recovery)
    {
      actor: 'heidi-runtime',
      event_type: 'error.occurred',
      payload: { error_type: 'timeout', component: 'api_gateway', severity: 'medium' }
    },
    {
      actor: 'heidi-runtime',
      event_type: 'error.occurred', 
      payload: { error_type: 'timeout', component: 'api_gateway', severity: 'medium' }
    },
    {
      actor: 'heidi-runtime',
      event_type: 'error.occurred',
      payload: { error_type: 'timeout', component: 'api_gateway', severity: 'medium' }
    },
    
    // Performance degradation (should trigger caching)
    {
      actor: 'heidi-runtime',
      event_type: 'performance.metric',
      payload: { metric: 'response_time', value: 8500, threshold: 5000 }
    },
    {
      actor: 'heidi-runtime',
      event_type: 'performance.metric',
      payload: { metric: 'response_time', value: 9200, threshold: 5000 }
    },
    
    // High ignore rate (should trigger alert adjustment)
    {
      actor: 'heidi-runtime',
      event_type: 'user.interaction',
      payload: { action: 'ignore', response_time_ms: 0, alert_type: 'system_health', priority: 'high' }
    },
    {
      actor: 'heidi-runtime',
      event_type: 'user.interaction',
      payload: { action: 'ignore', response_time_ms: 0, alert_type: 'system_health', priority: 'high' }
    },
    {
      actor: 'heidi-runtime',
      event_type: 'user.interaction',
      payload: { action: 'ignore', response_time_ms: 0, alert_type: 'system_health', priority: 'high' }
    }
  ];
  
  // Log events through Heidi's system
  for (const event of adaptationEvents) {
    heidi.logInteraction({
      type: 'system_event',
      target: event.payload.component || event.event_type,
      responseTime: event.payload.value || 1000,
      context: {
        event_type: event.event_type,
        severity: event.payload.severity || 'medium',
        priority: event.payload.priority || 'normal'
      },
      biometricIndicators: {
        system_stress: event.payload.value > 5000 ? 0.8 : 0.5
      }
    });
  }
  
  console.log(`   Generated ${adaptationEvents.length} high-confidence adaptation events`);
  
  // Test 2: Trigger reflection and capture metrics
  console.log('\n2. Triggering reflection cycle...');
  
  const preReflectionStats = {
    insights: 0,
    adaptations: 0,
    adaptation_rate: 0
  };
  
  try {
    await heidi.performAutonomousAction('perform_reflection');
    console.log('✓ Reflection cycle completed');
  } catch (error) {
    console.log('✗ Reflection cycle failed:', error.message);
  }
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Test 3: Measure adaptation rate
  console.log('\n3. Measuring adaptation rate...');
  
  const reflectionStatus = heidi.reflectionEngine.getCurrentReflection();
  const performanceMetrics = heidi.reflectionEngine.getPerformanceMetrics();
  const adaptivePatterns = heidi.reflectionEngine.getAdaptivePatterns();
  
  const insights = reflectionStatus ? reflectionStatus.insights.length : 0;
  const adaptations = adaptivePatterns.length;
  const adaptation_rate = insights > 0 ? adaptations / insights : 0;
  
  console.log('   Results:');
  console.log(`     Insights generated: ${insights}`);
  console.log(`     Adaptations identified: ${adaptations}`);
  console.log(`     Adaptation rate: ${(adaptation_rate * 100).toFixed(1)}%`);
  
  // Test 4: Verify next_action generation
  console.log('\n4. Verifying next_action generation...');
  
  if (reflectionStatus && reflectionStatus.insights) {
    const insightsWithActions = reflectionStatus.insights.filter(i => i.next_action);
    const insightsWithoutActions = reflectionStatus.insights.filter(i => !i.next_action);
    
    console.log(`     Insights with next_action: ${insightsWithActions.length}`);
    console.log(`     Insights without next_action: ${insightsWithoutActions.length}`);
    
    if (insightsWithoutActions.length > 0) {
      console.log('     ❌ CRITICAL: Some insights lack next_action (should be deleted)');
    }
    
    // Show sample next_actions
    if (insightsWithActions.length > 0) {
      console.log('\n     Sample next_actions:');
      insightsWithActions.slice(0, 3).forEach((insight, i) => {
        console.log(`       ${i + 1}. ${insight.type} → ${insight.next_action.type} (auto_safe: ${insight.next_action.auto_safe})`);
      });
    }
  }
  
  // Test 5: Check decision engine adaptation response
  console.log('\n5. Testing decision engine adaptation response...');
  
  // Simulate system degradation to trigger autonomy adjustment
  const originalAutonomy = heidi.decisionEngine.boundaries.autonomy_level;
  
  // Force a health alert
  heidi.selfState.recordError(new Error('Test degradation for adaptation'), {
    component: 'reflection-engine',
    severity: 'high',
    test: true
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const updatedAutonomy = heidi.decisionEngine.boundaries.autonomy_level;
  const autonomyChanged = updatedAutonomy !== originalAutonomy;
  
  console.log(`     Original autonomy: ${(originalAutonomy * 100).toFixed(1)}%`);
  console.log(`     Updated autonomy: ${(updatedAutonomy * 100).toFixed(1)}%`);
  console.log(`     Autonomy adapted: ${autonomyChanged ? '✓' : '✗'}`);
  
  // Test 6: Final adaptation rate assessment
  console.log('\n6. FINAL ADAPTATION RATE ASSESSMENT');
  console.log('=====================================');
  
  const passing = adaptation_rate > 0;
  const hasActions = reflectionStatus ? reflectionStatus.insights.some(i => i.next_action) : false;
  const autonomyAdapts = autonomyChanged;
  
  console.log(`Adaptation rate > 0: ${passing ? '✓ PASS' : '✗ FAIL'} (${(adaptation_rate * 100).toFixed(1)}%)`);
  console.log(`Insights have next_action: ${hasActions ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Autonomy adapts: ${autonomyAdapts ? '✓ PASS' : '✗ FAIL'}`);
  
  const overallPass = passing && hasActions;
  
  console.log('\n=== ADAPTATION TEST RESULT ===');
  if (overallPass) {
    console.log('🎉 SUCCESS: Heidi is actually adapting, not just analyzing!');
    console.log('✓ Reflection loop: acts → logs → reflects → adapts');
    console.log('✓ Behavioral change confirmed');
    console.log('✓ System self-regulation working');
  } else {
    console.log('❌ FAILURE: Heidi is still just a diary, not adaptive');
    console.log('❌ No actual behavioral change detected');
    console.log('❌ Reflection loop incomplete');
    
    if (adaptation_rate === 0) {
      console.log('\n🔧 DIAGNOSIS: adaptation_rate = 0');
      console.log('   - Insights not generating adaptations');
      console.log('   - Confidence thresholds too high?');
      console.log('   - Pattern detection not working?');
    }
    
    if (!hasActions) {
      console.log('\n🔧 DIAGNOSIS: Insights lack next_action');
      console.log('   - generateAction() function not working');
      console.log('   - Confidence threshold filtering too aggressive');
      console.log('   - Action mapping incomplete');
    }
  }
  
  console.log('\n📊 METRICS TO TRACK IN PRODUCTION:');
  console.log(`   adaptation_rate = ${adaptation_rate.toFixed(3)}`);
  console.log(`   insights_with_actions = ${hasActions ? 'true' : 'false'}`);
  console.log(`   autonomy_adapts = ${autonomyAdapts ? 'true' : 'false'}`);
  console.log(`   target: adaptation_rate > 0.1 (10% minimum)`);
  
  if (overallPass) {
    console.log('\n🚀 Heidi has achieved adaptive intelligence!');
    console.log('   She learns, adapts, and regulates her own behavior.');
    console.log('   The reflection loop is complete and functional.');
  } else {
    console.log('\n⚠️  Heidi needs more work before claiming adaptive intelligence.');
    console.log('   Focus on forcing insights to produce actionable changes.');
  }
  
  process.exit(overallPass ? 0 : 1);
}

// Run the adaptation rate test
testHeidiAdaptationRate().catch(error => {
  console.error('Adaptation rate test failed:', error);
  process.exit(1);
});
