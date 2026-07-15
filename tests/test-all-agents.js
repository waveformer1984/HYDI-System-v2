#!/usr/bin/env node
/**
 * Complete Agent Test Suite
 * Tests all 6 specialized agents
 */

const OperationsAgent = require('../agents/operations-agent');
const EngineeringAgent = require('../agents/engineering-agent');
const BusinessAgent = require('../agents/business-agent');
const ResearchAgent = require('../agents/research-agent');
const StudioAgent = require('../agents/studio-agent');
const FabricationAgent = require('../agents/fabrication-agent');

async function runTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  HYDI GENESIS v3 — COMPLETE AGENT TEST SUITE               ║');
  console.log('║  Testing all 6 specialized agents                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const agents = [
    {
      name: 'Operations Agent',
      agent: new OperationsAgent(),
      tests: [
        { capability: 'monitoring', inputs: {} },
        { capability: 'backup', inputs: { target: 'all' } },
        { capability: 'security', inputs: { scope: 'all' } },
        { capability: 'diagnostics', inputs: {} },
      ],
    },
    {
      name: 'Engineering Agent',
      agent: new EngineeringAgent(),
      tests: [
        { capability: 'code-review', inputs: { scope: 'staged' } },
        { capability: 'testing', inputs: { type: 'unit' } },
        { capability: 'ci-cd', inputs: { branch: 'main' } },
        { capability: 'deployment', inputs: { environment: 'staging', strategy: 'canary' } },
      ],
    },
    {
      name: 'Business Agent',
      agent: new BusinessAgent(),
      tests: [
        { capability: 'crm', inputs: { action: 'summary' } },
        { capability: 'proposals', inputs: { client: 'Acme Corp', value: 50000 } },
        { capability: 'revenue-tracking', inputs: { period: 'current_month' } },
        { capability: 'lead-scoring', inputs: {} },
      ],
    },
    {
      name: 'Research Agent',
      agent: new ResearchAgent(),
      tests: [
        { capability: 'grant-discovery', inputs: { keywords: ['AI', 'automation'] } },
        { capability: 'tech-monitoring', inputs: { topics: ['AI/ML', 'Autonomous Systems'] } },
        { capability: 'patent-search', inputs: { query: 'autonomous systems' } },
        { capability: 'literature-review', inputs: { topics: ['AI', 'ML'] } },
      ],
    },
    {
      name: 'Studio Agent',
      agent: new StudioAgent(),
      tests: [
        { capability: 'music-generation', inputs: { genre: 'electronic', tempo: 120 } },
        { capability: 'midi-creation', inputs: { scale: 'pentatonic' } },
        { capability: 'sample-management', inputs: { action: 'inventory' } },
        { capability: 'audio-processing', inputs: { file: 'audio.wav' } },
      ],
    },
    {
      name: 'Fabrication Agent',
      agent: new FabricationAgent(),
      tests: [
        { capability: 'cad-design', inputs: { type: 'bracket', material: 'PLA' } },
        { capability: 'slicing', inputs: { file: 'design.stl', slicer: 'Cura' } },
        { capability: 'print-management', inputs: { action: 'status', printer: 'Prusa' } },
        { capability: 'inventory', inputs: { action: 'status' } },
      ],
    },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const agentResults = [];

  for (const agentGroup of agents) {
    console.log(`\n▶ Testing: ${agentGroup.name}`);
    console.log('─'.repeat(60));

    let agentPassed = 0;
    let agentFailed = 0;

    // Initialize agent
    try {
      await agentGroup.agent.initialize();
    } catch (error) {
      console.log(`❌ Initialization failed: ${error.message}`);
      continue;
    }

    // Run capability tests
    for (const test of agentGroup.tests) {
      try {
        const task = {
          type: test.capability,
          inputs: test.inputs,
        };

        const result = await agentGroup.agent.execute(task);

        if (result.success) {
          console.log(`  ✅ ${test.capability}`);
          agentPassed++;
        } else {
          console.log(`  ❌ ${test.capability}: ${result.error}`);
          agentFailed++;
        }
      } catch (error) {
        console.log(`  ❌ ${test.capability}: ${error.message}`);
        agentFailed++;
      }
    }

    totalPassed += agentPassed;
    totalFailed += agentFailed;

    agentResults.push({
      name: agentGroup.name,
      passed: agentPassed,
      failed: agentFailed,
      total: agentGroup.tests.length,
    });
  }

  // Print summary
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  TEST SUMMARY                                               ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');

  for (const result of agentResults) {
    const percent = ((result.passed / result.total) * 100).toFixed(0);
    const status = result.failed === 0 ? '✅' : '⚠️ ';
    console.log(
      `║ ${status} ${result.name.padEnd(40)} ${result.passed}/${result.total} (${percent}%)`
    );
  }

  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(
    `║ TOTAL: ${totalPassed} passed, ${totalFailed} failed (${agentResults.length} agents)`.padEnd(64) + '║'
  );
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  if (totalFailed === 0) {
    console.log('✨ All agents operational! HYDI Genesis v3 is ready.\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${totalFailed} test(s) failed. Review logs above.\n`);
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
