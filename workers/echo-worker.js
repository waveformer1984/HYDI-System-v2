const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.WORKER_PORT || 3012;
const ID = process.env.WORKER_ID || 'architect-v2';

// THIS IS THE MISSING DOOR
app.post('/execute', (req, res) => {
  const { event } = req.body;
  console.log(`[${ID}] ?? WORKING: ${event.type} | ID: ${event.event_id}`);
  res.json({ ok: true, output: `Successfully handled by ${ID}` });
});

app.listen(PORT, () => {
  console.log(`[${ID}] Online at :${PORT} - Door /execute is OPEN.`);
});
