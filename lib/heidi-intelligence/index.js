'use strict';

const { loadIdentity, buildIdentitySystemBlock, repoRoot } = require('./identity');
const { classifySkill, getSkillProfile, loadSkills } = require('./skills');
const { layerEnabled, resourceSnapshot, routeInference } = require('./router');
const { buildPlan } = require('./planner');
const { verifyContinuity, summarizeForAudit } = require('./memory-bridge');
const { evaluateToolProposal, gateToolHypotheses } = require('./tools-policy');
const { loadSuite, runHarnessSelfTest, recordTurnMetrics } = require('./evaluation');
const { captureAllowed, appendInteraction, redact } = require('./dataset-pipeline');
const { experimentalEnabled, buildFinetuneManifest } = require('./finetune-pathway');

/**
 * Single turn envelope for heidi-core — model-independent orchestration metadata.
 */
function prepareTurn({ input, context, persistence, conversationId, skillHint, env = process.env }) {
  if (!layerEnabled(env)) {
    return { enabled: false };
  }
  const skill = classifySkill(input, skillHint);
  const complexity = Math.min(1, (input?.length || 0) / 2000);
  const route = routeInference({
    skillId: skill.skillId,
    privacySensitive: /\b(secret|password|ssn|client data)\b/i.test(String(input)),
    complexity,
    env,
  });
  const plan = buildPlan({ input, skillId: skill.skillId, context });
  const continuity = verifyContinuity({ conversationId, context, persistence });
  return {
    enabled: true,
    identityVersion: loadIdentity().version,
    systemOverlay: buildIdentitySystemBlock(),
    skill,
    route,
    plan,
    continuity,
    resources: route.resources,
    audit: summarizeForAudit(context),
  };
}

function finalizeTurn({ input, answer, intelligence, metrics, correctedOutput, env = process.env }) {
  if (!intelligence?.enabled) return { captured: false };
  const evalRow = recordTurnMetrics(metrics || {});
  let captured = { written: false };
  if (answer) {
    captured = appendInteraction(
      {
        skillId: intelligence.skill?.skillId,
        input,
        output: answer,
        correctedOutput,
        route: intelligence.route,
        continuityPass: intelligence.continuity?.pass,
        metrics: evalRow,
      },
      env,
    );
  }
  return { captured, metrics: evalRow };
}

module.exports = {
  loadIdentity,
  buildIdentitySystemBlock,
  classifySkill,
  getSkillProfile,
  loadSkills,
  layerEnabled,
  resourceSnapshot,
  routeInference,
  buildPlan,
  verifyContinuity,
  summarizeForAudit,
  evaluateToolProposal,
  gateToolHypotheses,
  loadSuite,
  runHarnessSelfTest,
  recordTurnMetrics,
  captureAllowed,
  appendInteraction,
  redact,
  experimentalEnabled,
  buildFinetuneManifest,
  prepareTurn,
  finalizeTurn,
  repoRoot,
};