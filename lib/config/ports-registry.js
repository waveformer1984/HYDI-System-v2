'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'config', 'ports.json');
const MIRROR = path.join(ROOT, '.ports.json');

function loadPortsRegistry() {
  const p = fs.existsSync(CANONICAL) ? CANONICAL : MIRROR;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function registryPaths() {
  return { canonical: CANONICAL, mirror: MIRROR, root: ROOT };
}

function servicesDrift() {
  if (!fs.existsSync(CANONICAL) || !fs.existsSync(MIRROR)) return true;
  const a = JSON.parse(fs.readFileSync(CANONICAL, 'utf8'));
  const b = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  return JSON.stringify(a.services || {}) !== JSON.stringify(b.services || {});
}

module.exports = {
  loadPortsRegistry,
  registryPaths,
  servicesDrift,
  CANONICAL,
  MIRROR,
};
