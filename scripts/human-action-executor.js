// Human Action Executor — bounded computer control for explicitly
// operator-approved actions. Closed action set; anything else BLOCKS.
//
// Usage:
//   node scripts/human-action-executor.js --spec '{"type":"stripe_test_checkout","checkoutUrl":"...","jobId":"..."}'
//
// Prints a JSON result line to stdout; exit 0 = action performed
// (postcondition verified separately by the caller — this script reports
// what the browser actually did, not success claims).

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EVIDENCE_DIR = path.join(process.cwd(), '.hydi-operational', 'human-action-evidence');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function stripeTestCheckout(spec) {
  const { checkoutUrl, jobId } = spec;
  if (!checkoutUrl || !checkoutUrl.startsWith('https://checkout.stripe.com/')) {
    return { ok: false, status: 'BLOCKED', reason: `checkoutUrl not a hosted Stripe test URL: ${checkoutUrl}` };
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const out = { ok: false, status: 'FAILED', steps: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(checkoutUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    out.steps.push('loaded hosted checkout');

    // Stripe hosted Checkout renders card inputs directly on the page.
    await page.waitForSelector('#cardNumber', { timeout: 30000 });
    const fill = async (sel, val) => {
      await page.click(sel, { clickCount: 3 });
      await page.type(sel, val, { delay: 25 });
      out.steps.push(`filled ${sel}`);
    };
    const emailSel = '#email';
    try { await page.waitForSelector(emailSel, { timeout: 3000 }); await fill(emailSel, 'heidi-test@localhost.dev'); } catch { /* optional */ }
    await fill('#cardNumber', '4242424242424242');
    await fill('#cardExpiry', '12/34');
    await fill('#cardCvc', '123');
    try { await page.waitForSelector('#billingName', { timeout: 3000 }); await fill('#billingName', 'Heidi Test'); } catch { /* optional */ }
    try { await page.waitForSelector('#billingPostalCode', { timeout: 3000 }); await fill('#billingPostalCode', '55401'); } catch { /* optional */ }

    const shot1 = path.join(EVIDENCE_DIR, `${jobId}-filled.png`);
    await page.screenshot({ path: shot1 });
    out.steps.push(`screenshot ${shot1}`);

    // Submit — the consequential click, performed only under explicit
    // operator approval carried in the approved actionSpec.
    const submitSel = "button[data-testid='hosted-payment-submit-button'], button.SubmitButton, button[type='submit']";
    await page.click(submitSel);
    out.steps.push('clicked submit');

    // Wait for redirect to success page (or any navigation away from
    // checkout.stripe.com). Test card approves instantly; allow 60s.
    try {
      await page.waitForFunction(
        () => !location.hostname.includes('checkout.stripe.com') || document.body.innerText.includes('successful'),
        { timeout: 60000 }
      );
    } catch { /* fall through — report what we can see */ }
    await new Promise((r) => setTimeout(r, 3000));
    const shot2 = path.join(EVIDENCE_DIR, `${jobId}-result.png`);
    await page.screenshot({ path: shot2 });
    out.finalUrl = page.url();
    out.steps.push(`final url ${out.finalUrl}`);
    out.ok = !out.finalUrl.includes('checkout.stripe.com/c/pay') || out.finalUrl.includes('success');
    out.status = out.ok ? 'EXECUTED' : 'FAILED';
    if (!out.ok) out.reason = 'browser did not reach a success page';
  } catch (e) {
    out.status = 'BLOCKED';
    out.reason = e instanceof Error ? e.message : String(e);
  } finally {
    await browser.close();
  }
  return out;
}

(async () => {
  const spec = JSON.parse(arg('spec') || '{}');
  let result;
  if (spec.type === 'stripe_test_checkout') {
    result = await stripeTestCheckout(spec);
  } else {
    result = { ok: false, status: 'BLOCKED', reason: `unknown action type '${spec.type}' — closed action set` };
  }
  result.actionId = spec.actionId || null;
  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 2);
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, status: 'BLOCKED', reason: String(e) }));
  process.exit(2);
});
