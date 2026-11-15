'use strict';

/**
 * Verified HYDI capability catalog — candidate services with repository evidence.
 * `executionReady` means hermetic/unit tests exist; live delivery still needs host stack.
 */

const VERIFIED_CAPABILITIES = Object.freeze([
  {
    id: 'web_fullstack',
    category: 'Website development and maintenance',
    skills: ['next.js', 'react', 'supabase', 'stripe', 'api', 'typescript'],
    executionReady: true,
    evidence: ['npm run build', 'tests/unit/pipeline-replay.test.js'],
  },
  {
    id: 'api_integration',
    category: 'API integrations',
    skills: ['api', 'webhook', 'stripe', 'supabase', 'rest'],
    executionReady: true,
    evidence: ['tests/unit/stripe-webhook.test.js', 'pages/api/'],
  },
  {
    id: 'automation_workflow',
    category: 'Automation workflows',
    skills: ['automation', 'workflow', 'script', 'pm2', 'scheduler'],
    executionReady: true,
    evidence: ['lib/execution-fabric/', 'scripts/hydi-schedulers.js'],
  },
  {
    id: 'ai_agent_dev',
    category: 'AI assistant and agent development',
    skills: ['ai', 'llm', 'chatbot', 'agent', 'orchestration'],
    executionReady: true,
    evidence: ['heidi-core/', 'tests/unit/heidi-core-loop.test.js'],
  },
  {
    id: 'tech_research_docs',
    category: 'Technical research and documentation',
    skills: ['documentation', 'audit', 'architecture', 'analysis'],
    executionReady: true,
    evidence: ['docs/', 'tests/unit/job-scout.test.js'],
  },
  {
    id: 'bug_investigation',
    category: 'Bug investigation and code fixes',
    skills: ['debug', 'jest', 'regression', 'fix', 'typescript', 'node'],
    executionReady: true,
    evidence: ['tests/unit/', '.githooks/pre-push'],
  },
  {
    id: 'performance_audit',
    category: 'Website audits and performance improvements',
    skills: ['performance', 'lighthouse', 'audit', 'next.js'],
    executionReady: false,
    evidence: ['tests/unit/protoforge-health-no-placeholder.test.js'],
  },
  {
    id: 'data_reporting',
    category: 'Data processing and reporting',
    skills: ['postgres', 'report', 'sql', 'analytics'],
    executionReady: true,
    evidence: ['supabase/migrations/', 'tests/migrations/'],
  },
]);

function listCapabilities() {
  return VERIFIED_CAPABILITIES.map((c) => ({ ...c, evidence: [...c.evidence] }));
}

function matchCapabilities(lead) {
  const text = `${lead.title || ''}\n${(lead.skills || []).join(' ')}\n${lead.description || ''}`.toLowerCase();
  const hits = [];
  for (const cap of VERIFIED_CAPABILITIES) {
    const matched = cap.skills.filter((s) => text.includes(String(s).toLowerCase()));
    if (matched.length) hits.push({ capabilityId: cap.id, category: cap.category, matched, executionReady: cap.executionReady });
  }
  hits.sort((a, b) => b.matched.length - a.matched.length);
  return hits;
}

module.exports = { VERIFIED_CAPABILITIES, listCapabilities, matchCapabilities };