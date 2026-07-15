#!/usr/bin/env node
'use strict';

/**
 * Phase 7 (native mobile prep) — Capacitor requires webDir/index.html
 * (capacitor.config.jsonsets webDir: "www"), but this repo's PWA entry is
 * hydi-mobile-protoforge.html at the repo root (manifest.json's start_url).
 * Rather than move/rename the existing PWA — which is also served directly
 * by sw.js / the root deployment today — this script stages a copy into
 * www/ on demand. Run before `npx cap sync`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

fs.mkdirSync(WWW, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'hydi-mobile-protoforge.html'), path.join(WWW, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(WWW, 'manifest.json'));
fs.copyFileSync(path.join(ROOT, 'sw.js'), path.join(WWW, 'sw.js'));

const iconsDir = path.join(ROOT, 'icons');
if (fs.existsSync(iconsDir)) {
  fs.cpSync(iconsDir, path.join(WWW, 'icons'), { recursive: true });
} else {
  console.warn('[build-capacitor-www] icons/ not found — manifest.json references /icons/icon-192.png and icon-512.png that do not exist in this repo yet. Add them before a real Android build (missing launcher icons will fail packaging).');
}

console.log('[build-capacitor-www] Staged PWA into www/ for Capacitor.');
