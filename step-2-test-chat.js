#!/usr/bin/env node
const http = require('http');

const msg = 'What are Heidi decision bounds?';
const data = JSON.stringify({ message: msg, model: 'llama3.2' });

console.log('\n📍 STEP 2: Test Grounded Chat');
console.log('═'.repeat(80));
console.log(`Query: "${msg}"\n`);

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
            console.log('RESPONSE:');
            console.log('─'.repeat(80));
            console.log(fullResponse);
            console.log('─'.repeat(80));
            console.log('\n✅ VERIFICATION:');
            const hasThreshold = fullResponse.includes('0.85');
            const hasMax = fullResponse.includes('10000') || fullResponse.includes('$10');
            const hasLease = fullResponse.includes('120');

            console.log(`  ✓ Mentions 0.85 threshold: ${hasThreshold ? '✅' : '❌'}`);
            console.log(`  ✓ Mentions $10k max: ${hasMax ? '✅' : '❌'}`);
            console.log(`  ✓ Mentions 120s lease: ${hasLease ? '✅' : '❌'}`);

            if (hasThreshold && hasMax && hasLease) {
              console.log('\n🎉 GROUNDED RESPONSE CONFIRMED\n');
            } else {
              console.log('\n⚠️  Response missing some decision bounds\n');
            }
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
