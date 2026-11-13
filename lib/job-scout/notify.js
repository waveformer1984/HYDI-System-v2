'use strict';
/**
 * Job scout → phone alerts for strong leads.
 *
 * After a successful scan, every lead with score >= notifyScore that has
 * never been notified gets ONE notification — unless there are more than
 * BATCH_THRESHOLD, in which case a single summary notification covers them
 * all. "Never notified" is tracked on the lead itself (notifiedAt in
 * leads.json), so a restart or a later scan can't double-send.
 *
 * Quiet hours defer, never drop: during the configured window the
 * candidates keep notifiedAt unset and are picked up by the next scan.
 *
 * Heidi never applies, bids or messages — the notification only says a
 * lead exists and where to read it (Ursula → Freelance).
 */

const BATCH_THRESHOLD = 3;

function pad2(n) { return String(n).padStart(2, '0'); }

/** Local HH:MM in the configured timezone (default America/Chicago). */
function localHHMM(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/Chicago',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(now));
    const h = parts.find((p) => p.type === 'hour');
    const m = parts.find((p) => p.type === 'minute');
    return `${pad2(Number(h.value) % 24)}:${pad2(Number(m.value))}`;
  } catch {
    return null; // bad timezone config -> treated as "cannot tell" -> not quiet
  }
}

/**
 * @param {number} now epoch ms
 * @param {{start?: string, end?: string, timezone?: string}|null|undefined} quiet
 * @returns {boolean}
 */
function isQuietHours(now, quiet) {
  if (!quiet || !quiet.start || !quiet.end) return false;
  const t = localHHMM(now, quiet.timezone);
  if (!t) return false;
  const start = String(quiet.start), end = String(quiet.end);
  if (start <= end) return t >= start && t < end;      // same-day window
  return t >= start || t < end;                        // overnight window
}

function clip(s, n) { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; }

function leadLine(l) {
  const div = l.division ? ` [${l.division}]` : '';
  return `• ${clip(l.title, 90)} — score ${l.score}${div}`;
}

/**
 * Notify for qualifying un-notified leads.
 *
 * @param {object}   opts
 * @param {Array}    opts.leads      final ranked leads from the scan (mutated: notifiedAt set on send)
 * @param {object}   opts.config     job-scout.json (notifyScore, notify.quietHours)
 * @param {Function} opts.notifyFn   async (input) => notification — wraps createNotification
 * @param {number}   [opts.now]      epoch ms
 * @returns {Promise<{candidates:number, sent:number, batched:boolean, deferred:boolean}>}
 */
async function maybeNotifyLeads({ leads, config, notifyFn, now = Date.now() }) {
  const notifyScore = Number(config && config.notifyScore) || 75;
  const quiet = config && config.notify && config.notify.quietHours;
  const candidates = (leads || [])
    .filter((l) => l && Number(l.score) >= notifyScore && !l.notifiedAt)
    .sort((a, b) => b.score - a.score);

  const result = { candidates: candidates.length, sent: 0, batched: false, deferred: false };
  if (!candidates.length || typeof notifyFn !== 'function') return result;

  if (isQuietHours(now, quiet)) {
    result.deferred = true;
    return result;
  }

  const nowIso = new Date(now).toISOString();
  if (candidates.length > BATCH_THRESHOLD) {
    result.batched = true;
    const top = candidates.slice(0, 10);
    await notifyFn({
      category: 'job_lead',
      title: `Job scout: ${candidates.length} new strong leads`,
      body: top.map(leadLine).join('\n') + (candidates.length > top.length ? `\n…and ${candidates.length - top.length} more — see Ursula → Freelance` : ''),
      metadata: { kind: 'job_lead_batch', leadIds: candidates.map((l) => l.id), scores: candidates.map((l) => l.score) },
    });
    for (const l of candidates) l.notifiedAt = nowIso;
    result.sent = candidates.length;
    return result;
  }

  for (const l of candidates) {
    await notifyFn({
      category: 'job_lead',
      title: `Strong job lead: ${clip(l.title, 80)}`,
      body: `${leadLine(l)}\n${l.sourceUrl || ''}`.trim(),
      metadata: { kind: 'job_lead', leadId: l.id, score: l.score, division: l.division || null, sourceUrl: l.sourceUrl || null },
    });
    l.notifiedAt = nowIso;
    result.sent += 1;
  }
  return result;
}

module.exports = { maybeNotifyLeads, isQuietHours, localHHMM, BATCH_THRESHOLD };
