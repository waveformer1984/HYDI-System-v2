// Test SSE Connection
require('dotenv').config();

const http = require('http');

function testSSEConnection() {
  console.log('Testing SSE connection to localhost:3002/events/stream');
  
  const req = http.request({
    hostname: 'localhost',
    port: 3002,
    path: '/events/stream',
    method: 'GET',
    timeout: 5000,
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  });
  
  req.on('response', (res) => {
    console.log(`SSE connection response: ${res.statusCode}`);
    console.log('Headers:', res.headers);
    
    if (res.statusCode === 200) {
      console.log('SSE connection: SUCCESS');
      
      let dataReceived = false;
      
      res.on('data', (chunk) => {
        console.log('Received data:', chunk.toString());
        dataReceived = true;
      });
      
      res.on('end', () => {
        console.log('SSE connection ended');
        if (dataReceived) {
          console.log('Event flow verification: SUCCESS');
        } else {
          console.log('Event flow verification: NO DATA RECEIVED');
        }
        process.exit(0);
      });
      
      // Close connection after 5 seconds
      setTimeout(() => {
        req.end();
      }, 5000);
      
    } else {
      console.log(`SSE connection: FAILED - Status ${res.statusCode}`);
      process.exit(1);
    }
  });
  
  req.on('error', (error) => {
    console.log(`SSE connection error: ${error.message}`);
    process.exit(1);
  });
  
  req.on('timeout', () => {
    console.log('SSE connection: TIMEOUT');
    req.destroy();
    process.exit(1);
  });
  
  req.end();
}

testSSEConnection();
