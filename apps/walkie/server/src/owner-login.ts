/**
 * Prints a one-time sign-in QR code for the channel owner:
 *
 *   npm run owner-login -- "Frank"
 *
 * Scanning it with the phone camera opens <PUBLIC_BASE_URL>/w and signs that
 * browser (or, via "Open in app", the Walkie app) in as the owner account for
 * that name, without email. The ticket works once and expires in 10 minutes.
 * Only someone who can run this on the server machine (and so read
 * WALKIE_SESSION_SECRET) can mint one; there is no network route that does.
 */
import './env.js';
import QRCode from 'qrcode';
import { SessionIssuer } from './auth.js';
import { loadConfig } from './config.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name || name.length > 40) {
  console.error('Usage: npm run owner-login -- "<your display name>"  (1–40 characters)');
  process.exit(2);
}

const config = loadConfig();
if (!config.sessions) {
  console.error('WALKIE_SESSION_SECRET is not set, so owner sign-in is disabled.');
  process.exit(1);
}

const issuer = new SessionIssuer(config.sessions.secret);
const { token, expiresAt } = await issuer.issueLoginTicket(name);
// In the URL fragment, so it never reaches server logs or a Referer header.
const appLink = `protoforgewalkie://login/${token}`;
const link = config.publicBaseUrl ? `${config.publicBaseUrl}/w#login=${token}` : appLink;

console.log(await QRCode.toString(link, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
console.log(`Scan with your phone camera to sign in as "${name}" (account ${issuer.ownerIdFor(name)}).`);
console.log(`Or open this link on the phone: ${link}`);
console.log(`Works once, until ${new Date(expiresAt).toLocaleTimeString()}. Do not share this code or a photo of it.`);
if (!config.publicBaseUrl) console.log('PUBLIC_BASE_URL is not set: the code opens the Walkie app directly (it must be installed).');
