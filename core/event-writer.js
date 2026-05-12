require('dotenv').config();
const { ChaosProxy } = require('./chaos-proxy');

function getClient() {
  console.log("WRITING TO:", process.env.SUPABASE_URL);
  console.log("CHAOS MODE:", process.env.CHAOS_MODE || 'NONE');
  
  // Use ChaosProxy for controlled failure injection
  return ChaosProxy.createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
}

async function writeEventWithRetry(event, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const supabase = getClient();
      const { data, error } = await supabase
        .from('hydi_events')
        .insert([event])
        .select();
      
      if (error) {
        throw new Error(`Supabase insert failed: ${error.message}`);
      }
      
      return { success: true, data: data[0] };
      
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Write attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries exhausted
  throw lastError;
}

async function writeEvent(event) {
  return writeEventWithRetry(event);
}

module.exports = { writeEvent };
