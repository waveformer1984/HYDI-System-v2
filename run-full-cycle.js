/**
 * Full HEIDI Cycle Demo
 * Demonstrates: Measure → Analyze → Recommend → Execute
 * 
 * This script shows HEIDI's complete autonomous improvement cycle:
 * 1. Measure: Collect system events and metrics
 * 2. Analyze: Self-assessment to identify improvement opportunities
 * 3. Recommend: Convert findings to actionable goals
 * 4. Execute: Execute approved goals through goal executor
 */

const { Client } = require('pg');
const HeidiGoalEngine = require('./evolution/heidi-goals');
const GoalExecutor = require('./evolution/goal-executor');
const ActionExecutor = require('./heidi-core/actions/action-executor');

const PG_URL = process.env.PG_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OLLAMA = 'http://127.0.0.1:11434';

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
  });
  let v = (await r.json()).embedding;
  if (v.length < 1536) v = v.concat(Array(1536 - v.length).fill(0));
  return v;
}

async function chat(prompt) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3.2', prompt, stream: false })
  });
  return (await r.json()).response;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           HEIDI FULL CYCLE DEMO                                 ║');
  console.log('║     Measure → Analyze → Recommend → Execute                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const db = new Client({ connectionString: PG_URL });
  await db.connect();

  // ─── STEP 1: MEASURE ─────────────────────────────────────────────────────
  console.log('📊 STEP 1: MEASURE - Collecting system events and metrics');
  console.log('─'.repeat(70));
  
  const { rows: events } = await db.query(`
    SELECT event_type, division, verdict, created_at 
    FROM heidi_events 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  
  console.log(`Found ${events.length} recent events:`);
  events.forEach((e, i) => {
    console.log(`  ${i+1}. [${e.division}] ${e.event_type} → ${e.verdict} (${e.created_at})`);
  });
  
  // Get system health metrics
  try {
    const { rows: health } = await db.query(`
      SELECT * 
      FROM infrastructure_health 
      ORDER BY measured_at DESC 
      LIMIT 1
    `);
    
    if (health.length > 0) {
      console.log(`\nSystem Health:`);
      const healthData = health[0];
      Object.keys(healthData).forEach(key => {
        if (key !== 'measured_at' && healthData[key] !== null) {
          console.log(`  ${key}: ${healthData[key]}`);
        }
      });
    }
  } catch (err) {
    console.log(`\nSystem Health: Data not available (${err.message})`);
  }
  
  console.log('\n✅ Measurement complete\n');

  // ─── STEP 2: ANALYZE ─────────────────────────────────────────────────────
  console.log('🔍 STEP 2: ANALYZE - Self-assessment to identify issues');
  console.log('─'.repeat(70));
  
  // Simulate self-assessment by analyzing events
  const blockedCount = events.filter(e => e.verdict === 'BLOCK').length;
  const reviewCount = events.filter(e => e.verdict === 'REVIEW').length;
  const autoApproveCount = events.filter(e => e.verdict === 'AUTO-APPROVE').length;
  
  console.log('Decision Analysis:');
  console.log(`  Auto-Approved: ${autoApproveCount}`);
  console.log(`  Required Review: ${reviewCount}`);
  console.log(`  Blocked: ${blockedCount}`);
  
  const findings = [];
  
  if (reviewCount > 5) {
    findings.push({
      type: 'high_review_rate',
      severity: 'medium',
      description: `High review rate detected (${reviewCount} recent decisions required review). Consider adjusting confidence thresholds or improving memory coverage.`
    });
  }
  
  if (blockedCount > 2) {
    findings.push({
      type: 'blocking_issues',
      severity: 'high',
      description: `Multiple blocked decisions (${blockedCount}). Investigate policy constraints or data quality issues.`
    });
  }
  
  findings.push({
    type: 'improvement_opportunity',
    severity: 'low',
    description: 'System operating normally. Consider optimizing decision thresholds for faster autonomous operations.'
  });
  
  console.log(`\nIdentified ${findings.length} findings:`);
  findings.forEach((f, i) => {
    console.log(`  ${i+1}. [${f.severity.toUpperCase()}] ${f.type}: ${f.description}`);
  });
  
  console.log('\n✅ Analysis complete\n');

  // ─── STEP 3: RECOMMEND ───────────────────────────────────────────────────
  console.log('💡 STEP 3: RECOMMEND - Convert findings to actionable goals');
  console.log('─'.repeat(70));
  
  // Initialize goal engine
  const brain = {
    generate: async (prompt) => {
      const result = await chat(prompt);
      return { text: result };
    }
  };
  
  const memory = {
    store: async (content) => {
      console.log(`  [Memory] Stored: ${content.substring(0, 50)}...`);
      return true;
    }
  };
  
  const goalEngine = new HeidiGoalEngine(brain, memory);
  await goalEngine.initialize();
  
  // Convert findings to goals
  for (const finding of findings) {
    if (finding.severity === 'high' || finding.severity === 'medium') {
      console.log(`\nCreating goal for: ${finding.type}`);
      const goal = await goalEngine.addGoal(finding.description, finding.severity);
      console.log(`  ✅ Goal created: ${goal.id}`);
      console.log(`  Tasks: ${goal.tasks.length}`);
      goal.tasks.forEach((t, i) => {
        console.log(`    ${i+1}. ${t.description}`);
      });
    }
  }
  
  const activeGoals = goalEngine.getActiveGoals();
  console.log(`\nTotal active goals: ${activeGoals.length}`);
  
  console.log('\n✅ Recommendations complete\n');

  // ─── STEP 4: EXECUTE ─────────────────────────────────────────────────────
  console.log('⚡ STEP 4: EXECUTE - Execute approved goals');
  console.log('─'.repeat(70));
  
  const actionExecutor = new ActionExecutor();
  const goalExecutor = new GoalExecutor(goalEngine, actionExecutor);
  
  if (activeGoals.length === 0) {
    console.log('No active goals to execute. Creating a demo goal...');
    const demoGoal = await goalEngine.addGoal('Optimize HEIDI decision thresholds for faster autonomous operations', 'low');
    console.log(`  ✅ Demo goal created: ${demoGoal.id}`);
    console.log(`  Tasks: ${demoGoal.tasks.length}`);
  }
  
  const goalsToExecute = goalEngine.getActiveGoals();
  console.log(`\nExecuting ${goalsToExecute.length} goal(s):`);
  
  for (const goal of goalsToExecute) {
    console.log(`\n🎯 Goal: ${goal.objective}`);
    console.log(`   ID: ${goal.id}`);
    console.log(`   Tasks: ${goal.tasks.length}`);
    
    const result = await goalExecutor.executeGoal(goal.id);
    
    console.log(`\n   Execution Results:`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Completed: ${result.completedTasks}/${result.totalTasks} tasks`);
    
    result.results.forEach((r, i) => {
      const status = r.success ? '✅' : '❌';
      console.log(`   ${status} Task ${i+1}: ${r.task?.description?.substring(0, 50)}...`);
    });
  }
  
  console.log('\n✅ Execution complete\n');

  // ─── SUMMARY ─────────────────────────────────────────────────────────────
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    CYCLE SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('📊 Measured: System events and health metrics');
  console.log('🔍 Analyzed: Identified improvement opportunities');
  console.log('💡 Recommended: Created actionable goals');
  console.log('⚡ Executed: Processed goals through action executor');
  console.log('\n🎉 Full cycle complete! HEIDI is now capable of autonomous improvement.');
  
  await db.end();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
