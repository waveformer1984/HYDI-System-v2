#!/usr/bin/env node
/**
 * cost-audit.js -- report everything that could make HYDI cost money.
 *
 *   npm run cost:audit             # report only, exit 0
 *   npm run cost:audit -- --strict # exit 1 if any paid-provider key is set
 *
 * HYDI's operating constraint is $0. Most cloud model calls in this repo
 * fall back to a paid provider only when that provider's key is present,
 * so the key being set *is* the spend switch. This script checks:
 *   1. which paid-provider keys are set in this process's environment and
 *      in the repo's .env files (names only -- values are never printed);
 *   2. which source files call a paid endpoint directly, so a reviewer can
 *      see the blast radius of setting a key.
 * It reads files and env only. It never calls a provider.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Env var name -> provider. Names only; billing applies when set to a real key.
const PAID_KEYS = {
  ANTHROPIC_API_KEY: 'Anthropic',
  OPENAI_API_KEY: 'OpenAI',
  AIMLAPI_KEY: 'AIML API',
  AIML_API_KEY: 'AIML API',
  OPENROUTER_API_KEY: 'OpenRouter',
  GROQ_API_KEY: 'Groq',
  GOOGLE_API_KEY: 'Google AI',
  GEMINI_API_KEY: 'Google AI',
  ELEVENLABS_API_KEY: 'ElevenLabs',
  REPLICATE_API_TOKEN: 'Replicate',
};

// Plain substrings, not regexes: this greps source lines for where a paid
// host appears; it never validates or allows a URL.
const PAID_ENDPOINTS = [
  { provider: 'Anthropic', needle: 'api.anthropic.com' },
  { provider: 'OpenAI', needle: 'api.openai.com' },
  { provider: 'AIML API', needle: 'api.aimlapi.com' },
  { provider: 'OpenRouter', needle: 'openrouter.ai/api' },
  { provider: 'Groq', needle: 'api.groq.com' },
  { provider: 'Google AI', needle: 'generativelanguage.googleapis.com' },
];

const SCAN_DIRS = ['api', 'lib', 'pages', 'src', 'modules', 'pao-system', 'apps', 'heidi-core', 'heidi-life', 'termux'];
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py']);
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'build', 'out', 'coverage', '__tests__', 'tests', 'test', 'archive']);
const PLACEHOLDER = /your|placeholder|example|changeme|xxx|dummy|fake/i;

function looksReal(value) {
  return typeof value === 'string' && value.trim().length >= 20 && !PLACEHOLDER.test(value);
}

function parseEnvFile(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function keyReport(root, env) {
  const sources = [{ label: 'process env', vars: env }];
  for (const name of fs.readdirSync(root)) {
    if (!/^\.env(\..+)?$/.test(name)) continue;
    if (/\.(example|template|sample)$/.test(name)) continue;
    sources.push({ label: name, vars: parseEnvFile(path.join(root, name)) });
  }
  const rows = [];
  for (const { label, vars } of sources) {
    for (const [key, provider] of Object.entries(PAID_KEYS)) {
      if (looksReal(vars[key])) rows.push({ key, provider, source: label });
    }
  }
  return rows;
}

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) yield* walk(path.join(dir, e.name));
    } else if (SCAN_EXT.has(path.extname(e.name)) && !/\.test\.|\.spec\./.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

function callSiteReport(root) {
  const rows = [];
  for (const d of SCAN_DIRS) {
    for (const file of walk(path.join(root, d))) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|#)/.test(line)) return;
        for (const { provider, needle } of PAID_ENDPOINTS) {
          if (line.includes(needle)) rows.push({ provider, file: path.relative(root, file), line: i + 1 });
        }
      });
    }
  }
  return rows;
}

function main(argv = process.argv.slice(2), env = process.env, root = ROOT) {
  const strict = argv.includes('--strict');
  const keys = keyReport(root, env);
  const sites = callSiteReport(root);

  console.log('HYDI cost audit');
  console.log('===============\n');
  if (keys.length === 0) {
    console.log('Paid-provider keys set: none. Cloud fallbacks stay off; spend is $0 from model calls.\n');
  } else {
    console.log('Paid-provider keys set (each one turns on billable fallbacks):');
    for (const r of keys) console.log(`  ${r.key.padEnd(22)} ${r.provider.padEnd(11)} in ${r.source}`);
    console.log('  Remove the key (here and in any hosting dashboard) to return to $0.\n');
  }

  const byProvider = {};
  for (const s of sites) (byProvider[s.provider] ||= []).push(s);
  console.log(`Code paths that call a paid endpoint: ${sites.length}`);
  for (const [provider, list] of Object.entries(byProvider)) {
    console.log(`  ${provider} (${list.length})`);
    for (const s of list) console.log(`    ${s.file}:${s.line}`);
  }
  console.log('\nNot checked here: hosting dashboards (Vercel, Supabase, Netlify), GitHub plan,');
  console.log('and any key stored only in a cloud provider. Check those by hand.');

  return strict && keys.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, keyReport, callSiteReport, looksReal, parseEnvFile };
