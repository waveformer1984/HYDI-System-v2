'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./identity');

let cached = null;

function loadSkills() {
  if (cached) return cached;
  const file = path.join(repoRoot(), 'config', 'heidi-intelligence', 'skills.json');
  cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cached;
}

const SKILL_HINTS = Object.freeze({
  coding: /\b(code|bug|fix|test|npm|typescript|refactor|pr|commit)\b/i,
  research: /\b(research|explain|how does|architecture|document)\b/i,
  freelance_discovery: /\b(upwork|freelance|job scout|gig|contract)\b/i,
  proposal_prep: /\b(proposal|cover letter|bid|quote client)\b/i,
  business_ops: /\b(billing|invoice|stripe|revenue)\b/i,
  system_admin: /\b(health|pm2|frank|daemon|recovery|restart|deploy)\b/i,
});

function classifySkill(input, explicitSkill) {
  if (explicitSkill && loadSkills().skills[explicitSkill]) {
    return { skillId: explicitSkill, confidence: 1, source: 'explicit' };
  }
  const text = String(input || '');
  let best = { skillId: 'research', confidence: 0.3, source: 'default' };
  for (const [id, re] of Object.entries(SKILL_HINTS)) {
    if (re.test(text)) {
      return { skillId: id, confidence: 0.75, source: 'keyword' };
    }
  }
  return best;
}

function getSkillProfile(skillId) {
  const cfg = loadSkills().skills[skillId] || loadSkills().skills.research;
  return { id: skillId, ...cfg };
}

module.exports = { loadSkills, classifySkill, getSkillProfile };