#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local)'); process.exit(1); }
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log('\n1. PUSHING TEST TASK TO AGENT_BUS');
  console.log('─'.repeat(80));

  // Insert test task
  const { data: inserted, error: insertError } = await client
    .from('agent_bus')
    .insert({
      type: 'operational_decision',
      division: 'deployment',
      payload: { action: 'scale_servers', region: 'us-east-1', instances: 3 },
      confidence: 0.88,
      within_bounds: true,
      status: 'pending'
    })
    .select();

  if (insertError) {
    console.error('Insert error:', insertError);
    process.exit(1);
  }

  const taskId = inserted[0].id;
  console.log(`✅ Task created: ${taskId}`);
  console.log(`   Type: operational_decision`);
  console.log(`   Confidence: 88%`);
  console.log(`   Payload: scale to 3 instances in us-east-1\n`);

  // Wait a moment for Heidi to process
  console.log('2. WAITING FOR HEIDI TO PROCESS (2 seconds)');
  console.log('─'.repeat(80));
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Approve via advisory API
  console.log('\n3. APPROVING VIA ADVISORY API (:3459)');
  console.log('─'.repeat(80));

  const approvalResult = await new Promise((resolve, reject) => {
    const postData = '';
    const req = http.request({
      hostname: 'localhost',
      port: 3459,
      path: `/api/decisions/${taskId}/approve`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  console.log(`✅ Approval Result:`);
  console.log(`   Success: ${approvalResult.success}`);
  console.log(`   Executed: ${approvalResult.executed}`);
  console.log(`   Action: ${approvalResult.action}\n`);

  console.log('4. VERIFYING TASK STATUS');
  console.log('─'.repeat(80));

  // Check task status
  const { data: updatedTask } = await client
    .from('agent_bus')
    .select('*')
    .eq('id', taskId);

  console.log(`✅ Task Status: ${updatedTask[0].status}`);
  console.log(`   Updated at: ${updatedTask[0].updated_at}\n`);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
