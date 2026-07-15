const http = require('http');

function analyzeError(event) {
  return new Promise((resolve, reject) => {
    const prompt = `System error from ${event.source}: 
      ${JSON.stringify(event.payload)}. 
      Explain cause and suggest fix in 2 sentences.`;
    
    const body = JSON.stringify({ prompt });
    const options = {
      hostname: '127.0.0.1',
      port: 8000,
      path: '/analyze',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || 'No analysis returned');
        } catch(e) {
          resolve('AI parse error');
        }
      });
    });
    
    req.on('error', () => resolve('AI unavailable'));
    req.write(body);
    req.end();
  });
}

module.exports = { analyzeError };
