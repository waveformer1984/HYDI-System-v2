'use strict';

const { spawn } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, 'cli.py');

function pythonBin() {
  if (process.env.HYDI_PYTHON) return process.env.HYDI_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function tokenEnv(sender) {
  return `HYDI_BOARD_TOKEN_${String(sender || '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function tokenFor(sender) {
  if (process.env.HYDI_BOARD_TOKEN) return process.env.HYDI_BOARD_TOKEN;
  return process.env[tokenEnv(sender)] || '';
}

function callLocal(payload) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(pythonBin(), [CLI], { env: process.env, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, status: 503, error: error instanceof Error ? error.message : 'python unavailable' });
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, status: 503, error: 'board timeout' });
    }, 8000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 503, error: error instanceof Error ? error.message : 'python unavailable' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ ok: false, status: 503, error: 'board unavailable' });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function httpJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: response.status, error: 'board unavailable' };
  }
}

/**
 * board.post(channel, body) — optional third argument is reply_to.
 * Uses HYDI_BOARD_URL when set, otherwise the local sqlite store.
 */
async function post(channel, body, replyTo) {
  const sender = process.env.HYDI_BOARD_SENDER || '';
  const token = tokenFor(sender);
  const base = String(process.env.HYDI_BOARD_URL || '').replace(/\/$/, '');
  if (!token) return { ok: false, skipped: true, error: 'board auth not configured' };
  if (base) {
    try {
      return await httpJson(`${base}/api/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sender,
          channel: channel || 'general',
          body,
          reply_to: replyTo || null,
        }),
      });
    } catch (error) {
      return { ok: false, status: 503, error: error instanceof Error ? error.message : 'board unavailable' };
    }
  }
  return callLocal({
    method: 'POST',
    client_ip: '127.0.0.1',
    authorization: `Bearer ${token}`,
    body: { sender, channel: channel || 'general', body, reply_to: replyTo || null },
  });
}

/** board.read(since) — optional second argument selects the channel. */
async function read(since, channel) {
  const base = String(process.env.HYDI_BOARD_URL || '').replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('channel', channel || 'general');
  if (since) params.set('since', since);
  if (base) {
    try {
      const result = await httpJson(`${base}/api/board?${params.toString()}`, { method: 'GET' });
      return result.messages || [];
    } catch {
      return [];
    }
  }
  const result = await callLocal({
    method: 'GET',
    client_ip: '127.0.0.1',
    query: { channel: channel || 'general', since: since || '' },
  });
  return result.messages || [];
}

module.exports = {
  post,
  read,
  tokenFor,
  tokenEnv,
};
