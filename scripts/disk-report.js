#!/usr/bin/env node
'use strict';
/**
 * Disk report for C: — read-only. Allowlisted action target (disk_report).
 * Prints free/total GB and the largest top-level folders under the user
 * profile so Jordan can see what is eating the disk without touching Frank.
 *
 * Usage: node scripts/disk-report.js [path]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const target = process.argv[2] || process.env.SystemDrive || 'C:\\';
const HOME = os.homedir();

function dirSizeGB(dir, depth = 0) {
  // Shallow measure: sum file sizes one level deep (fast, no full recursion
  // into node_modules trees). Depth arg kept for clarity.
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isFile()) total += fs.statSync(p).size;
      else if (e.isDirectory() && depth === 0) {
        // one level of subdirs only — keeps this under a few seconds
        for (const sub of fs.readdirSync(p, { withFileTypes: true })) {
          if (sub.isFile()) { try { total += fs.statSync(path.join(p, sub.name)).size; } catch { /* gone */ } }
        }
      }
    } catch { /* locked/gone */ }
  }
  return total;
}

function main() {
  const s = fs.statfsSync(target);
  const freeGB = (s.bavail * s.bsize) / 1073741824;
  const totalGB = (s.blocks * s.bsize) / 1073741824;
  console.log(`Disk report — ${target}`);
  console.log(`  free: ${freeGB.toFixed(1)} GB / ${totalGB.toFixed(1)} GB (${((freeGB / totalGB) * 100).toFixed(0)}% free)`);
  if (freeGB < 12) console.log('  WARNING: below the 12 GB CI floor — heavy tasks will be refused');
  console.log('  largest under ' + HOME + ':');
  const rows = [];
  for (const name of fs.readdirSync(HOME)) {
    const p = path.join(HOME, name);
    try {
      if (!fs.statSync(p).isDirectory()) continue;
    } catch { continue; }
    rows.push({ name, gb: dirSizeGB(p) / 1073741824 });
  }
  rows.sort((a, b) => b.gb - a.gb);
  for (const r of rows.slice(0, 10)) console.log(`    ${r.gb.toFixed(1).padStart(7)} GB  ${r.name}`);
}

main();
