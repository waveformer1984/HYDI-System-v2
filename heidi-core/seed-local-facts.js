#!/usr/bin/env node
/**
 * Seed Heidi's local memory with VERIFIED facts about the HYDI system so she
 * answers system questions from memory instead of hallucinating.
 *
 * Run once (re-running is safe — facts are content-keyed upserts):
 *   node heidi-core/seed-local-facts.js
 */
const HeidiMemory = require('./memory/sqlite-store');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

async function embed(text) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text })
    });
    if (!r.ok) return null;
    return (await r.json()).embedding || null;
  } catch {
    return null;
  }
}

const FACTS = [
  { content: 'Heidi Core runs locally on port 3456. Endpoints: /health, /think, /think-stream (SSE), /chat, /state, /reflect.', division: 'HYDI' },
  { content: 'The panel/chat server runs on port 3006 and routes all chat through Heidi Core on port 3456.', division: 'HYDI' },
  { content: 'The whole local stack (Ollama, Heidi Core on 3456, panel server on 3006) is started by C:\\Users\\Owner\\HYDI-System-v2\\start-hydi-local.bat.', division: 'HYDI' },
  { content: 'Heidi\'s brain is Ollama at localhost:11434. Default chat model: llama3.2. Embeddings: nomic-embed-text. Fast model for short/code questions: qwen2.5-coder:1.5b.', division: 'HYDI' },
  { content: 'Installed local models: llama3, llama3.2, tinyllama, qwen2.5-coder:1.5b, nomic-embed-text.', division: 'HYDI' },
  { content: 'Heidi runs in LOCAL-ONLY MODE: Supabase, Stripe, and all cloud AI APIs are disabled. Nothing leaves this machine.', division: 'HYDI' },
  { content: 'Heidi\'s memory is stored in heidi-core/data/heidi_memory.db (SQLite) and survives restarts and reboots.', division: 'HYDI' },
  { content: 'There is NO "hydi update" command. To restart or reload the system, close the HYDI windows and run start-hydi-local.bat again.', division: 'HYDI' },
  { content: 'System health can be checked at http://localhost:3456/health — healthy means the brain (Ollama) is connected.', division: 'HYDI' },
  { content: 'A watchdog inside Heidi Core checks Ollama every 30 seconds and automatically restarts it if it stops responding.', division: 'HYDI' },
  { content: 'HYDI\'s six revenue streams are: galactic_bytes, detailer_bot, lipi_v2, protogrance_aromatics, rezonate, and waveformer_studio.', division: 'HYDI' },
  { content: 'HYDI named subsystems: Heidi (conversational orchestrator), Ursula (system monitor), CASCADE (event classifier), KILO (hypothesis generator, never executes), ProtoForge (policy engine), Hyve (opportunity collective).', division: 'HYDI' },
  { content: 'The user\'s name is J.', division: 'global' },
];

(async () => {
  const memory = new HeidiMemory();
  await memory.initialize();
  let withEmb = 0;
  for (const f of FACTS) {
    const e = await embed(f.content);
    if (e) withEmb++;
    await memory.storeFactWithEmbedding(f.content, f.division, 0.95, e);
    console.log('seeded:', f.content.slice(0, 70) + (f.content.length > 70 ? '…' : ''));
  }
  if (memory.close) await memory.close();
  console.log(`\nDone — ${FACTS.length} verified facts seeded (${withEmb} with embeddings).`);
  if (withEmb === 0) console.log('WARNING: no embeddings generated — is Ollama running with nomic-embed-text?');
})();
