#!/usr/bin/env node
const http = require('http');

const msg = 'How does AppForge work?';
const data = JSON.stringify({ message: msg, model: 'llama3.2' });

console.log('Sending query: "' + msg + '"');
console.log('Waiting for response...\n');

let fullResponse = '';

const req = http.request({
  hostname: 'localhost',
  port: 3006,
  path: '/api/chat',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
}, res => {
  res.on('data', chunk => {
    const text = chunk.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.t) fullResponse += json.t;
          if (json.done) {
            console.log('GROUNDED RESPONSE (from procedural memory):');
            console.log('─'.repeat(80));
            console.log(fullResponse);
            console.log('─'.repeat(80));
            process.exit(0);
          }
        } catch (e) {}
      }
    }
  });
});

req.on('error', e => {
  console.error('Error:', e.message);
  process.exit(1);
});

req.setTimeout(60000, () => {
  console.error('Request timeout');
  process.exit(1);
});

req.write(data);
req.end();
