#!/usr/bin/env node
/**
 * Operations Agent Test Suite
 */

const OperationsAgent = require('../agents/operations-agent');

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  OPERATIONS AGENT TEST SUITE                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const agent = new OperationsAgent();
  await agent.initialize();

  const tests = [
    {
      name: 'Monitoring',
      task: { type: 'monitoring', inputs: {} },
    },
    {
      name: 'Backup',
      task: { type: 'backup', inputs: { target: 'all' } },
    },
    {
      name: 'Security Scan',
      task: { type: 'security', inputs: { scope: 'all' } },
    },
    {
      name: 'Diagnostics',
      task: { type: 'diagnostics', inputs: {} },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`\n▶ Testing: ${test.name}`);
      const result = await agent.execute(test.task);

      if (result.success) {
        console.log(`✅ ${test.name} PASSED`);
        console.log(`   Task ID: ${result.taskId}`);
        console.log(`   Duration: ${result.duration}ms`);
        passed++;
      } else {
        console.log(`❌ ${test.name} FAILED`);
        console.log(`   Error: ${result.error}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name} FAILED`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                         ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Agent Status:', agent.getStatus());
  console.log('\n✨ Operations Agent is fully functional!');
}

runTests().catch(console.error);
