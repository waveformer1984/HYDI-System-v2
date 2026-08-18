const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createManifest } = require('../../../packages/application-manifest/src/index');

function toKebab(input) {
  return input
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toTitle(input) {
  return input
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function computePort(name) {
  const hash = crypto.createHash('sha256').update(name).digest('hex');
  const n = parseInt(hash.slice(0, 8), 16);
  return 3000 + (n % 6000);
}

function listFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(p));
    } else {
      results.push(p);
    }
  }
  return results;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function substitutePlaceholders(filePath, appName, port) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/{{APP_NAME}}/g, toKebab(appName));
  content = content.replace(/{{APP_TITLE}}/g, toTitle(appName));
  content = content.replace(/{{PORT}}/g, String(port));
  fs.writeFileSync(filePath, content);
}

function generate(appName, options = {}) {
  if (typeof appName !== 'string' || appName.trim().length === 0) {
    return { ok: false, error: 'app name is required' };
  }

  const kebab = toKebab(appName);
  if (kebab.length === 0) {
    return { ok: false, error: 'app name must contain letters or numbers' };
  }

  const cwd = options.cwd || process.cwd();
  const blueprintDir = options.blueprintDir || path.join(cwd, 'protoforge', 'blueprints', 'application');
  const targetDir = options.targetDir || path.join(cwd, 'protoforge-applications', kebab);
  const port = options.port || computePort(kebab);

  if (!fs.existsSync(blueprintDir)) {
    return { ok: false, error: `blueprint not found: ${blueprintDir}` };
  }
  if (fs.existsSync(targetDir) && !options.force) {
    return { ok: false, error: `target directory already exists: ${targetDir}` };
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  copyDir(blueprintDir, targetDir);

  const files = listFiles(targetDir);
  for (const file of files) {
    if (file.includes('.template')) {
      const rawPath = file.replace(/\.template/, '');
      fs.copyFileSync(file, rawPath);
      fs.unlinkSync(file);
      substitutePlaceholders(rawPath, appName, port);
    } else if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.md') || file.endsWith('.html') || file.endsWith('.css')) {
      substitutePlaceholders(file, appName, port);
    }
  }

  const manifest = createManifest({
    name: toTitle(appName),
    version: '0.1.0',
    capabilities: [],
    eventsProduced: [],
    eventsConsumed: [],
    providers: []
  });
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    appName: kebab,
    targetDir,
    port,
    manifest
  };
}

module.exports = {
  toKebab,
  toTitle,
  computePort,
  generate
};
