const http = require('http');
const { createRouter } = require('./router');

function createServer(config, store) {
  const handle = createRouter(config, store);

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
          return;
        }
      }
      try {
        await handle(req, res, body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  });

  return server;
}

module.exports = { createServer };
