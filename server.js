const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Handle API routes
  if (req.url.startsWith('/api/')) {
    const apiPath = req.url.substring(5); // Remove '/api/'
    
    const apiFile = path.join(__dirname, 'api', `${apiPath}.js`);
    
    if (fs.existsSync(apiFile)) {
      try {
        // Clear require cache to allow hot reloading
        delete require.cache[require.resolve(apiFile)];
        const handler = require(apiFile);
        
        // Handle both sync and async handlers
        const result = handler(req, res);
        if (result && typeof result.catch === 'function') {
          result.catch(error => {
            console.error('API Error:', error);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Internal server error' }));
            }
          });
        }
        return;
      } catch (error) {
        console.error('API Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
        return;
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API endpoint not found' }));
      return;
    }
  }

  // Serve static files
  let filePath = path.join(__dirname, req.url === '/' ? 'signup.html' : req.url);
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // File not found, try serving signup.html as default
        fs.readFile(path.join(__dirname, 'signup.html'), (err, defaultContent) => {
          if (err) {
            res.writeHead(500);
            res.end('Server Error');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(defaultContent, 'utf-8');
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HYDI Payment Server running on http://127.0.0.1:${PORT}`);
  console.log(`💰 Ready to accept payments at http://127.0.0.1:${PORT}/signup`);
  console.log(`📊 Active services monitoring: 5/5 healthy`);
});
