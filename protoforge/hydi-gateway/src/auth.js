function isAuthorized(req, serviceKey) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : '';
  return token === serviceKey;
}

function requireAuth(req, res, serviceKey) {
  if (!isAuthorized(req, serviceKey)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return false;
  }
  return true;
}

module.exports = { isAuthorized, requireAuth };
