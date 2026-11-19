'use strict';

/**
 * Gmail read-only ingest for job/win/payment alerts (Frank).
 * Scope: gmail.readonly only — never send, modify, or label.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
const { parseWinEmail, createProjectFromWin, parsePaymentEmail, recordPlatformPayment, workspaceDir, breakdownTasks } = require('./freelance-workspace');
const { scoutDir } = require('./decisions');

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const DEFAULT_QUERY = 'from:(fiverr.com OR upwork.com OR freelancer.com) newer_than:2d';

function defaultTokenPath(env = process.env) {
  if (env.JOB_SCOUT_TOKEN_PATH) return path.resolve(env.JOB_SCOUT_TOKEN_PATH);
  const home = env.USERPROFILE || env.HOME || '';
  return path.join(home, '.hydi', 'job-scout-gmail-token.json');
}

function processedFile(dir) {
  return path.join(dir, 'gmail-processed.json');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadProcessed(dir) {
  const data = readJson(processedFile(dir), { messageIds: [] });
  return new Set(data.messageIds || []);
}

function markProcessed(dir, ids) {
  const prev = readJson(processedFile(dir), { messageIds: [] });
  const merged = new Set([...(prev.messageIds || []), ...ids]);
  writeJsonAtomic(processedFile(dir), { messageIds: [...merged], updatedAt: new Date().toISOString() });
}

function detectPlatform(from, subject, body) {
  const blob = `${from} ${subject} ${body}`.toLowerCase();
  if (blob.includes('fiverr.com') || blob.includes('@fiverr')) return 'fiverr';
  if (blob.includes('upwork.com') || blob.includes('@upwork')) return 'upwork';
  if (blob.includes('freelancer.com') || blob.includes('@freelancer')) return 'freelancer';
  return null;
}

function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    urls.push(m[0].replace(/[.,;]+$/, ''));
  }
  return urls;
}

function pickJobUrl(platform, urls) {
  const rules = {
    freelancer: /freelancer\.com\/projects\//i,
    upwork: /upwork\.com\/(jobs|nx)\//i,
    fiverr: /fiverr\.com\//i,
  };
  const re = rules[platform];
  if (!re) return urls[0] || null;
  return urls.find((u) => re.test(u)) || urls[0] || null;
}

function isJobAlert(subject, body) {
  const t = `${subject}\n${body}`.toLowerCase();
  return /(new job|job alert|matches your profile|recommended for you|new project|matching project|buyer request|project posted|brief:|invitation to interview)/i.test(t);
}

function isPromoOrPolicy(subject, body) {
  const t = `${subject}\n${body}`.toLowerCase();
  return /(unsubscribe|privacy policy|terms of service|newsletter|promo|sale|% off|tips to succeed|community guidelines)/i.test(t)
    && !isJobAlert(subject, body);
}

function classifyInbound(msg) {
  const win = parseWinEmail({
    from: msg.from,
    subject: msg.subject,
    body: msg.body,
    receivedAt: msg.receivedAt,
  });
  if (win) return { type: 'win', win };

  const pay = parsePaymentEmail({
    from: msg.from,
    subject: msg.subject,
    body: msg.body,
    receivedAt: msg.receivedAt,
    platform: detectPlatform(msg.from, msg.subject, msg.body),
  });
  if (pay && (pay.cleared || pay.pending)) return { type: 'payment', payment: pay };

  if (isPromoOrPolicy(msg.subject, msg.body)) return { type: 'ignored' };
  if (isJobAlert(msg.subject, msg.body)) return { type: 'job' };
  return { type: 'ignored' };
}

function leadFromJobEmail(msg) {
  const platform = detectPlatform(msg.from, msg.subject, msg.body) || 'gmail';
  const bodyText = stripHtml(msg.body);
  const urls = extractUrls(`${msg.subject}\n${bodyText}`);
  const sourceUrl = pickJobUrl(platform, urls);
  const title = String(msg.subject || '').replace(/^(re:|fwd:)\s*/i, '').trim().slice(0, 200);
  const description = bodyText.slice(0, 4000);
  const id = `gmail:${msg.id}`;
  const parseFailed = !(title && sourceUrl);
  return {
    id,
    source: platform === 'gmail' ? 'gmail' : `gmail-${platform}`,
    sourceUrl: sourceUrl || `gmail://local/${msg.id}`,
    title: title || '(unparsed job alert)',
    description,
    company: null,
    budget: { min: null, max: null, currency: 'USD', type: 'unknown' },
    skills: [],
    postedAt: msg.receivedAt || new Date().toISOString(),
    kind: 'email_alert',
    gmailMessageId: msg.id,
    parse_failed: parseFailed,
  };
}

function decodeGmailBody(payload) {
  if (!payload) return '';
  const decode = (data) => Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  if (payload.body && payload.body.data) return decode(payload.body.data);
  const parts = payload.parts || [];
  for (const p of parts) {
    if (p.mimeType === 'text/plain' && p.body && p.body.data) return decode(p.body.data);
  }
  for (const p of parts) {
    if (p.mimeType === 'text/html' && p.body && p.body.data) return decode(p.body.data);
  }
  for (const p of parts) {
    if (p.parts) {
      const inner = decodeGmailBody(p);
      if (inner) return inner;
    }
  }
  return '';
}

function parseGmailApiMessage(msg) {
  const headers = (msg.payload && msg.payload.headers) || [];
  const byName = (n) => (headers.find((h) => h.name && h.name.toLowerCase() === n) || {}).value || '';
  const internalDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
  return {
    id: msg.id,
    from: byName('from'),
    subject: byName('subject'),
    body: decodeGmailBody(msg.payload),
    receivedAt: internalDate,
  };
}

async function loadAuthClient(env = process.env) {
  const clientId = env.JOB_SCOUT_GMAIL_CLIENT_ID;
  const clientSecret = env.JOB_SCOUT_GMAIL_CLIENT_SECRET;
  const tokenPath = defaultTokenPath(env);
  if (!clientId || !clientSecret) {
    return { ok: false, reason: 'gmail_oauth_not_configured' };
  }
  if (!fs.existsSync(tokenPath)) {
    return { ok: false, reason: 'gmail_token_missing', tokenPath: '[REDACTED]' };
  }
  let google;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    google = require('googleapis').google;
  } catch {
    return { ok: false, reason: 'googleapis_package_missing' };
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  const tokens = readJson(tokenPath, null);
  if (!tokens || !tokens.refresh_token) {
    return { ok: false, reason: 'gmail_token_invalid' };
  }
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', (t) => {
    if (!t.refresh_token) t.refresh_token = tokens.refresh_token;
    writeJsonAtomic(tokenPath, { ...tokens, ...t });
  });
  return { ok: true, auth: oauth2, google };
}

/**
 * Desktop first-run helper — prints URL; operator pastes code once on Frank.
 */
async function authorizeDesktop(env = process.env) {
  const loaded = await loadAuthClient(env);
  if (loaded.ok && fs.existsSync(defaultTokenPath(env))) {
    return { ok: true, already: true };
  }
  const clientId = env.JOB_SCOUT_GMAIL_CLIENT_ID;
  const clientSecret = env.JOB_SCOUT_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('set JOB_SCOUT_GMAIL_CLIENT_ID and JOB_SCOUT_GMAIL_CLIENT_SECRET');
  const { google } = require('googleapis');
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
  const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [GMAIL_SCOPE] });
  return { ok: true, url, complete: async (code) => {
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const tokenPath = defaultTokenPath(env);
    writeJsonAtomic(tokenPath, tokens);
    return { ok: true, tokenPath: '[REDACTED]' };
  } };
}

async function fetchGmailMessages(auth, google, query, env) {
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: query || env.JOB_SCOUT_GMAIL_QUERY || DEFAULT_QUERY,
    maxResults: Number(env.JOB_SCOUT_GMAIL_MAX) || 40,
  });
  const ids = (list.data.messages || []).map((m) => m.id).filter(Boolean);
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    out.push(parseGmailApiMessage(full.data));
  }
  return out;
}

async function processInboundMessages(messages, opts = {}) {
  const env = opts.env || process.env;
  const dir = opts.dir || scoutDir(env);
  const seen = opts.seen || loadProcessed(dir);
  const summary = {
    fetched: messages.length,
    skippedDuplicate: 0,
    jobs: 0,
    parse_failed: 0,
    wins: 0,
    payments: 0,
    ignored: 0,
    errors: 0,
  };
  const leads = [];
  const newIds = [];

  for (const raw of messages) {
    if (seen.has(raw.id)) {
      summary.skippedDuplicate += 1;
      continue;
    }
    newIds.push(raw.id);
    try {
      const kind = classifyInbound(raw);
      if (kind.type === 'ignored') {
        summary.ignored += 1;
        continue;
      }
      if (kind.type === 'win') {
        const ws = workspaceDir(env);
        const project = createProjectFromWin(ws, dir, kind.win);
        await breakdownTasks(project, { env, fetchImpl: opts.fetchImpl });
        summary.wins += 1;
        continue;
      }
      if (kind.type === 'payment') {
        recordPlatformPayment(workspaceDir(env), kind.payment);
        summary.payments += 1;
        continue;
      }
      if (kind.type === 'job') {
        const lead = leadFromJobEmail(raw);
        leads.push(lead);
        summary.jobs += 1;
        if (lead.parse_failed) summary.parse_failed += 1;
      }
    } catch {
      summary.errors += 1;
    }
  }

  if (newIds.length) markProcessed(dir, newIds);
  return { leads, summary, ok: true };
}

async function runGmailIngest(opts = {}) {
  const env = opts.env || process.env;
  const enabled = env.JOB_SCOUT_GMAIL === '1' || env.JOB_SCOUT_GMAIL === 'true';
  if (!Array.isArray(opts.fixtureMessages) && !enabled) {
    return { ok: false, skipped: true, reason: 'disabled', leads: [], summary: {} };
  }
  if (Array.isArray(opts.fixtureMessages)) {
    return processInboundMessages(opts.fixtureMessages, opts);
  }
  const authLoad = await loadAuthClient(env);
  if (!authLoad.ok) {
    return { ok: false, skipped: true, reason: authLoad.reason, leads: [], summary: {} };
  }
  try {
    const messages = await fetchGmailMessages(authLoad.auth, authLoad.google, opts.query, env);
    const result = await processInboundMessages(messages, { ...opts, env });
    return { ...result, ok: true };
  } catch (e) {
    return {
      ok: false,
      leads: [],
      summary: { errors: 1 },
      error: e instanceof Error ? e.message : 'gmail_failed',
    };
  }
}

module.exports = {
  GMAIL_SCOPE,
  DEFAULT_QUERY,
  defaultTokenPath,
  classifyInbound,
  leadFromJobEmail,
  processInboundMessages,
  runGmailIngest,
  authorizeDesktop,
  parseGmailApiMessage,
};