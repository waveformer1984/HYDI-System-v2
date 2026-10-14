// End-to-end: owner signs in by QR ticket, creates a channel, shows an invite
// QR; a second browser "scans" it (decodes the QR image), joins as a guest,
// and the two talk through a real LiveKit server with fake microphones.
//
// Needs: `docker compose up -d` in apps/walkie (LiveKit + Postgres), a running
// server (`npm start`) whose environment has WALKIE_SESSION_SECRET and
// PUBLIC_BASE_URL=http://127.0.0.1:8787, and a Chromium binary. Run it from
// apps/walkie/server with that same environment:
//
//   CHROMIUM_PATH=/path/to/chrome npm run test:e2e:web
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const CH = `Garage ${Date.now() % 100000}`;
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const SHOTS = join(tmpdir(), 'walkie-e2e');
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. Owner sign-in ticket from the real CLI.
const cli = execFileSync('npm', ['run', '-s', 'owner-login', '--', 'Frank'], { cwd: SERVER_DIR, encoding: 'utf8', env: process.env });
const ownerLink = cli.match(/Or open this link on the phone: (\S+)/)?.[1];
check('owner-login prints a sign-in link', Boolean(ownerLink));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'] };
const ownerCtx = await browser.newContext(phone);
const guestCtx = await browser.newContext(phone);
const owner = await ownerCtx.newPage();
const guest = await guestCtx.newPage();
// Record every RTCPeerConnection so the test can read WebRTC stats.
const capturePcs = () => {
  const Orig = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...args) {
    const pc = new Orig(...args);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Orig.prototype;
};
await owner.addInitScript(capturePcs);
await guest.addInitScript(capturePcs);
const audioBytesIn = (page) =>
  page.evaluate(async () => {
    let n = 0;
    for (const pc of window.__pcs ?? []) {
      const stats = await pc.getStats().catch(() => null);
      stats?.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived ?? 0;
      });
    }
    return n;
  });
const consoleErrors = [];
for (const [who, p] of [['owner', owner], ['guest', guest]]) {
  p.on('pageerror', (e) => consoleErrors.push(`${who}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${who}: ${m.text()}`));
}

try {
  // 2. Owner opens the sign-in link (what scanning the terminal QR does).
  await owner.goto(ownerLink);
  await owner.getByText('Signed in as Frank').waitFor({ timeout: 10_000 });
  check('owner signed in by QR ticket', true);
  check('ticket removed from the address bar', !owner.url().includes('login='), owner.url());

  // 3. Create a channel → invite QR appears.
  await owner.getByPlaceholder('New channel name').fill(CH);
  await owner.getByRole('button', { name: 'Create' }).click();
  const qrImg = owner.locator('.qr img');
  await qrImg.waitFor({ timeout: 10_000 });
  const code = (await owner.locator('.code').textContent()).trim();
  const src = await qrImg.getAttribute('src');
  const png = PNG.sync.read(Buffer.from(src.split(',')[1], 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
  check('invite QR decodes to the join link', decoded === `${BASE}/j/${code}`, decoded);

  // 4. Guest "scans": opens the decoded link, types a name, joins.
  await guest.goto(decoded);
  await guest.getByText('Frank invited you to').waitFor({ timeout: 10_000 });
  check('join page previews channel and owner', (await guest.locator('strong').textContent()) === CH);
  check('join page offers the app', (await guest.getByText('Open in the Walkie app').getAttribute('href')) === `protoforgewalkie://join/${code}`);
  await guest.getByPlaceholder('Your name').fill('Sam');
  await guest.getByRole('button', { name: 'Join and talk' }).click();
  await guest.locator('.status', { hasText: 'Listening' }).waitFor({ timeout: 15_000 });
  check('guest joined and is listening', true);

  // 5. Owner opens the channel.
  await owner.goto(`${BASE}/w`);
  await owner.getByRole('button', { name: CH, exact: true }).click();
  await owner.locator('.status', { hasText: 'Listening' }).waitFor({ timeout: 15_000 });
  await owner.locator('.person', { hasText: 'Sam' }).waitFor({ timeout: 10_000 });
  check('owner sees the guest present', true);

  // 6. Owner holds Talk → guest hears "Frank is talking" and gets an audio track.
  const hold = async (page, ms, during) => {
    const box = await page.locator('#talk').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try {
      await during();
    } finally {
      await page.waitForTimeout(ms);
      await page.mouse.up();
    }
  };
  // The first press may only ask for the microphone (machine: mic unknown).
  await hold(owner, 200, async () => {});
  await owner.waitForTimeout(500);
  let ownerSpoke = false;
  let guestHeard = false;
  let guestAudioEl = 0;
  await hold(owner, 1500, async () => {
    await owner.locator('.status', { hasText: 'You are transmitting' }).waitFor({ timeout: 8000 });
    ownerSpoke = true;
    await guest.locator('.status', { hasText: 'Frank is talking' }).waitFor({ timeout: 8000 });
    guestHeard = true;
    await guest.waitForFunction(() => document.querySelectorAll('audio').length > 0, null, { timeout: 8000 });
    guestAudioEl = await guest.evaluate(() => document.querySelectorAll('audio').length);
  });
  check('owner transmits while holding', ownerSpoke);
  check('guest sees "Frank is talking"', guestHeard);
  check('guest subscribed to the owner audio track', guestAudioEl > 0, `${guestAudioEl} audio element(s)`);
  await guest.locator('.status', { hasText: 'Listening' }).waitFor({ timeout: 8000 });
  check('floor released when owner lets go', true);
  const guestRx = await audioBytesIn(guest);
  check('guest received owner audio over WebRTC', guestRx > 1000, `${guestRx} bytes`);

  // 7. Guest talks back; owner hears.
  let ownerHeard = false;
  await hold(guest, 1500, async () => {
    await guest.locator('.status', { hasText: 'You are transmitting' }).waitFor({ timeout: 8000 });
    await owner.locator('.status', { hasText: 'Sam is talking' }).waitFor({ timeout: 8000 });
    ownerHeard = true;
  });
  check('guest talks back and owner sees "Sam is talking"', ownerHeard);
  const ownerRx = await audioBytesIn(owner);
  check('owner received guest audio over WebRTC', ownerRx > 1000, `${ownerRx} bytes`);

  // 9. Same QR again (single use) → refused.
  const third = await browser.newContext(phone);
  const p3 = await third.newPage();
  await p3.goto(decoded);
  await p3.getByText('already used').waitFor({ timeout: 8000 });
  check('a used invite QR is refused for a third phone', true);
  await third.close();

  // 10. Returning guest: reload keeps the session and the channel.
  await guest.reload();
  await guest.locator('.status', { hasText: /Listening|Connecting/ }).waitFor({ timeout: 15_000 });
  check('guest reload stays signed in to the channel', true);
} catch (err) {
  check('scenario completed', false, err.message.split('\n')[0]);
  await owner.screenshot({ path: join(SHOTS, 'owner-fail.png') }).catch(() => {});
  await guest.screenshot({ path: join(SHOTS, 'guest-fail.png') }).catch(() => {});
} finally {
  await guest.screenshot({ path: join(SHOTS, 'guest-final.png') }).catch(() => {});
  await owner.screenshot({ path: join(SHOTS, 'owner-final.png') }).catch(() => {});
  await browser.close();
}
if (consoleErrors.length) log('page errors:', consoleErrors.slice(0, 10));
const failed = results.filter((r) => !r.ok).length;
log(`${results.length - failed}/${results.length} checks passed (screenshots in ${SHOTS})`);
process.exit(failed ? 1 : 0);
