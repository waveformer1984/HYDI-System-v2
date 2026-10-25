'use strict';

/**
 * One-time provisioning codes for the phone's QR key import.
 *
 * Jordan opens /phone/provision on Frank, which issues a code good for one
 * use within 5 minutes and shows it as a QR. The phone's Hydi dashboard scans
 * it and redeems the code with Frank for the phone keys. A photo of the
 * screen is useless once the code is used or expired, and the QR itself never
 * contains a key.
 *
 * Storage: one file per code under .runtime/phone-provision/, named by the
 * SHA-256 of the code, so the plaintext code is never written to disk.
 * Redeeming renames the file first; rename is atomic, so two simultaneous
 * redeems cannot both succeed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TTL_MS = 5 * 60 * 1000;
// Frank env values the phone may receive. FRANK_HOSTS is not a secret and
// comes from the code itself (the addresses the QR told the phone to use).
const PROVISIONABLE_KEYS = Object.freeze(['HYDI_BOARD_HUMAN_TOKEN', 'HYDI_PHONE_READ_TOKEN', 'GROQ_API_KEY']);
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function provisionDir(root) {
  return path.join(root, '.runtime', 'phone-provision');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** 160 random bits as 32 base32 characters (QR alphanumeric-friendly). */
function newCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function sweepExpired(dir, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (name.includes('.redeeming-')) {
        if (now - fs.statSync(full).mtimeMs > TTL_MS) fs.unlinkSync(full);
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const rec = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!(rec.expiresAt > now)) fs.unlinkSync(full);
    } catch { /* another process got there first */ }
  }
}

/**
 * @param {{ root: string, hosts: string[], port?: number, keys?: string[], now?: number }} opts
 * @returns {{ code: string, payload: string, expiresAt: number, keys: string[] }}
 */
function createProvisionCode({ root, hosts, port = 3000, keys = PROVISIONABLE_KEYS, now = Date.now(), randomBytes } = {}) {
  const wanted = keys.filter((k) => PROVISIONABLE_KEYS.includes(k));
  if (!wanted.length) throw new Error('no provisionable keys requested');
  const cleanHosts = (hosts || []).map((h) => String(h).trim()).filter((h) => /^[A-Za-z0-9.:-]{1,64}$/.test(h));
  if (!cleanHosts.length) throw new Error('no reachable Frank address to put in the code');
  const dir = provisionDir(root);
  fs.mkdirSync(dir, { recursive: true });
  sweepExpired(dir, now);
  const code = newCode(randomBytes);
  const expiresAt = now + TTL_MS;
  const file = path.join(dir, `${hashCode(code)}.json`);
  fs.writeFileSync(file, JSON.stringify({ expiresAt, keys: wanted, hosts: cleanHosts }), { flag: 'wx', mode: 0o600 });
  const payload = `hydi-provision:v1?c=${code}&h=${cleanHosts.join(',')}&p=${Number(port) || 3000}`;
  return { code, payload, expiresAt, keys: wanted };
}

/**
 * Redeem once. Never throws for a bad code: returns { ok:false, error }.
 * @returns {{ ok: true, keys: Record<string,string>, missing: string[] } | { ok: false, error: string }}
 */
function redeemProvisionCode({ root, code, env = process.env, now = Date.now() } = {}) {
  if (typeof code !== 'string' || !/^[A-Z2-7]{32}$/.test(code)) return { ok: false, error: 'invalid_code' };
  const dir = provisionDir(root);
  const file = path.join(dir, `${hashCode(code)}.json`);
  const claimed = `${file}.redeeming-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.renameSync(file, claimed);
  } catch {
    return { ok: false, error: 'invalid_or_used_code' };
  }
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(claimed, 'utf8'));
  } catch {
    rec = null;
  } finally {
    try { fs.unlinkSync(claimed); } catch { /* already gone */ }
  }
  if (!rec || !(rec.expiresAt > now)) return { ok: false, error: 'expired_code' };
  const keys = {};
  const missing = [];
  for (const name of rec.keys || []) {
    if (!PROVISIONABLE_KEYS.includes(name)) continue;
    const value = String(env[name] || '').trim();
    if (value) keys[name] = value;
    else missing.push(name);
  }
  if (Array.isArray(rec.hosts) && rec.hosts.length) keys.FRANK_HOSTS = rec.hosts.join(',');
  return { ok: true, keys, missing };
}

module.exports = {
  TTL_MS,
  PROVISIONABLE_KEYS,
  provisionDir,
  hashCode,
  newCode,
  createProvisionCode,
  redeemProvisionCode,
};
