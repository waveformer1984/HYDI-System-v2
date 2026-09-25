// tone-synth — deterministic local audio model for Rezonate.
// LocalModelRuntime contract: [modelPath] [prompt] [duration] [clip] [outputPath]
// Writes a real WAV file (16-bit PCM, chord progression seeded by the prompt
// hash) and prints `Saved: <path>`. Honest scope: this produces a simple
// synthesized backing track, not a finished song — the order deliverable is
// labeled 'tone-synth' in asset metadata.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const [, , prompt = '', durationArg = '30', clip = '0', outputPath = 'out.wav'] = process.argv;
const duration = Math.max(1, Math.min(300, parseInt(durationArg, 10) || 30));

// Seed from prompt so the same description yields the same track.
const seed = crypto.createHash('sha256').update(prompt || 'resonate').digest();
const NOTE = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25]; // C major
const bpm = 88 + (seed[1] % 48);
const root = NOTE[seed[0] % 4]; // pick a root
const chords = [
  [root, root * 1.25, root * 1.5],
  [root * 1.125, root * 1.4, root * 1.68],
  [root * 0.89, root * 1.125, root * 1.34],
  [root, root * 1.2, root * 1.5],
];
const beatSec = 60 / bpm;
const barSec = beatSec * 4;
const sampleRate = 22050;
const total = Math.floor(duration * sampleRate);
const data = Buffer.alloc(total * 2);

for (let i = 0; i < total; i++) {
  const t = i / sampleRate;
  const bar = Math.floor(t / barSec) % chords.length;
  const beat = Math.floor(t / beatSec);
  const env = Math.exp(-3 * (t % beatSec)); // plucked envelope
  let s = 0;
  for (const f of chords[bar]) {
    s += Math.sin(2 * Math.PI * f * t) * env * 0.18;
    s += Math.sin(2 * Math.PI * (f / 2) * t) * 0.08; // bass octave drone
  }
  // soft noise hat on each beat
  if ((t % beatSec) < 0.02) s += (seed[(beat + i) % seed.length] / 255 - 0.5) * 0.1;
  const fade = Math.min(1, t * 2, (duration - t) * 2);
  data.writeInt16LE(Math.max(-1, Math.min(1, s * fade)) * 32767, i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(data.length, 40);

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([header, data]));
console.log(`Saved: ${path.resolve(outputPath)}`);
