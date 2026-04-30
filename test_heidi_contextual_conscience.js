// Test Heidi Contextual Conscience
// Demonstrates behavioral tracking, proof-of-work, and value leak detection

const HydiContextualConscience = require('./modules/hydi-contextual-conscience');

async function testHeidi() {
  console.log('=== Testing Heidi Contextual Conscience ===\n');
  
  // Initialize Heidi
  const heidi = new HydiContextualConscience();
  
  // Set up event listeners
  heidi.on('high_violation_risk', (alert) => {
    console.log('🚨 HIGH VIOLATION RISK DETECTED:');
    console.log(`   Risk: ${(alert.risk * 100).toFixed(1)}%`);
    console.log(`   Recommendation: ${alert.recommendation.action}`);
    console.log(`   Reason: ${alert.recommendation.reason}\n`);
  });
  
  heidi.on('value_leak_detected', (leak) => {
    console.log('💰 VALUE LEAK DETECTED:');
    console.log(`   Problem: ${leak.problemType}`);
    console.log(`   Occurrences: ${leak.occurrences}`);
    console.log(`   Monthly Value: $${leak.estimatedValue.monthly.toFixed(2)}`);
    console.log(`   Automation Ready: ${(leak.automationReadiness * 100).toFixed(1)}%\n`);
  });
  
  heidi.on('proof_of_work_created', (certification) => {
    console.log('✅ PROOF OF WORK CERTIFIED:');
    console.log(`   Artifact: ${certification.artifactId}`);
    console.log(`   Type: ${certification.artifactType}`);
    console.log(`   Quality Score: ${(certification.qualityScore * 100).toFixed(1)}%`);
    console.log(`   Hash: ${certification.verificationHash.substring(0, 16)}...\n`);
  });
  
  // Simulate human interactions
  console.log('1. Simulating human interactions...\n');
  
  // User is focused and responding quickly
  heidi.logInteraction({
    type: 'alert_response',
    target: 'high_cpu_alert',
    responseTime: 500,
    context: { severity: 'high', priority: 'high' },
    biometricIndicators: { stress: 0.2 }
  });
  
  // User ignores some alerts
  heidi.logInteraction({
    type: 'ignore',
    target: 'low_disk_space',
    responseTime: 0,
    context: { severity: 'low', priority: 'low' },
    biometricIndicators: { stress: 0.1 }
  });
  
  // User fixes a problem repeatedly
  heidi.logInteraction({
    type: 'command',
    target: 'fix_module_not_found',
    responseTime: 2000,
    context: { 
      command: 'fix',
      problemType: 'MODULE_NOT_FOUND',
      solutionPattern: 'add_missing_dependency',
      timeSaved: 300 // 5 minutes
    },
    biometricIndicators: { stress: 0.3 }
  });
  
  // Simulate the same fix happening multiple times
  setTimeout(() => {
    heidi.logInteraction({
      type: 'command',
      target: 'fix_module_not_found',
      responseTime: 1500,
      context: { 
        command: 'fix',
        problemType: 'MODULE_NOT_FOUND',
        solutionPattern: 'add_missing_dependency',
        timeSaved: 300
      },
      biometricIndicators: { stress: 0.3 }
    });
  }, 1000);
  
  setTimeout(() => {
    heidi.logInteraction({
      type: 'command',
      target: 'fix_module_not_found',
      responseTime: 1800,
      context: { 
        command: 'fix',
        problemType: 'MODULE_NOT_FOUND',
        solutionPattern: 'add_missing_dependency',
        timeSaved: 300
      },
      biometricIndicators: { stress: 0.4 }
    });
  }, 2000);
  
  // Simulate stress building up
  setTimeout(() => {
    console.log('2. Simulating elevated stress...\n');
    
    // Rapid interactions indicating stress
    for (let i = 0; i < 25; i++) {
      heidi.logInteraction({
        type: 'command',
        target: `rapid_action_${i}`,
        responseTime: 100,
        context: { command: 'quick_action' },
        biometricIndicators: { stress: 0.8 }
      });
    }
    
    // Ignore high priority items
    heidi.logInteraction({
      type: 'ignore',
      target: 'critical_security_alert',
      responseTime: 0,
      context: { severity: 'critical', priority: 'high' },
      biometricIndicators: { stress: 0.9 }
    });
  }, 3000);
  
  // Create proof of work certification
  setTimeout(async () => {
    console.log('3. Creating proof-of-work certification...\n');
    
    const artifact = {
      id: 'laser_harp_track_001',
      type: 'audio_file',
      name: 'Laser Harp Melody #1'
    };
    
    const productionData = {
      temperature: 22.5,
      vibration: 0.02,
      atmosphericPressure: 1013.25,
      systemLoad: 0.45,
      errorRate: 0,
      operatorId: 'human_001',
      operatorStress: 0.3,
      operatorAttention: 0.9
    };
    
    await heidi.createProofOfWork(artifact, productionData);
  }, 4000);
  
  // Show insights after all interactions
  setTimeout(() => {
    console.log('4. Current Behavioral Insights:\n');
    const insights = heidi.getBehavioralInsights();
    console.log(`   Risk Tolerance: ${(insights.riskTolerance * 100).toFixed(1)}%`);
    console.log(`   Current Stress: ${(insights.currentStress * 100).toFixed(1)}%`);
    console.log(`   Violation Risk: ${(insights.violationRisk * 100).toFixed(1)}%`);
    console.log('\n   Attention Patterns:');
    Object.entries(insights.attentionPatterns).forEach(([target, pattern]) => {
      console.log(`   - ${target}: ${pattern.count} interactions, ${pattern.priority.toFixed(2)} priority`);
    });
    
    console.log('\n5. Value Leaks Detected:');
    const leaks = heidi.getValueLeaks();
    if (leaks.length === 0) {
      console.log('   None detected yet');
    } else {
      leaks.forEach(leak => {
        console.log(`   - ${leak.problemType}: $${leak.estimatedValue.monthly.toFixed(2)}/month`);
      });
    }
    
    console.log('\n6. Resource Preservation Status:');
    const resources = heidi.getResourcePreservationStatus();
    console.log(`   Maintenance Needed: ${resources.maintenanceNeeded.length}`);
    console.log(`   Waste Detected: ${resources.wasteDetected.length}`);
    console.log(`   Potential Savings: $${resources.totalPotentialSavings.toFixed(2)}/month`);
    
    console.log('\n=== Test Complete ===');
    console.log('Heidi is now monitoring and learning from your behavior patterns.');
  }, 5000);
}

// Run the test
testHeidi().catch(console.error);
