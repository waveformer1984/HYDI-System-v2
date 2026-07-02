/**
 * Test HEIDI goal execution integration
 * Creates a test goal and verifies it gets processed by the running agent
 */

const HeidiGoalEngine = require('./evolution/heidi-goals');

async function main() {
  console.log('Testing HEIDI Goal Execution Integration\n');
  
  // Create simple brain and memory interfaces
  const brain = {
    generate: async (prompt) => {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2', prompt, stream: false })
      });
      const result = await response.json();
      return { text: result.response };
    }
  };
  
  const memory = {
    store: async (content) => {
      console.log(`[Memory] Stored: ${content.substring(0, 50)}...`);
      return true;
    }
  };
  
  const goalEngine = new HeidiGoalEngine(brain, memory);
  await goalEngine.initialize();
  
  console.log('Creating test goal...');
  const goal = await goalEngine.addGoal('Test goal execution integration', 'low');
  
  console.log(`✅ Goal created: ${goal.id}`);
  console.log(`   Objective: ${goal.objective}`);
  console.log(`   Tasks: ${goal.tasks.length}`);
  goal.tasks.forEach((t, i) => {
    console.log(`     ${i+1}. ${t.description}`);
  });
  
  console.log('\n📝 Goal saved to heidi-core/data/heidi_goals.json');
  console.log('🤖 HEIDI agent should process this goal within the next minute');
  
  console.log('\nActive goals:');
  const activeGoals = goalEngine.getActiveGoals();
  activeGoals.forEach(g => {
    console.log(`  - ${g.id}: ${g.objective}`);
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
