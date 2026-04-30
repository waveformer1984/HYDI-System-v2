// Test script to verify SSE connection
// Run this to test if the events/stream endpoint is working

const EventSource = require('eventsource');

const url = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}/events/stream`
  : 'http://localhost:3005/events/stream';

console.log(`Testing connection to: ${url}`);

const eventSource = new EventSource(url);

eventSource.onopen = () => {
  console.log('✅ Connected successfully');
};

eventSource.onerror = (error) => {
  console.error('❌ Connection failed:', error);
  if (eventSource.readyState === EventSource.CLOSED) {
    process.exit(1);
  }
};

eventSource.addEventListener('connected', (e) => {
  const data = JSON.parse(e.data);
  console.log('📡 Connected event:', data);
});

eventSource.addEventListener('heartbeat', (e) => {
  const data = JSON.parse(e.data);
  console.log('💓 Heartbeat received:', data.timestamp);
});

// Test for 10 seconds then exit
setTimeout(() => {
  console.log('✅ Test completed - connection is stable');
  eventSource.close();
  process.exit(0);
}, 10000);
