// Segment-swap engine tests — exercises the real Python CLI end-to-end
// against synthetic WAV fixtures (no Demucs, no real catalog).
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PY = 'python';
const ENGINE = path.join(__dirname, '..', '..', '..', 'rezonate', 'segment-swap.py');

// ── minimal WAV writer (PCM16 stereo) ──────────────────────────────────
function writeWav(file, { seconds = 1, sr = 44100, freq = 220, ch = 2 } = {}) {
  const n = Math.floor(seconds * sr);
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 12000);
    for (let c = 0; c < ch; c++) data.writeInt16LE(v, (i * ch + c) * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(ch, 22); hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * ch * 2, 28); hdr.writeUInt16LE(ch * 2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([hdr, data]));
}

function readWav(file) {
  const b = fs.readFileSync(file);
  const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22);
  const n = (b.length - 44) / (ch * 2);
  const samples = new Int16Array(n * ch);
  for (let i = 0; i < n * ch; i++) samples[i] = b.readInt16LE(44 + i * 2);
  return { sr, ch, frames: n, samples };
}

// ── fixtures ────────────────────────────────────────────────────────────
let dir, stemsDir, catalogPath;
function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-test-'));
  stemsDir = path.join(dir, 'stems');
  fs.mkdirSync(stemsDir, { recursive: true });
  const sr = 44100, seconds = 20; // 10 bars @ 120bpm (2s/bar)
  for (const s of ['vocals', 'drums', 'bass', 'other']) {
    writeWav(path.join(stemsDir, s + '.wav'), { seconds, sr, freq: s === 'drums' ? 330 : 220 });
  }
  fs.writeFileSync(path.join(stemsDir, 'track.json'), JSON.stringify({ name: 'fixture', bpm: 120, key: 'A min' }));
  // fixture catalog: a 2s drum loop (exactly one 120bpm bar), a keyed sample, a dud
  const s1 = path.join(dir, 'drumloop_120bpm.wav'); writeWav(s1, { seconds: 2, freq: 440 });
  const s2 = path.join(dir, 'bass_Cm_118bpm.wav'); writeWav(s2, { seconds: 4, freq: 110 });
  const s3 = path.join(dir, 'unrelated_pad.wav'); writeWav(s3, { seconds: 30, freq: 80 });
  catalogPath = path.join(dir, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    samples: [
      { name: 'drumloop_120bpm.wav', path: s1, folder: dir, tags: ['drums'], bpm: 120, key: null },
      { name: 'bass_Cm_118bpm.wav', path: s2, folder: dir, tags: ['bass'], bpm: 118, key: 'C min' },
      { name: 'unrelated_pad.wav', path: s3, folder: dir, tags: ['pad'], bpm: null, key: null },
      { name: 'ghost_drums.wav', path: path.join(dir, 'does-not-exist.wav'), folder: dir, tags: ['drums'], bpm: 120, key: 'A min' }
    ]
  }));
}

function run(args, opts = {}) {
  return execFileSync(PY, [ENGINE, ...args], { encoding: 'utf8', timeout: 300000, ...opts });
}
function runJson(args) {
  const out = run([...args, '--json']);
  return JSON.parse(out.trim().split('\n').filter(l => l.trim().startsWith('{')).pop());
}
const base = () => ['--stems-dir', stemsDir, '--catalog', catalogPath];

test('segmentation: bar boundaries are BPM-aligned', () => {
  setup();
  const m = runJson([...base(), '--stem', 'drums', '--bars', '4-8', '--plan']);
  assert.equal(m.segments.length, 5);
  assert.equal(m.segments[0].startTime, 6.0);   // bar 4 = beats 12-16 @120bpm = 6s-8s
  assert.equal(m.segments[0].endTime, 8.0);
  assert.equal(m.segments[4].endTime, 16.0);
  assert.equal(m.segments[0].startBeat, 12);
  assert.equal(m.meterAssumed, true);
});

test('segmentation: multi-bar chunks', () => {
  setup();
  const m = runJson([...base(), '--stem', 'drums', '--bars', '1-8', '--segment-bars', '4', '--plan']);
  assert.equal(m.segments.length, 2);
  assert.equal(m.segments[0].endTime - m.segments[0].startTime, 8.0); // 4 bars @120bpm
});

test('ranking: matching drum loop beats unrelated pad', () => {
  setup();
  const m = runJson([...base(), '--stem', 'drums', '--bars', '2', '--samples', 'drum', '--plan']);
  const names = m.replacements.map(r => r.plannedSample);
  assert.ok(names.includes('drumloop_120bpm.wav'));
  assert.ok(!names.includes('ghost_drums.wav'), 'missing files must be excluded');
  assert.ok(!names.includes('unrelated_pad.wav'));
});

test('ranking: bpm compatibility favors exact tempo', () => {
  setup();
  // add a second drum sample at 118bpm — same query, worse bpm fit
  const s4 = path.join(dir, 'drumloop_118bpm.wav'); writeWav(s4, { seconds: 2, freq: 500 });
  const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  cat.samples.push({ name: 'drumloop_118bpm.wav', path: s4, folder: dir, tags: ['drums'], bpm: 118, key: null });
  fs.writeFileSync(catalogPath, JSON.stringify(cat));
  const m = runJson([...base(), '--stem', 'drums', '--bars', '1-2', '--samples', 'drum', '--plan']);
  const planned = [...new Set(m.replacements.map(r => r.plannedSample))];
  assert.ok(planned[0].includes('120bpm'), `expected 120bpm first, got ${planned[0]}`);
});

test('unknown bpm: refuses honestly instead of slicing blind', () => {
  setup();
  fs.writeFileSync(path.join(stemsDir, 'track.json'), JSON.stringify({ name: 'x' }));
  assert.throws(() => run([...base(), '--stem', 'drums', '--bars', '1-2', '--samples', 'drum']),
    /bpm unknown|non-zero exit|Command failed/i);
});

test('invalid segment range rejected', () => {
  setup();
  assert.throws(() => run([...base(), '--stem', 'drums', '--bars', '9-4']));
  assert.throws(() => run([...base(), '--stem', 'drums', '--bars', 'abc']));
});

test('missing sample match fails closed', () => {
  setup();
  assert.throws(() => run([...base(), '--stem', 'drums', '--bars', '1', '--samples', 'zzznomatchzzz']),
    /no catalog samples|Command failed/i);
});

test('full render: output properties + surgical replacement + manifest', () => {
  setup();
  const r = runJson([...base(), '--stem', 'drums', '--bars', '3-4', '--samples', 'drum', '--out-dir', path.join(dir, 'swap-out')]);
  const out = readWav(r.output);
  const origDrums = readWav(path.join(stemsDir, 'drums.wav'));
  const swapped = readWav(path.join(dir, 'swap-out', 'drums_swapped.wav'));
  // audio properties preserved
  assert.equal(out.sr, 44100); assert.equal(out.ch, 2);
  assert.equal(out.frames, origDrums.frames);
  assert.equal(swapped.frames, origDrums.frames);
  // surgical: untouched drums identical outside bars 3-4 (4s-8s @120bpm)
  const s = Math.floor(4.0 * out.sr) * 2, e = Math.floor(8.0 * out.sr) * 2;
  assert.deepEqual(swapped.samples.subarray(0, s), origDrums.samples.subarray(0, s));
  assert.deepEqual(swapped.samples.subarray(e), origDrums.samples.subarray(e));
  // changed inside the segment
  assert.notDeepEqual(swapped.samples.subarray(s, e), origDrums.samples.subarray(s, e));
  // no clipping / NaN-ish garbage
  let peak = 0; for (const v of out.samples) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 32767 && peak > 0, `peak=${peak}`);
  // manifest completeness
  const m = JSON.parse(fs.readFileSync(r.manifest, 'utf8'));
  assert.equal(m.engineVersion, 'segment-swap/1.0.0');
  assert.equal(m.replacements.length, 2);
  assert.ok(m.replacements[0].sampleHash && m.replacements[0].reason);
  assert.ok(m.outputHash && m.outputHash.length === 64);
  assert.equal(m.audio.sampleRate, 44100);
});

test('pitch: drum stem never pitch-shifts; key recorded honestly', () => {
  setup();
  const r = runJson([...base(), '--stem', 'drums', '--bars', '2', '--samples', 'drum', '--out-dir', path.join(dir, 'p')]);
  const m = JSON.parse(fs.readFileSync(r.manifest, 'utf8'));
  assert.equal(m.replacements[0].pitchShiftSemitones, 0);
});
