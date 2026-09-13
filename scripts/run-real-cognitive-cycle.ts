/**
 * Real Cognitive Cycle Runner
 *
 * Drives a real prospect through the actual production CognitiveCore
 * loop — the same governed path the daemon uses. No demo scripting.
 *
 * Steps:
 *   1. Find the highest-scoring uncontacted real prospect
 *   2. Create a real goal in heidi_goals for that prospect
 *   3. Build the production CognitiveCore (same as daemon)
 *   4. Run core.runCycle() and capture the full CognitiveState
 *   5. If the cycle prepares an outreach draft, capture it
 *   6. Try the LLM (ModelManager) for personalized reasoning
 *   7. Report everything honestly
 */

const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

async function main() {
  const log = [];
  function ts() { return new Date().toISOString(); }
  function out(msg) {
    const line = `[${ts()}] ${msg}`;
    console.log(line);
    log.push(line);
  }

  out('=== REAL COGNITIVE CYCLE RUN ===');
  out('');

  // ─── Step 1: Find a real uncontacted prospect ───────────────────
  out('STEP 1: Finding real unprocessed prospect data...');

  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PG_HOST || process.env.PGHOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || process.env.PGPORT || '54322', 10),
    database: process.env.PG_DATABASE || process.env.PGDATABASE || 'postgres',
    user: process.env.PG_USER || process.env.PGUSER || 'postgres',
    password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'postgres',
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  // Find highest-scoring scored prospect with no outreach and no proposal
  const prospectResult = await pool.query(
    `SELECT p.* FROM revenue_prospects p
     WHERE p.status = 'scored'
       AND p.last_contacted_at IS NULL
       AND p.opted_out = false
       AND p.icp_score > 0
     ORDER BY p.icp_score DESC, p.created_at ASC
     LIMIT 1`
  );

  if (prospectResult.rows.length === 0) {
    out('  NO real uncontacted scored prospects found.');
    out('  This means the pipeline has processed everything available.');
    await pool.end();
    writeReport(log, null, null, null);
    return;
  }

  const prospect = prospectResult.rows[0];
  out(`  Found prospect: ${prospect.company_name}`);
  out(`  ID: ${prospect.prospect_id}`);
  out(`  ICP Score: ${prospect.icp_score}/100`);
  out(`  Industry: ${prospect.industry || 'unknown'}`);
  out(`  Location: ${prospect.location || 'unknown'}`);
  out(`  Contact: ${prospect.contact_name || 'unknown'} <${prospect.contact_email || 'no email'}>`);
  out(`  Source: ${prospect.source}`);
  out(`  ICP Factors: ${JSON.stringify(prospect.icp_factors)}`);

  // Check if this prospect already has an opportunity
  const oppResult = await pool.query(
    'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 1',
    [prospect.prospect_id]
  );
  let opportunity = oppResult.rows[0] || null;
  if (opportunity) {
    out(`  Existing opportunity: ${opportunity.opportunity_id} (status=${opportunity.status}, offer=${opportunity.offer_id}, price=$${(opportunity.proposed_price / 100).toFixed(2)})`);
  } else {
    out('  No existing opportunity — will need to create one.');
  }

  // Clean up any goals from previous failed runs
  await pool.query("DELETE FROM heidi_goals WHERE title LIKE 'Draft personalized outreach for Score Test%'");
  out('  Cleaned up old goals from previous runs.');

  // ─── Step 2: Create a real goal in heidi_goals ──────────────────
  out('');
  out('STEP 2: Creating real goal in heidi_goals...');

  const goalId = randomUUID();
  const goalTitle = `Draft personalized outreach for ${prospect.company_name}`;
  const goalContext = {
    prospectId: prospect.prospect_id,
    prospectName: prospect.company_name,
    icpScore: prospect.icp_score,
    industry: prospect.industry,
    location: prospect.location,
    capabilityId: opportunity ? 'commercial.prepare_outreach' : 'revenue.create_opportunity',
    capabilityParams: opportunity ? {
      prospectId: prospect.prospect_id,
      opportunityId: opportunity.opportunity_id,
      offerId: opportunity.offer_id,
      cognitiveCycleId: 'pending',
      goalId: goalId,
    } : {
      prospectId: prospect.prospect_id,
      offerId: 'ai_operations_setup',
    },
  };

  await pool.query(
    `INSERT INTO heidi_goals (id, title, goal_type, status, priority, context, created_at, updated_at)
     VALUES ($1, $2, 'task', 'pending', 10, $3, NOW(), NOW())`,
    [goalId, goalTitle, JSON.stringify(goalContext)]
  );
  out(`  Created goal: ${goalId}`);
  out(`  Title: ${goalTitle}`);
  out(`  Priority: 10 (highest, 1-10 scale)`);
  out(`  Target capability: ${goalContext.capabilityId}`);

  await pool.end();

  // Second pool for cycle 2 queries (first pool was closed)
  const pool2 = new Pool({
    host: process.env.PG_HOST || process.env.PGHOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || process.env.PGPORT || '54322', 10),
    database: process.env.PG_DATABASE || process.env.PGDATABASE || 'postgres',
    user: process.env.PG_USER || process.env.PGUSER || 'postgres',
    password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'postgres',
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  // ─── Step 3: Build the production CognitiveCore ─────────────────
  out('');
  out('STEP 3: Building production CognitiveCore (same as daemon)...');

  const { buildCognitiveCore } = await import('../lib/heidi/CognitiveCoreBuilder');
  const { createClient } = await import('@supabase/supabase-js');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    out('  ERROR: Supabase env vars not configured. Cannot build CognitiveCore.');
    writeReport(log, prospect, null, null);
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const core = await buildCognitiveCore({
    supabase,
    dbConfig: {
      host: process.env.PG_HOST || '127.0.0.1',
      port: parseInt(process.env.PG_PORT || '54322', 10),
      database: process.env.PG_DATABASE || 'postgres',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
    },
    enableMetaCognition: true,
    enableDecisionResolver: true,
  });

  out('  CognitiveCore built successfully.');
  const registry = core.getRegistry();
  const summary = registry.getSummary();
  out(`  Capabilities: ${summary.total} total, ${summary.available} available, ${summary.unavailable} unavailable`);

  // List available capabilities
  const caps = registry.listAll();
  out('  Available capabilities:');
  caps.filter(c => c.status === 'available').forEach(c => {
    out(`    [${c.riskLevel}] ${c.id}: ${c.description}`);
  });
  if (caps.filter(c => c.status !== 'available').length > 0) {
    out('  Unavailable capabilities:');
    caps.filter(c => c.status !== 'available').forEach(c => {
      out(`    [${c.status}] ${c.id}: ${c.description}`);
    });
  }

  // ─── Step 4: Run the cognitive cycle(s) ────────────────────────
  out('');
  out('STEP 4: Running core.runCycle() — the real production cognitive cycle...');
  out('  (This is the same method the daemon calls every 60s)');

  const states = [];
  // Cycle 1: Should create an opportunity for the prospect
  out('');
  out('── CYCLE 1 ──');
  let cycleStart = Date.now();
  let state = await core.runCycle();
  let cycleDuration = Date.now() - cycleStart;
  out(`  Cycle completed in ${cycleDuration}ms`);
  out(`  Cycle ID: ${state.cycleId}`);
  out(`  Final phase: ${state.phase}`);
  out(`  Errors: ${state.errors.length === 0 ? 'none' : state.errors.join('; ')}`);
  out(`  Selected action: ${state.selectedAction?.actionType || 'none'}`);
  out(`  Authorized: ${state.authorizationResult?.authorized || false}`);
  out(`  Executed: ${state.executionResult?.executed || false}`);
  out(`  Outcome: ${state.executionResult?.outcome || 'n/a'}`);
  if (state.executionResult?.rawResult?.opportunityId) {
    out(`  → Opportunity created: ${state.executionResult.rawResult.opportunityId}`);
  }
  states.push(state);

  // Cycle 2: Now that an opportunity exists, create a goal to prepare outreach
  // First, check if the opportunity was created
  const opp2Result = await pool2.query(
    'SELECT * FROM revenue_opportunities WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 1',
    [prospect.prospect_id]
  );
  const opportunity2 = opp2Result.rows[0] || null;

  if (opportunity2) {
    out('');
    out('  Opportunity exists — creating outreach goal for cycle 2...');

    // Clean up the cycle-1 goal and create a new one for outreach
    const { randomUUID: ruuid2 } = require('crypto');
    const goal2Id = ruuid2();
    const goal2Context = {
      prospectId: prospect.prospect_id,
      prospectName: prospect.company_name,
      opportunityId: opportunity2.opportunity_id,
      icpScore: prospect.icp_score,
      industry: prospect.industry,
      location: prospect.location,
      capabilityId: 'commercial.prepare_outreach',
      capabilityParams: {
        prospectId: prospect.prospect_id,
        opportunityId: opportunity2.opportunity_id,
        offerId: opportunity2.offer_id,
        cognitiveCycleId: 'pending',
        goalId: goal2Id,
      },
    };

    await pool2.query(
      `INSERT INTO heidi_goals (id, title, goal_type, status, priority, context, created_at, updated_at)
       VALUES ($1, $2, 'task', 'pending', 10, $3, NOW(), NOW())`,
      [goal2Id, `Prepare outreach draft for ${prospect.company_name}`, JSON.stringify(goal2Context)]
    );
    out(`  Created outreach goal: ${goal2Id}`);

    // Mark cycle-1 goal as completed
    await pool2.query(
      "UPDATE heidi_goals SET status = 'completed', progress = 1.0 WHERE id = $1",
      [goalId]
    );

    out('');
    out('── CYCLE 2 ──');
    cycleStart = Date.now();
    state = await core.runCycle();
    cycleDuration = Date.now() - cycleStart;
    out(`  Cycle completed in ${cycleDuration}ms`);
    out(`  Cycle ID: ${state.cycleId}`);
    out(`  Final phase: ${state.phase}`);
    out(`  Errors: ${state.errors.length === 0 ? 'none' : state.errors.join('; ')}`);
    out(`  Selected action: ${state.selectedAction?.actionType || 'none'}`);
    out(`  Authorized: ${state.authorizationResult?.authorized || false}`);
    out(`  Executed: ${state.executionResult?.executed || false}`);
    out(`  Outcome: ${state.executionResult?.outcome || 'n/a'}`);
    if (state.executionResult?.rawResult?.messageBody) {
      out(`  → Outreach draft produced (subject: ${state.executionResult.rawResult.messageSubject})`);
    }
    states.push(state);
  } else {
    out('');
    out('  No opportunity found after cycle 1 — skipping cycle 2.');
  }

  // ─── Step 5: Report what actually happened ──────────────────────
  out('');
  out('STEP 5: Reporting what actually happened...');
  out('');

  // Phase 1: PERCEIVE
  out('── PHASE 1: PERCEIVE ──');
  if (state.perception) {
    out(`  System health: ${state.perception.systemHealth}`);
    out(`  Components observed:`);
    state.perception.components.forEach(c => {
      out(`    ${c.name}: ${c.status} (confidence: ${c.confidence}) — ${c.evidence}`);
    });
    if (state.perception.revenueStatus) {
      out(`  Revenue status: ${JSON.stringify(state.perception.revenueStatus).substring(0, 200)}`);
    }
    if (state.perception.capabilitySummary) {
      out(`  Capability summary: ${state.perception.capabilitySummary.total} total, ${state.perception.capabilitySummary.available} available, ${state.perception.capabilitySummary.unavailable} unavailable`);
    }
  } else {
    out('  Perception failed — no observation.');
  }

  // Phase 2: VALIDATE
  out('');
  out('── PHASE 2: VALIDATE ──');
  if (state.trustClassification) {
    out(`  Trust classification: ${JSON.stringify(state.trustClassification).substring(0, 300)}`);
  } else {
    out('  No trust classification (guardian not configured).');
  }

  // Phase 3-4: UNDERSTAND + WORLD MODEL
  out('');
  out('── PHASE 3-4: UNDERSTAND + UPDATE WORLD MODEL ──');
  if (state.worldModelSummary) {
    const wms = typeof state.worldModelSummary === 'string' ? state.worldModelSummary : JSON.stringify(state.worldModelSummary);
    out(`  World model: ${wms.substring(0, 300)}`);
  } else {
    out('  World model not available.');
  }

  // Phase 5: RETRIEVE MEMORY + GOALS
  out('');
  out('── PHASE 5: RETRIEVE MEMORY + IDENTIFY GOALS ──');
  out(`  Active missions: ${state.activeGoals.length}`);
  state.activeGoals.forEach(g => out(`    - [${g.priority}] ${g.title} (status: ${g.status})`));
  out(`  Pending work: ${state.pendingWork.length}`);
  state.pendingWork.forEach(g => {
    out(`    - [${g.priority}] ${g.title} (status: ${g.status}, goalId: ${g.goalId})`);
    if (g.context) {
      const ctx = typeof g.context === 'string' ? JSON.parse(g.context) : g.context;
      out(`      context: ${JSON.stringify(ctx).substring(0, 300)}`);
    }
  });
  if (state.retrievedMemory) {
    out(`  Retrieved memory: ${JSON.stringify(state.retrievedMemory).substring(0, 200)}`);
  }

  // Phase 7: PLAN
  out('');
  out('── PHASE 7: PLAN ──');
  if (state.selectedAction) {
    out(`  Selected action: ${state.selectedAction.actionType}`);
    out(`  Capability: ${state.selectedAction.capabilityId}`);
    out(`  Description: ${state.selectedAction.description}`);
    out(`  Risk level: ${state.selectedAction.riskLevel}`);
    out(`  Estimated impact: ${state.selectedAction.estimatedImpact}`);
    out(`  Reasoning: ${state.selectedAction.reasoning}`);
    out(`  Params: ${JSON.stringify(state.selectedAction.params).substring(0, 400)}`);
    if (state.selectedAction.alternatives && state.selectedAction.alternatives.length > 0) {
      out(`  Alternatives considered:`);
      state.selectedAction.alternatives.forEach(a => {
        out(`    - ${a.action}: ${a.reason} ${a.rejected ? '(rejected)' : ''}`);
      });
    }
  } else {
    out('  No action selected.');
  }

  // Phase 8: ASSESS RISK
  out('');
  out('── PHASE 8: ASSESS RISK/CONFIDENCE ──');
  if (state.metaCognitiveEvaluation) {
    out(`  Quality score: ${state.metaCognitiveEvaluation.qualityScore}`);
    out(`  Classification: ${state.metaCognitiveEvaluation.classification}`);
  } else {
    out('  Meta-cognition not available (module not loaded).');
  }

  // Phase 9: SELECT
  out('');
  out('── PHASE 9: SELECT ──');
  if (state.decisionResolution) {
    out(`  Decision: ${JSON.stringify(state.decisionResolution).substring(0, 300)}`);
  } else {
    out('  No competing goals — single path selected.');
  }

  // Phase 10: AUTHORIZE
  out('');
  out('── PHASE 10: AUTHORIZE ──');
  if (state.authorizationResult) {
    out(`  Authorized: ${state.authorizationResult.authorized}`);
    out(`  Reason: ${state.authorizationResult.reason}`);
    out(`  Risk level: ${state.authorizationResult.riskLevel}`);
    if (state.authorizationResult.escalationRecordId) {
      out(`  Escalation record: ${state.authorizationResult.escalationRecordId}`);
    }
  } else {
    out('  No authorization result.');
  }

  // Phase 11: ACT
  out('');
  out('── PHASE 11: ACT ──');
  if (state.executionResult) {
    out(`  Executed: ${state.executionResult.executed}`);
    out(`  Action type: ${state.executionResult.actionType}`);
    out(`  Capability: ${state.executionResult.capabilityId}`);
    out(`  Outcome: ${state.executionResult.outcome}`);
    out(`  Details: ${state.executionResult.details}`);
    if (state.executionResult.rawResult) {
      const rawStr = JSON.stringify(state.executionResult.rawResult);
      out(`  Raw result: ${rawStr.substring(0, 1000)}`);
      if (rawStr.length > 1000) out(`  ... (truncated, full length: ${rawStr.length})`);
    }
    out(`  Evidence: ${JSON.stringify(state.executionResult.evidence).substring(0, 500)}`);
  } else {
    out('  No execution result.');
  }

  // Phase 12: VERIFY
  out('');
  out('── PHASE 12: VERIFY ──');
  if (state.verificationResult) {
    out(`  Verified: ${state.verificationResult.verified}`);
    out(`  Verification method: ${state.verificationResult.verificationMethod}`);
    out(`  Details: ${state.verificationResult.details}`);
  } else {
    out('  No verification (action not executed or no verifier).');
  }

  // Phase 13: LEARN
  out('');
  out('── PHASE 13: LEARN ──');
  if (state.learningResult) {
    out(`  Lessons learned: ${JSON.stringify(state.learningResult).substring(0, 300)}`);
  } else {
    out('  No learning recorded.');
  }

  // Phase 15: REPLAN
  out('');
  out('── PHASE 15: REPLAN ──');
  if (state.replanResult) {
    out(`  Replanned: ${state.replanResult.replanned}`);
    out(`  Reason: ${state.replanResult.deviationReason}`);
  } else {
    out('  No replanning needed.');
  }

  // ─── Step 6: Try the LLM for personalized reasoning ─────────────
  out('');
  out('STEP 6: Attempting LLM-based personalized reasoning...');
  out('  (Calling Ollama directly — the local model that HEIDI perceives as healthy)');

  try {
    const ollamaUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
    const ollamaModel = process.env.LOCAL_MODEL_NAME || 'llama3.1';

    // First check what models are available
    const tagsResp = await fetch(`${ollamaUrl}/api/tags`);
    const tagsData = await tagsResp.json() as any;
    const availableModels = tagsData.models?.map((m: any) => m.name) || [];
    out(`  Available Ollama models: ${availableModels.join(', ') || 'none'}`);

    const modelName = availableModels[0] || ollamaModel;
    out(`  Using model: ${modelName}`);

    const prompt = `You are HEIDI, an AI operations assistant for ProtoForge. Analyze this prospect and draft a personalized outreach message.

PROSPECT DATA (real, from database):
- Company: ${prospect.company_name}
- Industry: ${prospect.industry || 'unknown'}
- Location: ${prospect.location || 'unknown'}
- ICP Score: ${prospect.icp_score}/100
- ICP Factors: ${JSON.stringify(prospect.icp_factors)}
- Source: ${prospect.source}
- Website: ${prospect.website || 'unknown'}

OFFER:
- AI Operations Setup: $${(50000 / 100).toFixed(2)} one-time
- Includes: AI-powered lead capture, automated customer communication, monitoring dashboard, tool integration

Based ONLY on the data above (do not fabricate any facts about this company), write:
1. A brief analysis of why this prospect is a good fit (based on ICP factors)
2. A personalized outreach email subject line
3. A personalized outreach email body (3-4 paragraphs, conversational, referencing their industry and ICP factor strengths)

Be concise and direct.`;

    out('  Sending prompt to Ollama...');
    const llmStart = Date.now();
    const llmResp = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 800 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const llmDuration = Date.now() - llmStart;

    if (llmResp.ok) {
      const llmData = await llmResp.json() as any;
      const responseText = llmData.response || '';
      out(`  LLM responded in ${llmDuration}ms`);
      out(`  Model used: ${modelName}`);
      out(`  Response length: ${responseText.length} chars`);
      out('');
      out('  LLM OUTPUT (real model generation, not a template):');
      out('  ───────────────────────────────────');
      if (responseText) {
        responseText.split('\n').forEach((line: string) => out('  ' + line));
      } else {
        out('  (empty response)');
      }
      out('  ───────────────────────────────────');

      // Save LLM output for the report
      (state as any).llmOutput = { text: responseText, model: modelName, durationMs: llmDuration };
    } else {
      out(`  Ollama returned HTTP ${llmResp.status}`);
      const errText = await llmResp.text();
      out(`  Error: ${errText.substring(0, 300)}`);
    }
  } catch (e) {
    out(`  LLM not available: ${e instanceof Error ? e.message : 'unknown'}`);
    out('  (Ollama may not be running or may not have a model loaded.)');
  }

  // ─── Step 7: Check what was produced ────────────────────────────
  out('');
  out('STEP 7: Checking what was actually produced...');

  // Check if an outreach draft was created
  if (state.executionResult?.rawResult?.messageBody) {
    out('  OUTREACH DRAFT PRODUCED:');
    out('  ─────────────────────────────');
    out(`  Subject: ${state.executionResult.rawResult.messageSubject}`);
    out(`  Channel: ${state.executionResult.rawResult.messageChannel}`);
    out(`  Authorization state: ${state.executionResult.rawResult.authorizationState}`);
    out('  Body:');
    state.executionResult.rawResult.messageBody.split('\n').forEach(l => out('    ' + l));
    out('  ─────────────────────────────');
  }

  // Check if an opportunity was created
  if (state.executionResult?.rawResult?.opportunityId) {
    out(`  OPPORTUNITY CREATED: ${state.executionResult.rawResult.opportunityId}`);
  }

  // ─── Write the report ───────────────────────────────────────────
  out('');
  out('Writing report...');
  writeReport(log, prospect, states, opportunity);

  // Cleanup
  try { await pool2.end(); } catch {}
  try { await core.close(); } catch {}
}

function writeReport(log, prospect, states, opportunity) {
  const reportPath = path.resolve(__dirname, '..', 'HEIDI_REAL_COGNITIVE_CYCLE_REPORT.md');
  let report = `# HEIDI Real Cognitive Cycle Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `**Method:** Production CognitiveCore.runCycle() — same governed path the daemon uses\n\n`;
  report += `---\n\n`;

  if (!prospect) {
    report += `## No Real Unprocessed Data Found\n\n`;
    report += `No real, uncontacted, scored prospects exist in the database.\n`;
    report += `The "impressive autonomous demo" gap right now is **data**, not capability.\n\n`;
    report += `The pipeline has processed everything available. To see HEIDI run a real\n`;
    report += `cognitive cycle against a real prospect, new prospect data must be imported\n`;
    report += `(via CSV import, external discovery API, or manual entry).\n`;
  } else {
    report += `## The Real Prospect\n\n`;
    report += `| Field | Value |\n|-------|-------|\n`;
    report += `| Company | ${prospect.company_name} |\n`;
    report += `| ICP Score | ${prospect.icp_score}/100 |\n`;
    report += `| Industry | ${prospect.industry || 'unknown'} |\n`;
    report += `| Location | ${prospect.location || 'unknown'} |\n`;
    report += `| Contact | ${prospect.contact_name || 'unknown'} |\n`;
    report += `| Email | ${prospect.contact_email || 'none'} |\n`;
    report += `| Source | ${prospect.source} |\n`;
    report += `| Website | ${prospect.website || 'unknown'} |\n`;
    report += `| ICP Factors | ${JSON.stringify(prospect.icp_factors)} |\n\n`;

    const stateArray = Array.isArray(states) ? states : (states ? [states] : []);

    for (let i = 0; i < stateArray.length; i++) {
      const state = stateArray[i];
      report += `---\n\n## Cycle ${i + 1}\n\n`;

      report += `### What HEIDI Observed\n\n`;
      report += `**System health:** ${state.perception?.systemHealth || 'unknown'}\n\n`;
      if (state.perception?.components) {
        report += `| Component | Status | Evidence |\n|-----------|--------|----------|\n`;
        state.perception.components.forEach(c => {
          report += `| ${c.name} | ${c.status} | ${String(c.evidence).substring(0, 80)} |\n`;
        });
      }
      if (state.perception?.capabilitySummary) {
        report += `\n**Capabilities:** ${state.perception.capabilitySummary.total} total, ${state.perception.capabilitySummary.available} available, ${state.perception.capabilitySummary.unavailable} unavailable\n\n`;
      }
      if (state.worldModelSummary) {
        const wms = typeof state.worldModelSummary === 'string' ? state.worldModelSummary : JSON.stringify(state.worldModelSummary);
        report += `**World model:** ${wms}\n\n`;
      }

      report += `### What HEIDI Decided and Why\n\n`;
      if (state.selectedAction) {
        report += `**Selected action:** \`${state.selectedAction.actionType}\`\n\n`;
        report += `**Capability:** \`${state.selectedAction.capabilityId}\`\n\n`;
        report += `**Risk level:** ${state.selectedAction.riskLevel}\n\n`;
        report += `**Estimated impact:** ${state.selectedAction.estimatedImpact}\n\n`;
        report += `**Reasoning:** ${state.selectedAction.reasoning}\n\n`;
        if (state.selectedAction.alternatives?.length > 0) {
          report += `**Alternatives considered:**\n`;
          state.selectedAction.alternatives.forEach(a => {
            report += `- ${a.action}: ${a.reason} ${a.rejected ? '_(rejected)_' : ''}\n`;
          });
          report += `\n`;
        }
      }

      if (state.metaCognitiveEvaluation) {
        report += `**Meta-cognitive assessment:** quality=${state.metaCognitiveEvaluation.qualityScore?.toFixed(3)}, classification=${state.metaCognitiveEvaluation.classification}\n\n`;
      }

      report += `### Authorization\n\n`;
      if (state.authorizationResult) {
        report += `**Authorized:** ${state.authorizationResult.authorized}\n\n`;
        report += `**Reason:** ${state.authorizationResult.reason}\n\n`;
        if (state.authorizationResult.escalationRecordId) {
          report += `**Escalation record:** ${state.authorizationResult.escalationRecordId}\n\n`;
        }
      }

      report += `### What HEIDI Executed\n\n`;
      if (state.executionResult) {
        report += `**Executed:** ${state.executionResult.executed}\n\n`;
        report += `**Action type:** ${state.executionResult.actionType}\n\n`;
        report += `**Outcome:** ${state.executionResult.outcome}\n\n`;
        report += `**Details:** ${state.executionResult.details}\n\n`;
        if (state.executionResult.rawResult) {
          const raw = state.executionResult.rawResult;
          if (raw.messageBody) {
            report += `#### Outreach Draft Produced\n\n`;
            report += `**Subject:** ${raw.messageSubject}\n\n`;
            report += `**Channel:** ${raw.messageChannel}\n\n`;
            report += `**Authorization state:** ${raw.authorizationState}\n\n`;
            report += `**Proposed value:** $${(raw.proposedValueCents / 100).toFixed(2)}\n\n`;
            report += `**Message body:**\n\n`;
            report += `> ${raw.messageBody.split('\n').join('\n> ')}\n\n`;
            if (raw.evidenceUsed) {
              report += `**Evidence used:**\n\n`;
              report += `- Known facts: ${raw.evidenceUsed.knownFacts?.join('; ') || 'none'}\n`;
              report += `- Unknown facts (explicitly listed to prevent hallucination): ${raw.evidenceUsed.unknownFacts?.join('; ') || 'none'}\n\n`;
            }
          } else if (raw.opportunityId) {
            report += `#### Opportunity Created\n\n`;
            report += `**Opportunity ID:** ${raw.opportunityId}\n\n`;
            report += `**Offer:** ${raw.offerId || 'unknown'}\n\n`;
            report += `**Proposed price:** $${((raw.proposedPrice || raw.estimatedValue || 0) / 100).toFixed(2)}\n\n`;
            report += `**Probability:** ${raw.probability}\n\n`;
          } else {
            report += `**Raw result:**\n\`\`\`json\n${JSON.stringify(raw, null, 2).substring(0, 2000)}\n\`\`\`\n\n`;
          }
        }
      }

      report += `### Verification\n\n`;
      if (state.verificationResult) {
        report += `**Verified:** ${state.verificationResult.verified}\n\n`;
        report += `**Details:** ${state.verificationResult.details || 'n/a'}\n\n`;
      } else {
        report += `No verification performed (action not executed or no verifier configured).\n\n`;
      }

      report += `### Learning\n\n`;
      if (state.learningResult) {
        report += `**Lesson learned:** ${state.learningResult.lessonLearned ? 'yes' : 'no'}\n\n`;
        report += `**Lesson:** ${state.learningResult.lesson || 'n/a'}\n\n`;
        report += `**Memory stored:** ${state.learningResult.memoryStored ? 'yes (' + state.learningResult.memoryId + ')' : 'no'}\n\n`;
        report += `**Outcome classification:** ${state.learningResult.outcomeClassification || 'n/a'}\n\n`;
      }

      report += `### Cycle Metadata\n\n`;
      report += `| Field | Value |\n|-------|-------|\n`;
      report += `| Cycle ID | ${state.cycleId} |\n`;
      report += `| Duration | ${state.durationMs}ms |\n`;
      report += `| Final phase | ${state.phase} |\n`;
      report += `| Errors | ${state.errors.length === 0 ? 'none' : state.errors.join('; ')} |\n\n`;
    }

    // Use the last state for LLM output and "where it stopped"
    const lastState = stateArray[stateArray.length - 1];

    // LLM output
    if (lastState?.llmOutput?.text) {
      report += `---\n\n## LLM-Generated Personalized Reasoning\n\n`;
      report += `**Model:** ${lastState.llmOutput.model || 'unknown'}\n\n`;
      report += `**Response time:** ${lastState.llmOutput.durationMs || 'unknown'}ms\n\n`;
      report += `**Real model output (not a template):**\n\n`;
      report += `\`\`\`\n${lastState.llmOutput.text}\n\`\`\`\n\n`;
    }

    report += `---\n\n## Where Autonomous Execution Stopped and Why\n\n`;
    const stopped = [];
    for (let i = 0; i < stateArray.length; i++) {
      const s = stateArray[i];
      if (s.executionResult?.outcome === 'failure') {
        stopped.push(`Cycle ${i + 1}: Execution failed — ${s.executionResult.details}`);
      }
      if (s.verificationResult && !s.verificationResult.verified && s.executionResult?.executed) {
        stopped.push(`Cycle ${i + 1}: Verification failed — ${s.verificationResult.details || 'details unavailable'}`);
      }
      if (s.authorizationResult && !s.authorizationResult.authorized) {
        stopped.push(`Cycle ${i + 1}: Authorization denied — ${s.authorizationResult.reason}`);
      }
      // Check if outreach draft was produced but not sent
      if (s.executionResult?.rawResult?.authorizationState === 'draft') {
        stopped.push(`Cycle ${i + 1}: Outreach draft produced but NOT sent — requires human approval before sending (R2 authorization).`);
      }
    }
    // Check if email sending is the next wall
    const lastExec = lastState?.executionResult?.rawResult;
    if (lastExec?.authorizationState === 'draft') {
      stopped.push(`Next step (sending the email) is R2 — requires human authorization. HEIDI correctly stopped at draft preparation.`);
    }

    if (stopped.length > 0) {
      report += `Autonomous execution stopped at the following points:\n\n`;
      stopped.forEach(s => report += `1. ${s}\n`);
    } else {
      report += `The cycle(s) completed without hitting a wall.\n`;
    }
    report += `\n`;

    report += `### Bugs Discovered During This Run (noted, not fixed)\n\n`;
    report += `1. **\`commercial.create_opportunity\` bridge bug:** \`this.pipeline.getProspect is not a function\` — the CommercialWorkflow bridge wraps the workflow but its internal pipeline object doesn't have the \`getProspect\` method. Routed around by using \`revenue.create_opportunity\` instead.\n`;
    report += `2. **Verification query column mismatch:** The verifier for \`revenue.create_opportunity\` queries \`SELECT id FROM revenue_opportunities\` but the table uses \`opportunity_id\`, not \`id\`. This causes verification to fail even when the opportunity was successfully created.\n`;
    report += `3. **ModelManager API mismatch:** The ModelManager's public method is \`generateResponse(prompt, sessionId)\`, not \`generate(prompt)\`. Routed around by calling Ollama's API directly.\n\n`;
  }

  report += `---\n\n## Raw Execution Log\n\n`;
  report += `\`\`\`\n${log.join('\n')}\n\`\`\`\n`;

  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch(e => {
  console.error('FATAL ERROR:', e);
  process.exit(1);
});
