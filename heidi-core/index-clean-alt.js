// HEIDI Core — index.js (alt port)
// Uses lowdb (pure JS) instead of sqlite3. No native build required.

const express = require('express');
const axios = require('axios');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
app.use(express.json());

const PORT = 3457; // Changed from 3456
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL = 'llama3.2:latest'; // change to qwen2.5-coder:1.5b if preferred

// ── DB setup ────────────────────────────────────────────────────────────────
const dbFile = path.join(__dirname, 'heidi-memory.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { sessions: [], tasks: [] });

async function initDB() {
  await db.read();
  db.data ||= { sessions: [], tasks: [] };
  await db.write();
  console.log(`[DB] Memory file: ${dbFile}`);
}

// ── Helper: call Ollama ──────────────────────────────────────────────────────
async function callOllama(prompt, systemPrompt = '') {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: MODEL,
    messages,
    stream: false,
  }, { timeout: 60000 });

  return response.data.message?.content || '';
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    sessions: db.data.sessions.length,
    tasks: db.data.tasks.length,
    time: new Date().toISOString(),
  });
});

// Main think endpoint
app.post('/think', async (req, res) => {
  const { input, sessionId = 'default' } = req.body;
  if (!input) return res.status(400).json({ error: 'input required' });

  try {
    // Load session history
    await db.read();
    let session = db.data.sessions.find(s => s.id === sessionId);
    if (!session) {
      session = { id: sessionId, history: [], createdAt: new Date().toISOString() };
      db.data.sessions.push(session);
    }

    // Build context from last 10 exchanges
    const recentHistory = session.history.slice(-10)
      .map(h => `User: ${h.input}\nHEIDI: ${h.response}`)
      .join('\n');

    const systemPrompt = `You are HEIDI, the intelligent core of the ProtoForge system. 
You are a task router and assistant. Be concise and direct.
Recent conversation:\n${recentHistory}`;

    const response = await callOllama(input, systemPrompt);

    // Save to memory
    session.history.push({
      input,
      response,
      timestamp: new Date().toISOString(),
    });
    await db.write();

    res.json({ response, sessionId, model: MODEL });
  } catch (err) {
    console.error('[think] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create task
app.post('/task', async (req, res) => {
  const { title, description, priority = 'normal', source = 'api' } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  await db.read();
  const task = {
    id: `task_${Date.now()}`,
    title,
    description,
    priority,
    source,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.data.tasks.push(task);
  await db.write();

  console.log(`[task] Created: ${task.id} — ${title}`);
  res.json({ success: true, task });
});

// List tasks
app.get('/tasks', async (req, res) => {
  await db.read();
  res.json({ tasks: db.data.tasks });
});

// Update task status
app.patch('/task/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  await db.read();
  const task = db.data.tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: 'task not found' });

  task.status = status;
  task.updatedAt = new Date().toISOString();
  await db.write();

  res.json({ success: true, task });
});

// Clear session memory
app.delete('/session/:id', async (req, res) => {
  await db.read();
  db.data.sessions = db.data.sessions.filter(s => s.id !== req.params.id);
  await db.write();
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║  HEIDI Core running on :${PORT}   ║`);
    console.log(`║  Model: ${MODEL.padEnd(24)}║`);
    console.log(`╚══════════════════════════════════╝\n`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
