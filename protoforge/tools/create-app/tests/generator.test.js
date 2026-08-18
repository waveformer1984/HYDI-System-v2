const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { toKebab, toTitle, computePort, generate } = require('../src/generator');

describe('create-app generator', () => {
  const blueprintDir = path.resolve(__dirname, '..', '..', '..', 'blueprints', 'application');

  it('converts camelCase to kebab-case', () => {
    assert.strictEqual(toKebab('ProtoYI'), 'proto-yi');
  });

  it('converts spaces to kebab-case', () => {
    assert.strictEqual(toKebab('Build a Mind'), 'build-a-mind');
  });

  it('converts snake_case to kebab-case', () => {
    assert.strictEqual(toKebab('Blame_Games'), 'blame-games');
  });

  it('strips special characters', () => {
    assert.strictEqual(toKebab('Forge Finder!'), 'forge-finder');
  });

  it('title-cases a kebab name', () => {
    assert.strictEqual(toTitle('build-a-mind'), 'Build A Mind');
  });

  it('computes a deterministic port for a name', () => {
    const a = computePort('resonate');
    const b = computePort('resonate');
    assert.ok(a >= 3000 && a < 9000);
    assert.strictEqual(a, b);
  });

  it('rejects missing app name', () => {
    const result = generate('');
    assert.strictEqual(result.ok, false);
  });

  it('rejects names with only special characters', () => {
    const result = generate('!!!');
    assert.strictEqual(result.ok, false);
  });

  it('rejects non-existent blueprint', () => {
    const result = generate('test', { blueprintDir: path.join(os.tmpdir(), 'missing-blueprint') });
    assert.strictEqual(result.ok, false);
  });

  it('generates a new application from blueprint', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-${Date.now()}`);
    const result = generate('Proto YI', {
      blueprintDir,
      targetDir,
      port: 4242
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appName, 'proto-yi');
    assert.ok(fs.existsSync(path.join(targetDir, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(targetDir, 'package.json')));
    assert.ok(fs.existsSync(path.join(targetDir, 'README.md')));
    assert.ok(fs.existsSync(path.join(targetDir, 'src', 'index.js')));
  });

  it('substitutes app name in package.json', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-pkg-${Date.now()}`);
    generate('Forge Finder', { blueprintDir, targetDir, port: 4242 });
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
    assert.strictEqual(pkg.name, 'forge-finder');
  });

  it('substitutes app name and port in README', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-readme-${Date.now()}`);
    generate('Build a Mind', { blueprintDir, targetDir, port: 4242 });
    const readme = fs.readFileSync(path.join(targetDir, 'README.md'), 'utf-8');
    assert.ok(readme.includes('Build A Mind'));
    assert.ok(readme.includes('4242'));
  });

  it('writes a valid manifest', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-manifest-${Date.now()}`);
    const result = generate('Blame Games', { blueprintDir, targetDir, port: 4242 });
    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8'));
    assert.strictEqual(manifest.name, 'Blame Games');
    assert.strictEqual(manifest.version, '0.1.0');
    assert.ok(Array.isArray(manifest.capabilities));
  });

  it('refuses to overwrite an existing app without force', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-exist-${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });
    const result = generate('Existing', { blueprintDir, targetDir });
    assert.strictEqual(result.ok, false);
  });

  it('overwrites an existing app with force', () => {
    const targetDir = path.join(os.tmpdir(), `pf-gen-force-${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });
    const result = generate('Forced', { blueprintDir, targetDir, force: true });
    assert.strictEqual(result.ok, true);
    assert.ok(fs.existsSync(path.join(targetDir, 'manifest.json')));
  });
});
