/**
 * Test the complete adaptive system
 * Reality Filter + Outcome Validator = Learning Organism
 */

// Load environment first
require('dotenv').config();

const HeidiControlPlane = require('./src/control/HeidiControlPlane');

async function demonstrateAdaptiveSystem() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     HYDI ADAPTIVE SYSTEM DEMONSTRATION       ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Initialize the control plane with all layers
  const controlPlane = new HeidiControlPlane({
    enableAdaptiveLearning: true,
    minConfidenceForActions: 0.7
  });

  console.log('📍 Phase 1: Initial State');
  console.log('→ Static rules in place');
  console.log('→ No learning data yet');
  console.log('→ System will be strict initially\n');

  // Simulate tasks and outcomes
  const tasks = [
    {
      id: 'task_1',
      type: 'outreach',
      leadSource: 'linkedin',
      message: 'Hi Sarah at TechCorp - I noticed you need rapid prototyping. We can deliver parts in 24 hours for $150.',
      personalizationScore: 0.8,
      confidence: 0.8
    },
    {
      id: 'task_2',
      type: 'outreach',
      leadSource: 'random_scrape',
      message: 'Dear friend, great opportunity awaits!',
      personalizationScore: 0.3,
      confidence: 0.6
    },
    {
      id: 'task_3',
      type: 'execution',
      estimatedRevenue: 200,
      estimatedCost: 100,
      confidence: 0.9
    },
    {
      id: 'task_4',
      type: 'execution',
      estimatedRevenue: 100,
      estimatedCost: 85,
      confidence: 0.7
    }
  ];

  const outcomes = [
    { success: true, revenue: 200, leadQuality: 0.9, timeToConversion: 2 },
    { success: false, revenue: 0, leadQuality: 0 },
    { success: true, revenue: 200, margin: 50 },
    { success: false, revenue: 0, margin: 15 }
  ];

  console.log('📍 Phase 2: Processing Tasks Through Reality Filter');
  
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n→ Processing ${task.type} task: ${task.id}`);
    
    // Check with Reality Filter
    const filterResult = await controlPlane.realityFilter.filter(task);
    
    if (filterResult.approved) {
      console.log(`  ✅ Passed Reality Filter`);
      
      // Simulate execution
      const execution = {
        cost: task.estimatedCost || 50,
        duration: 1000,
        completed: true
      };
      
      // Record outcome
      await controlPlane.recordTaskOutcome(task, execution, outcomes[i]);
      
      console.log(`  📊 Outcome: ${outcomes[i].success ? 'SUCCESS' : 'FAILURE'}`);
      if (outcomes[i].revenue > 0) {
        console.log(`  💰 Revenue: $${outcomes[i].revenue}`);
      }
    } else {
      console.log(`  ❌ BLOCKED by Reality Filter: ${filterResult.reason}`);
    }
  }

  console.log('\n📍 Phase 3: Learning from Outcomes');
  
  // Force adaptation
  console.log('→ Triggering adaptation cycle...');
  await controlPlane.outcomeValidator.forceAdaptation();
  
  // Get adaptive status
  const adaptiveStatus = await controlPlane.getAdaptiveStatus();
  console.log(`\n→ System Health: ${adaptiveStatus.health.status}`);
  console.log(`→ Tasks Analyzed: ${adaptiveStatus.health.metrics.tasksAnalyzed}`);
  console.log(`→ Success Rate: ${adaptiveStatus.health.metrics.successRate}`);
  console.log(`→ Total Revenue: $${adaptiveStatus.health.metrics.totalRevenue}`);
  
  if (adaptiveStatus.recentAdaptations.length > 0) {
    console.log('\n→ Recent Adaptations:');
    adaptiveStatus.recentAdaptations.forEach(adaptation => {
      adaptation.adaptations.forEach(a => {
        console.log(`  • ${a.description}`);
      });
    });
  }

  console.log('\n📍 Phase 4: Updated Thresholds');
  const thresholds = controlPlane.outcomeValidator.getThresholds();
  console.log(`→ Lead Source Min Conversion: ${(thresholds.leadSourceMinConversion * 100).toFixed(1)}%`);
  console.log(`→ Outreach Min Personalization: ${thresholds.outreachMinPersonalization.toFixed(2)}`);
  console.log(`→ Product Min Demand Score: ${thresholds.productMinDemandScore.toFixed(2)}`);
  console.log(`→ Execution Min Margin: ${(thresholds.executionMinMargin * 100).toFixed(1)}%`);

  console.log('\n📍 Phase 5: Testing Adapted System');
  
  // Test with the same tasks to see different behavior
  console.log('\n→ Re-testing task_2 (previously blocked):');
  const testTask = tasks[1]; // The one that was blocked
  
  const newFilterResult = await controlPlane.realityFilter.filter(testTask);
  if (newFilterResult.approved) {
    console.log('  ✅ Now passes (if adaptation relaxed rules)');
  } else {
    console.log(`  ❌ Still blocked: ${newFilterResult.reason}`);
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║              SUMMARY                         ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║ ✅ Reality Filter: Kills bad tasks early    ║');
  console.log('║ ✅ Outcome Validator: Learns from results   ║');
  console.log('║ ✅ Dynamic Thresholds: Adapt to reality     ║');
  console.log('║ ✅ Complete Feedback Loop: Self-improving   ║');
  console.log('║                                              ║');
  console.log('║ The system is now a learning organism:      ║');
  console.log('║ - Filters based on learned patterns         ║');
  console.log('║ - Adapts thresholds to real outcomes        ║');
  console.log('║ - Prevents over-filtering collapse          ║');
  console.log('║ - Continuously optimizes for revenue        ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  
  console.log('🔥 HYDI is now truly adaptive.');
  console.log('   It learns what makes money, not just what looks good.');
}

// Run demonstration
if (require.main === module) {
  demonstrateAdaptiveSystem().catch(console.error);
}

module.exports = { demonstrateAdaptiveSystem };
