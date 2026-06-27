#!/usr/bin/env node
/**
 * Rezonate — Sample Scanner / Discovery (v2)
 * Don't know where your samples are? Just run it:
 *
 *   node scan-samples.js
 *
 * It searches your whole user profile + every other drive, skips system/junk
 * folders, catalogs every audio file, guesses BPM/key/tags from names, and
 * reports the top folders where your samples actually live.
 *
 * Or aim it at a known folder:  node scan-samples.js "D:\Samples"
 * Output: samples-catalog.json next to this file.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// --- 1. Roots: explicit args, else auto-discover (user profile + all other drives). ---
const CLI_ROOTS = process.argv.slice(2);

function discoverRoots() {
  const roots = [HOME, 'C:\\Users\\Public'];
  for (let c = 68; c <= 90; c++) {                 // D: .. Z:
    const drive = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(drive)) roots.push(drive); } catch {}
  }
  return roots;
}
const ROOTS = CLI_ROOTS.length ? CLI_ROOTS : discoverRoots();

const AUDIO_EXTS = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg', '.m4a']);

// Folders never worth walking (system, caches, dev, vcs).
const SKIP_DIRS = new Set([
  'AppData', 'Application Data', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', '$Recycle.bin', 'System Volume Information', 'node_modules',
  'Local', 'LocalLow', 'Roaming', 'Temp', 'OneDriveTemp', 'Recovery',
]);

const MAX_DEPTH = 16;

// --- 2. Cheap metadata from the filename (most packs encode it). ---
function guessMeta(name) {
  const bpmMatch = name.match(/(\d{2,3})\s?bpm/i);
  const keyMatch = name.match(/\b([A-G][#b]?)[ _-]?(maj|min|major|minor|m)\b/i);
  return {
    bpm: bpmMatch ? Number(bpmMatch[1]) : null,
    key: keyMatch ? `${keyMatch[1].toUpperCase()} ${/maj/i.test(keyMatch[2]) ? 'maj' : 'min'}` : null,
  };
}
const TAG_WORDS = ['kick','snare','hat','clap','bass','rhodes','piano','pad','lead',
  'vocal','loop','oneshot','one-shot','fx','perc','808','lofi','lo-fi','ambient','drum'];
function tagsFromPath(p) {
  const lower = p.toLowerCase();
  return TAG_WORDS.filter(w => lower.includes(w)).map(w => w.replace(/ /g, '-'));
}

// --- 3. Walk ---
const samples = [];
const folderCounts = new Map();     // dir -> { count, kb }
let errors = 0, lastTick = 0;

function walk(dir, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { errors++; return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(full, depth + 1);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      const meta = guessMeta(e.name);
      samples.push({ name: e.name, path: full, folder: dir, ext: ext.slice(1),
        size_kb: Math.round(size / 1024), bpm: meta.bpm, key: meta.key, tags: tagsFromPath(full) });
      const f = folderCounts.get(dir) || { count: 0, kb: 0 };
      f.count++; f.kb += Math.round(size / 1024);
      folderCounts.set(dir, f);
      if (samples.length - lastTick >= 500) { lastTick = samples.length; process.stdout.write(`  ...${samples.length} found so far\n`); }
    }
  }
}

console.log('Rezonate discovery scan — this can take a minute or two.\n');
for (const root of ROOTS) {
  if (fs.existsSync(root)) { console.log('  scanning', root); walk(root, 0); }
  else console.log('  (skip — not found)', root);
}

// --- 4. Output + report ---
const outPath = path.join(__dirname, 'samples-catalog.json');
fs.writeFileSync(outPath, JSON.stringify(
  { generated: new Date().toISOString(), count: samples.length, samples }, null, 2));

const topFolders = [...folderCounts.entries()]
  .sort((a, b) => b[1].count - a[1].count).slice(0, 20);
const withBpm = samples.filter(s => s.bpm).length;
const withKey = samples.filter(s => s.key).length;

console.log(`\n=== Done. ${samples.length} audio files across ${folderCounts.size} folders (${errors} unreadable). ===`);
console.log(`filename metadata: ${withBpm} have BPM, ${withKey} have key\n`);
console.log('Where your samples actually live (top folders):');
for (const [dir, f] of topFolders) console.log(`  ${String(f.count).padStart(5)}  ${dir}`);
console.log(`\ncatalog written -> ${outPath}`);
console.log('Paste this summary back and we wire these folders into the Samples UI.');
