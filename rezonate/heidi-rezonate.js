#!/usr/bin/env node
/**
 * Heidi - Rezonate copilot (v1: deterministic, offline, no HYDI backend needed)
 * A small command brain that drives your Rezonate tools. No cloud, no Supabase,
 * no flaky 1.5B model guessing - it maps what you say straight to the right tool.
 *
 *   node heidi-rezonate.js
 *
 * Try:
 *   dark rhodes 88            (just search - anything unrecognized is a search)
 *   find vocal chops F min
 *   stems                     (splits the newest audio file in your Downloads)
 *   stems "C:\\path\\song.mp3"
 *   scan                      (re-scan drives, refresh the library)
 *   help  /  quit
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const CATALOG = path.join(HERE, 'samples-catalog.json');
let SAMPLES = [];

function loadCatalog() {
  try { SAMPLES = (JSON.parse(fs.readFileSync(CATALOG, 'utf8')).samples) || []; }
  catch { SAMPLES = []; }
}

// strip conversational filler so "find me some dark rhodes" -> "dark rhodes"
const FILLER = /\b(find|search|show|get|me|some|for|a|an|the|with|please|i|want|need|looking|grab|gimme|got|any)\b/g;

function search(q) {
  const terms = q.toLowerCase().replace(FILLER, ' ').split(/\s+/).filter(Boolean);
  if (!terms.length) { console.log('  (tell me what to look for, e.g. "dark rhodes 88")'); return; }
  const out = [];
  for (const s of SAMPLES) {
    const hay = (s.name + ' ' + s.path + ' ' + (s.tags || []).join(' ') + ' ' + (s.key || '') + ' ' + (s.bpm || '')).toLowerCase();
    if (terms.every(t => hay.includes(t))) out.push(s);
    if (out.length >= 12) break;
  }
  if (!out.length) {
    console.log('  nothing in your ' + SAMPLES.length.toLocaleString() + ' samples for "' + terms.join(' ') + '". try fewer words.');
    return;
  }
  console.log('  ' + out.length + (out.length >= 12 ? '+' : '') + ' matches:');
  for (const s of out) {
    const meta = [s.key, s.bpm ? s.bpm + 'bpm' : null].filter(Boolean).join(' · ');
    console.log('   • ' + s.name + (meta ? '  (' + meta + ')' : ''));
    console.log('       ' + s.folder);
  }
}

function newestDownload() {
  const dl = path.join(os.homedir(), 'Downloads');
  try {
    const f = fs.readdirSync(dl)
      .filter(n => /\.(mp3|wav|flac|m4a|ogg)$/i.test(n))
      .map(n => ({ n, t: fs.statSync(path.join(dl, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return f.length ? path.join(dl, f[0].n) : null;
  } catch { return null; }
}

function makeStems(arg) {
  let file = (arg || '').trim().replace(/^["']|["']$/g, '');
  if (!file) {
    file = newestDownload();
    if (!file) { console.log('  no file given and none found in Downloads. try: stems "C:\\path\\song.mp3"'); return; }
    console.log('  using newest download: ' + file);
  }
  if (!fs.existsSync(file)) { console.log('  file not found: ' + file); return; }
  console.log('  splitting into stems (CPU, a minute or two)...\n');
  spawnSync('python', [path.join(HERE, 'make-stems.py'), file], { stdio: 'inherit' });
}

function generate(prompt, withStems) {
  if (!prompt) { console.log('  tell me what to make, e.g. "song warm lo-fi soul, dusty rhodes, 85 bpm, F minor"'); return; }
  console.log('  generating with Lyria 3' + (withStems ? ' (then splitting into stems)' : '') + '...\n');
  const args = [path.join(HERE, 'generate.py')];
  if (withStems) args.push('--stems');
  args.push(prompt);
  spawnSync('python', args, { stdio: 'inherit' });
}

function scan(args) {
  console.log('  scanning your drives...\n');
  spawnSync('node', [path.join(HERE, 'scan-samples.js'), ...args], { stdio: 'inherit' });
  loadCatalog();
  console.log('\n  library reloaded: ' + SAMPLES.length.toLocaleString() + ' samples');
}

function help() {
  console.log([
    '  what I can do:',
    '   <anything>          search your library  (e.g. "dark rhodes 88")',
    '   song <description>  generate a track with Lyria 3 AND split it into stems',
    '   generate <descr>    just generate a track (no split)',
    '   stems [file]        split a track into stems (default: newest Downloads file)',
    '   scan [folders...]   re-scan drives and refresh the library',
    '   help                this',
    '   quit                exit',
  ].join('\n'));
}

function handle(line) {
  const t = line.trim();
  if (!t) return;
  const first = t.toLowerCase().split(/\s+/)[0];
  const rest = t.slice(first.length).trim();
  if (['quit', 'exit', 'q', 'bye'].includes(first)) { console.log('  later.'); process.exit(0); }
  if (['help', '?', 'commands', 'tools'].includes(first)) return help();
  if (['stems', 'split', 'separate', 'stem'].includes(first)) return makeStems(rest);
  if (['scan', 'rescan', 'reindex', 'refresh'].includes(first)) return scan(rest ? rest.split(/\s+/) : []);
  if (['song'].includes(first)) return generate(rest, true);              // generate + auto-split
  if (['generate', 'gen', 'compose'].includes(first)) return generate(rest, false);
  return search(t);   // default intent: search
}

loadCatalog();
console.log('\n  Heidi - Rezonate copilot');
console.log('  ' + (SAMPLES.length ? SAMPLES.length.toLocaleString() + ' samples loaded' : 'no catalog yet - type "scan" to build one'));
console.log('  type "help", or just tell me what you\'re after.\n');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '  heidi> ' });
rl.prompt();
rl.on('line', l => { try { handle(l); } catch (e) { console.log('  oops:', e.message); } rl.prompt(); });
rl.on('close', () => process.exit(0));
