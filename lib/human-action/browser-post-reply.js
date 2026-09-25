// browser_post_reply — the narrowest possible external communication
// action: ONE opportunity, ONE destination, ONE exact message, ONE
// explicit authorization, ONE submission. Authorization binds
// (channel, destination, message_hash, opportunity_id); any drift =
// REQUIRES_NEW_AUTHORIZATION. Ambiguous submission = UNKNOWN, never
// retried (a blind retry could duplicate an external message).
//
// Statuses: DRAFT | PREPARED | AUTHORIZED | SUBMITTED | VERIFIED |
//           FAILED | REJECTED | WAITING_FOR_HUMAN | EXTERNAL_BLOCK | UNKNOWN

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(process.cwd(), '.hydi-operational', 'human-action-evidence');
const SUBMISSIONS_LOG = path.join(EVIDENCE_DIR, 'browser-post-reply-submissions.jsonl');
const AUTH_TTL_MS = 60 * 60 * 1000; // 1 hour — approval is not durable authority

function hashMessage(message) {
  return crypto.createHash('sha256').update(String(message)).digest('hex');
}

function createAuthorization(spec, authorizedBy = 'operator') {
  return {
    authorization_id: `authz_${crypto.randomUUID().slice(0, 12)}`,
    action_type: 'browser_post_reply',
    opportunity_id: spec.opportunityId,
    channel: spec.channel,
    destination: spec.permalink,
    message_hash: hashMessage(spec.message),
    authorized_by: authorizedBy,
    authorized_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + AUTH_TTL_MS).toISOString(),
    status: 'AUTHORIZED',
  };
}

function validateSpec(spec) {
  const a = spec?.authorization;
  if (!a) return { ok: false, status: 'REJECTED', reason: 'missing authorization' };
  if (a.action_type !== 'browser_post_reply') return { ok: false, status: 'REJECTED', reason: 'authorization action_type mismatch' };
  if (a.status === 'REJECTED') return { ok: false, status: 'REJECTED', reason: 'authorization was rejected' };
  if (a.status !== 'AUTHORIZED') return { ok: false, status: 'REJECTED', reason: `authorization status is ${a.status}` };
  if (new Date(a.expires_at).getTime() < Date.now()) return { ok: false, status: 'REJECTED', reason: 'authorization expired' };
  if (a.opportunity_id !== spec.opportunityId) return { ok: false, status: 'REJECTED', reason: 'opportunity mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.channel !== spec.channel) return { ok: false, status: 'REJECTED', reason: 'channel mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.destination !== spec.permalink) return { ok: false, status: 'REJECTED', reason: 'destination mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.message_hash !== hashMessage(spec.message)) return { ok: false, status: 'REJECTED', reason: 'message mismatch — REQUIRES_NEW_AUTHORIZATION' };
  return { ok: true };
}

// Duplicate protection — a submission log keyed on (destination, message_hash).
// A second execution of an already-submitted action is refused outright;
// an ambiguous prior attempt (UNKNOWN) also refuses — never double-post.
function alreadySubmitted(spec) {
  try {
    const lines = fs.readFileSync(SUBMISSIONS_LOG, 'utf8').split('\n').filter(Boolean);
    const h = hashMessage(spec.message);
    const prev = lines.map((l) => JSON.parse(l))
      .find((r) => r.destination === spec.permalink && r.message_hash === h);
    return prev || null;
  } catch { return null; }
}

function recordSubmission(spec, result) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.appendFileSync(SUBMISSIONS_LOG, JSON.stringify({
    action_id: spec.actionId ?? null,
    opportunity_id: spec.opportunityId,
    channel: spec.channel,
    destination: spec.permalink,
    message_hash: hashMessage(spec.message),
    authorization_id: spec.authorization?.authorization_id ?? null,
    requested_at: spec.requestedAt ?? null,
    execution_completed_at: new Date().toISOString(),
    verification_state: result.status,
    result: result.status,
    failure_reason: result.reason ?? null,
    evidence: result.screenshots ?? [],
  }) + '\n');
}

// Pure page classifier — testable without a browser.
// Decides WAITING_FOR_HUMAN / FAIL-CLOSED / PROCEED / UNKNOWN.
function classifyPage({ url, destination, pageText }) {
  const hostOk = new URL(destination).hostname.replace(/^old\.|^www\./, '');
  const pageHost = new URL(url).hostname.replace(/^old\.|^www\./, '');
  if (pageHost !== hostOk) return { verdict: 'FAIL_CLOSED', reason: `destination mismatch: on ${pageHost}, expected ${hostOk}` };
  const t = (pageText || '').toLowerCase();
  if (/log in|sign in|sign up|create an account/.test(t) && !/comment|reply/.test(t)) {
    return { verdict: 'WAITING_FOR_HUMAN', reason: 'authentication required — no reply affordance visible' };
  }
  if (/you'?ve been blocked|access denied|are you a robot|verify you are human|rate limit/.test(t)) {
    return { verdict: 'EXTERNAL_BLOCK', reason: 'platform is blocking this client' };
  }
  if (t.length < 200) return { verdict: 'UNKNOWN', reason: 'page content too thin to classify' };
  return { verdict: 'PROCEED' };
}

async function execute(spec) {
  const v = validateSpec(spec);
  if (!v.ok) return { ...v, executed: false };
  const dup = alreadySubmitted(spec);
  if (dup) return { ok: false, status: 'BLOCKED', reason: `already attempted (${dup.verification_state}) at ${dup.execution_completed_at} — no blind resend`, prior: dup };

  const puppeteer = require('puppeteer-core');
  const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  // Headed + operator profile: the channel session belongs to J, not a
  // headless sandbox. If Chrome holds the profile lock, we fail honestly.
  const profileDir = spec.profileDir || process.env.CHROME_USER_DATA || 'C:\\Users\\Owner\\AppData\\Local\\Google\\Chrome\\User Data';
  const out = { ok: false, status: 'FAILED', steps: [] };
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      userDataDir: profileDir,
      args: ['--profile-directory=Default', '--no-first-run', '--no-sandbox'],
    });
  } catch (e) {
    return { ...out, status: 'UNKNOWN', reason: `browser launch failed: ${e.message} — Chrome may hold the profile lock (close Chrome or grant the action a separate session)` };
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    let nav;
    try {
      nav = await page.goto(spec.permalink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      return { ...out, status: 'EXTERNAL_BLOCK', reason: `destination unreachable: ${e.message}` };
    }
    out.steps.push(`navigated to ${page.url()}`);
    if (nav && nav.status() >= 400) {
      return { ...out, status: 'EXTERNAL_BLOCK', reason: `destination returned HTTP ${nav.status()}` };
    }
    await new Promise((r) => setTimeout(r, 3000));
    const cls = classifyPage({
      url: page.url(), destination: spec.permalink,
      pageText: await page.evaluate(() => document.body?.innerText ?? '').catch(() => ''),
    });
    if (cls.verdict !== 'PROCEED') return { ...out, status: cls.verdict === 'FAIL_CLOSED' ? 'BLOCKED' : cls.verdict, reason: cls.reason };

    // Reddit-specific bounded interaction: only the top-level comment box.
    // No upvotes, no other posts, no PMs — exact selector for the reply form.
    const replySel = 'div[data-testid="comment-composer"] [contenteditable], div.public-DraftEditor-content, textarea[placeholder*="Comment"], textarea[name="comment"]';
    let box = await page.$(replySel);
    if (!box) {
      const trigger = await page.evaluateHandle(() => {
        for (const b of Array.from(document.querySelectorAll('button, div[role="button"]'))) {
          if (/add a comment|comment/i.test(b.textContent || '')) return b;
        }
        return null;
      });
      const tEl = trigger && trigger.asElement();
      if (tEl) { await tEl.click().catch(() => { }); await new Promise((r) => setTimeout(r, 1500)); box = await page.$(replySel); }
    }
    if (!box) return { ...out, status: 'UNKNOWN', reason: 'reply composer not found — UI changed, refusing to guess' };

    await box.click();
    await box.type(spec.message, { delay: 4 });
    out.steps.push('typed exact authorized message');
    const shot1 = path.join(EVIDENCE_DIR, `${spec.actionId || 'reply'}-composed.png`);
    await page.screenshot({ path: shot1 });
    out.steps.push(`screenshot ${shot1}`);

    // Find a visible submit control by exact label — never guess-click.
    const submit = await page.evaluateHandle(() => {
      const labels = ['comment', 'post', 'reply'];
      for (const b of Array.from(document.querySelectorAll('button'))) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (labels.includes(t) && !b.disabled) return b;
      }
      return null;
    });
    const submitEl = submit && submit.asElement();
    if (!submitEl) return { ...out, status: 'UNKNOWN', reason: 'composed but submit control not found — not clicking anything else' };
    await submitEl.click();
    out.steps.push('clicked submit');
    await new Promise((r) => setTimeout(r, 4000));

    // Verification: the exact authorized text must now be visible on the
    // destination page. Anything else is UNKNOWN, not SUCCESS.
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const shot2 = path.join(EVIDENCE_DIR, `${spec.actionId || 'reply'}-submitted.png`);
    await page.screenshot({ path: shot2 });
    const visible = bodyText.includes(spec.message.slice(0, 60));
    out.status = visible ? 'VERIFIED' : 'UNKNOWN';
    out.ok = visible;
    out.reason = visible ? null : 'submitted content not visible on page — cannot confirm the post landed';
    out.screenshots = [shot1, shot2];
    return out;
  } catch (e) {
    return { ...out, status: 'UNKNOWN', reason: e instanceof Error ? e.message : String(e) };
  } finally {
    if (browser) await browser.close().catch(() => { });
  }
}

module.exports = { execute, validateSpec, createAuthorization, classifyPage, hashMessage, alreadySubmitted, recordSubmission };
