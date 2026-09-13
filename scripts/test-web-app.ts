/**
 * Disposable test web application for HYDI browser qualification.
 *
 * Provides:
 *   - Navigation (multiple pages)
 *   - Form with input, select, button
 *   - State indicator (dynamic content)
 *   - Dynamically changing content (counter that increments)
 *   - Authentication flow with simulated MFA
 *
 * This is a LOCAL ONLY test server — never exposed to production.
 */

import http from 'http';
import { URL } from 'url';

const PORT = parseInt(process.env.HYDI_TEST_PORT || '9876', 10);

let counter = 0;
let mfaChallengeIssued = false;
let mfaApproved = false;
let sessionAuthenticated = false;

const COUNTER_INTERVAL = setInterval(() => { counter++; }, 2000);

function renderPage(content: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
${content}
</body>
</html>`;
}

function homePage(): string {
  return renderPage(`
    <h1>HYDI Test App</h1>
    <p>Status: <span id="status">running</span></p>
    <p>Counter: <span id="counter">${counter}</span></p>
    <nav>
      <a href="/" id="nav-home">Home</a> |
      <a href="/form" id="nav-form">Form</a> |
      <a href="/login" id="nav-login">Login</a> |
      <a href="/protected" id="nav-protected">Protected</a>
    </nav>
    <p>Session: <span id="session">${sessionAuthenticated ? 'authenticated' : 'anonymous'}</span></p>
  `, 'HYDI Test App — Home');
}

function formPage(): string {
  return renderPage(`
    <h1>Test Form</h1>
    <nav><a href="/" id="nav-home">Home</a></nav>
    <form id="test-form" action="/submit" method="POST">
      <label for="name">Name:</label>
      <input type="text" id="name" name="name" placeholder="Enter your name" />
      <br/><br/>
      <label for="category">Category:</label>
      <select id="category" name="category">
        <option value="">-- Select --</option>
        <option value="alpha">Alpha</option>
        <option value="beta">Beta</option>
        <option value="gamma">Gamma</option>
      </select>
      <br/><br/>
      <button type="submit" id="submit-btn">Submit</button>
    </form>
  `, 'HYDI Test App — Form');
}

function loginPage(): string {
  return renderPage(`
    <h1>Login</h1>
    <nav><a href="/" id="nav-home">Home</a></nav>
    <form id="login-form" action="/auth" method="POST">
      <label for="username">Username:</label>
      <input type="text" id="username" name="username" placeholder="Enter username" />
      <br/><br/>
      <label for="password">Password:</label>
      <input type="password" id="password" name="password" placeholder="Enter password" />
      <br/><br/>
      <button type="submit" id="login-btn">Login</button>
    </form>
  `, 'HYDI Test App — Login');
}

function mfaPage(): string {
  return renderPage(`
    <h1>MFA Challenge</h1>
    <nav><a href="/" id="nav-home">Home</a></nav>
    <p>An MFA challenge has been issued. Please approve to continue.</p>
    <div id="mfa-status">${mfaApproved ? 'approved' : 'pending'}</div>
    <form id="mfa-form" action="/mfa-approve" method="POST">
      <button type="submit" id="mfa-approve-btn">Approve MFA</button>
    </form>
  `, 'HYDI Test App — MFA');
}

function protectedPage(): string {
  if (!sessionAuthenticated) {
    return renderPage(`
      <h1>Access Denied</h1>
      <nav><a href="/" id="nav-home">Home</a> | <a href="/login" id="nav-login">Login</a></nav>
      <p>You must be authenticated to view this page.</p>
    `, 'HYDI Test App — Denied');
  }
  return renderPage(`
    <h1>Protected Page</h1>
    <nav><a href="/" id="nav-home">Home</a></nav>
    <p>Welcome to the protected page. You are authenticated.</p>
    <p>Session: <span id="session">authenticated</span></p>
  `, 'HYDI Test App — Protected');
}

function submitResultPage(name: string, category: string): string {
  return renderPage(`
    <h1>Form Submitted</h1>
    <nav><a href="/" id="nav-home">Home</a></nav>
    <div id="result">
      <p>Name: <span id="result-name">${name}</span></p>
      <p>Category: <span id="result-category">${category}</span></p>
      <p>Status: <span id="result-status">success</span></p>
    </div>
  `, 'HYDI Test App — Result');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // GET routes
  if (req.method === 'GET') {
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(homePage()); return; }
    if (path === '/form') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(formPage()); return; }
    if (path === '/login') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(loginPage()); return; }
    if (path === '/mfa') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(mfaPage()); return; }
    if (path === '/protected') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(protectedPage()); return; }
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', counter })); return; }
    res.writeHead(404); res.end('Not found'); return;
  }

  // POST routes
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const params = new URLSearchParams(body);

      if (path === '/submit') {
        const name = params.get('name') ?? '';
        const category = params.get('category') ?? '';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(submitResultPage(name, category));
        return;
      }

      if (path === '/auth') {
        const username = params.get('username') ?? '';
        const password = params.get('password') ?? '';
        // Simulate credential validation — accept test credentials
        if (username === 'testuser' && password === 'testpass') {
          mfaChallengeIssued = true;
          res.writeHead(302, { Location: '/mfa' });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(renderPage(`
            <h1>Login Failed</h1>
            <nav><a href="/" id="nav-home">Home</a> | <a href="/login" id="nav-login">Login</a></nav>
            <p id="error">Invalid credentials</p>
          `, 'HYDI Test App — Login Failed'));
        }
        return;
      }

      if (path === '/mfa-approve') {
        mfaApproved = true;
        sessionAuthenticated = true;
        mfaChallengeIssued = false;
        res.writeHead(302, { Location: '/protected' });
        res.end();
        return;
      }

      res.writeHead(404); res.end('Not found');
    });
    return;
  }

  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`HYDI test app running at http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  clearInterval(COUNTER_INTERVAL);
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  clearInterval(COUNTER_INTERVAL);
  server.close();
  process.exit(0);
});

export { server, PORT };
